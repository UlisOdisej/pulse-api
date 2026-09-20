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

    // Izvlačimo ključne reči iz pitanja (duže od 2 slova)
    const searchWords = q
      .toLowerCase()
      .replace(/[.,?!]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2);

    // Pretražujemo bazu Supabase direktno po naslovu i sadržaju
    const { data, error } = await supabase
      .from("pulse_documents")
      .select("id,title,content,permalink")
      .limit(200);

    let matchedDocs = [];

    if (data && data.length > 0) {
      matchedDocs = data.filter(d => {
        const fullText = ((d.title || "") + " " + (d.content || "")).toLowerCase();
        return searchWords.some(w => fullText.includes(w));
      });
    }

    // Ako u bazi nema nijednog teksta o traženom pojmu
    if (matchedDocs.length === 0) {
      return res.status(200).json({
        answer: `U zbirci P.U.L.S.E biblioteke trenutno nema pronađenih tekstova o pojmu "${q}".`,
        sources: [],
        ok: true
      });
    }

    // Pripravljanje konteksta isključivo od pronađenih tekstova
    const context = matchedDocs
      .slice(0, 5)
      .map(d => `Naslov: ${d.title}\nSadržaj: ${(d.content || "").slice(0, 1200)}`)
      .join("\n\n---\n\n");

    // Poziv OpenAI API-ja sa strogim ograničenjem na priloženi kontekst
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
                "Ti si kustos P.U.L.S.E biblioteke. Tvoj zadatak je da odgovoriš na pitanje KORISTEĆI ISKLJUČIVO priložene tekstove iz zbirke. Zabranjeno je izmišljati naslove, autore ili sadržaje koji se ne nalaze u priloženom kontekstu. Citiraj i navedi tačne naslove članaka koji su ti priloženi."
            },
            {
              role: "user",
              content: `Pitanje: ${q}\n\nPronađeni tekstovi iz P.U.L.S.E zbirke:\n${context}`
            }
          ]
        })
      }
    );

    const aiData = await aiRes.json();

    return res.status(200).json({
      answer:
        aiData?.choices?.[0]?.message?.content ||
        "Nisam uspeo da generišem odgovor na osnovu tekstova.",
      sources: matchedDocs.slice(0, 5),
      ok: true
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
}
