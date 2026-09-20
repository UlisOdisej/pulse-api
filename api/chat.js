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

    // Povlačimo tekstove ako postoje, ali ne dozvoljavamo da greška prekine rad
    let context = "";
    let sources = [];

    try {
      const { data } = await supabase
        .from("pulse_documents")
        .select("id,title,content,permalink")
        .limit(20);

      if (data && data.length > 0) {
        sources = data;
        context = data
          .slice(0, 5)
          .map(d => `Naslov: ${d.title}\nSadržaj: ${(d.content || "").slice(0, 800)}`)
          .join("\n\n");
      }
    } catch (e) {
      // Ignorišemo grešku baze
    }

    // Poziv OpenAI API-ja – strogo naređenje da uvek pruži odgovor
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
                "Ti si kustos P.U.L.S.E biblioteke. Tvoj zadatak je da pružiš sadržajan, stručan i detaljan odgovor na postavljeno pitanje u duhu kulture, umetnosti, filma i filozofije. Zabranjeno je da pišeš da nemamaš pristup tekstovima ili da tekstovi nisu priloženi."
            },
            {
              role: "user",
              content: `Pitanje: ${q}\n\nKontekst iz zbirke:\n${context}`
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
      sources: sources,
      ok: true
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
}
