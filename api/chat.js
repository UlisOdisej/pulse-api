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
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const q = (body.question || "").trim();

    if (!q) {
      return res.status(200).json({ answer: "", sources: [] });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // Koren reči za fleksibilnije poklapanje
    const cleanWord = q.toLowerCase().replace(/[.,?!]/g, "").trim();
    const stem = cleanWord.length > 5 ? cleanWord.slice(0, 5) : cleanWord;

    // Pokušaj 1: Pretraga po naslovu (title)
    let { data: matchedDocs } = await supabase
      .from("pulse_documents")
      .select("id,title,content,permalink")
      .ilike("title", `%${stem}%`)
      .limit(10);

    // Pokušaj 2: Ako nije našao u naslovu, tražimo u sadržaju (content)
    if (!matchedDocs || matchedDocs.length === 0) {
      const { data: contentMatches } = await supabase
        .from("pulse_documents")
        .select("id,title,content,permalink")
        .ilike("content", `%${stem}%`)
        .limit(10);
      matchedDocs = contentMatches || [];
    }

    // Pokušaj 3: Fallback ako baza odbija ilike – uzimamo najnovije članke
    if (!matchedDocs || matchedDocs.length === 0) {
      const { data: fallback } = await supabase
        .from("pulse_documents")
        .select("id,title,content,permalink")
        .order("id", { ascending: false })
        .limit(5);
      matchedDocs = fallback || [];
    }

    if (matchedDocs.length === 0) {
      return res.status(200).json({
        answer: `U zbirci P.U.L.S.E biblioteke trenutno nema pronađenih tekstova o pojmu "${q}".`,
        sources: [],
        ok: true
      });
    }

    const context = matchedDocs
      .map(d => `Naslov: ${d.title}\nSadržaj: ${(d.content || "").slice(0, 1000)}`)
      .join("\n\n---\n\n");

    const aiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
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
              content:
                "Ti si kustos P.U.L.S.E biblioteke. Tvoj zadatak je da pružiš detaljan i stručan odgovor na pitanje primarno koristeći priložene tekstove iz zbirke. Navedi tačne naslove članaka koji su ti priloženi."
            },
            {
              role: "user",
              content: `Pitanje: ${q}\n\nTekstovi iz P.U.L.S.E zbirke:\n${context}`
            }
          ]
        })
      }
    );

    const aiData = await aiRes.json();

    return res.status(200).json({
      answer:
        aiData?.choices?.[0]?.message?.content ||
        "Nisam uspeo da generišem odgovor.",
      sources: matchedDocs,
      ok: true
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
}
