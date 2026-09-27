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

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const q = (body.question || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = 5;
    const offset = (page - 1) * limit;

    if (!q) return res.status(200).json({ answer: "", sources: [], hasMore: false, ok: true });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // 1. Direktna pretraga po naslovu (prvi prioritet)
    const { data: titleDocs } = await supabase
      .from("pulse_documents")
      .select("id, title, content, permalink")
      .ilike("title", `%${q}%`)
      .limit(20);

    let matchedDocs = titleDocs || [];

    // 2. Ako nema dovoljno pogodaka po naslovu, tražimo po sadržaju
    if (matchedDocs.length < limit) {
      const { data: contentDocs } = await supabase
        .from("pulse_documents")
        .select("id, title, content, permalink")
        .ilike("content", `%${q}%`)
        .limit(20);

      if (contentDocs) {
        const existingIds = new Set(matchedDocs.map(d => d.id));
        contentDocs.forEach(d => {
          if (!existingIds.has(d.id)) matchedDocs.push(d);
        });
      }
    }

    // 3. Vektorska pretraga samo kao rezervna opcija sa visokim pragom (0.55)
    if (matchedDocs.length < limit) {
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

      const embData = await embRes.json();
      const queryEmbedding = embData?.data?.[0]?.embedding;

      if (queryEmbedding) {
        const { data: vectorDocs } = await supabase.rpc("match_pulse_documents", {
          query_embedding: queryEmbedding,
          match_threshold: 0.55,
          match_count: 20
        });

        if (vectorDocs) {
          const existingIds = new Set(matchedDocs.map(d => d.id));
          vectorDocs.forEach(d => {
            if (!existingIds.has(d.id)) matchedDocs.push(d);
          });
        }
      }
    }

    if (matchedDocs.length === 0) {
      return res.status(200).json({
        answer: `U zbirci P.U.L.S.E biblioteke trenutno nema pronađenih tekstova o pojmu "${q}".`,
        sources: [],
        hasMore: false,
        ok: true
      });
    }

    const paginatedDocs = matchedDocs.slice(offset, offset + limit);
    const hasMore = matchedDocs.length > offset + limit;

    const context = paginatedDocs
      .map(d => `Naslov: ${d.title}\nLink: ${d.permalink}\nSadržaj: ${(d.content || "").slice(0, 600)}`)
      .join("\n\n---\n\n");

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Ti si kustos P.U.L.S.E biblioteke. Odgovaraj ISKLJUČIVO na osnovu ponuđenih tekstova i drži se teme postavljenog pitanja. Ako priloženi tekstovi ne govore o toj temi, jasno to navedi."
          },
          {
            role: "user",
            content: `Pitanje: ${q}\n\nTekstovi:\n${context}`
          }
        ]
      })
    });

    const aiData = await aiRes.json();

    return res.status(200).json({
      answer: aiData?.choices?.[0]?.message?.content || "Nisam uspeo da generišem odgovor.",
      sources: paginatedDocs,
      page: page,
      hasMore: hasMore,
      ok: true
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
