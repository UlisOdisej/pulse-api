import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
);

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const q = (body.question || "").trim();

    if (!q) {
      return res.status(200).json({ answer: "", sources: [] });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });
    }

    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: q
      })
    });

    if (!embRes.ok) {
      const errText = await embRes.text();
      return res.status(500).json({ error: "Embedding failed", detail: errText });
    }

    const embData = await embRes.json();
    const queryEmbedding = embData?.data?.[0]?.embedding;

    if (!queryEmbedding) {
      return res.status(500).json({ error: "No embedding returned" });
    }

    let matchedDocs = [];
    let dbError = null;
    try {
      const { data, error } = await supabase.rpc("match_documents", {
        query_embedding: `[${queryEmbedding.join(",")}]`,
        match_threshold: 0.5,
        match_count: 5
      });
      if (error) dbError = error.message;
      if (data) matchedDocs = data;
    } catch (e) {
      dbError = e.message;
    }

    const context = matchedDocs
      .map((doc, i) => `[Izvor ${i + 1}: "${doc.title}"]\n${doc.content}`)
      .join("\n\n---\n\n");

    const systemPrompt = matchedDocs.length
      ? `Ti si digitalni kustos P.U.L.S.E biblioteke. Odgovaraj isključivo na osnovu priloženih izvora ispod. Piši obiman, stručan, analitički odgovor u duhu estetike, filma, književnosti i filozofije. Ako izvori ne pokrivaju pitanje u potpunosti, jasno to naznači.\n\nIZVORI:\n${context}`
      : `Ti si digitalni kustos P.U.L.S.E biblioteke. Za ovo pitanje nije pronađen nijedan relevantan tekst iz biblioteke. Obavesti korisnika da u zbirci trenutno nema teksta koji pokriva ovu temu, i ponudi kratak opšti kontekst ako je koristan, jasno naznačavajući da to nije iz biblioteke.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: `Pitanje: ${q}` }]
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return res.status(500).json({ error: "Claude API failed", detail: errText });
    }

    const aiData = await aiRes.json();
    const generatedAnswer = aiData?.content
      ?.filter((block) => block.type === "text")
      ?.map((block) => block.text)
      ?.join("\n");

    return res.status(200).json({
      answer: generatedAnswer || "Nisam uspeo da generišem odgovor.",
      sources: matchedDocs.map((d) => ({
        title: d.title,
        permalink: d.permalink,
        similarity: d.similarity
      })),
      dbError,
      ok: true
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
}
