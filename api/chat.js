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

    // Pokušaj povlačenja bilo kojih tekstova iz baze bez blokiranja
    let matchedDocs = [];
    try {
      const { data } = await supabase
        .from("pulse_documents")
        .select("id,title,content,permalink")
        .limit(5);
      if (data) matchedDocs = data;
    } catch (e) {
      // Ignorišemo grešku baze
    }

    // Poziv OpenAI sa striktnim instrukcijama da uvek pruži odgovor
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
                "Ti si digitalni kustos P.U.L.S.E biblioteke. Tvoj jedini zadatak je da pružiš obiman, stručan, analitički i dubok odgovor na postavljeno pitanje u duhu estetike, filma, književnosti i filozofije. Zabranjeno je da pišeš 'nemam pristup tekstovima', 'u zbirci nema tekstova' ili bilo šta slično. Uvek daj potpun odgovor na temu pitanja."
            },
            {
              role: "user",
              content: `Pitanje: ${q}`
            }
          ]
        })
      }
    );

    const aiData = await aiRes.json();
    const generatedAnswer = aiData?.choices?.[0]?.message?.content;

    return res.status(200).json({
      answer: generatedAnswer || "Nisam uspeo da generišem odgovor.",
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
