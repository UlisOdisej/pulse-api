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

    // Izvlačimo koren reči (uzimamo prvih 5-6 slova radi padeža)
    const rawWords = q
      .toLowerCase()
      .replace(/[.,?!]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2);

    const stems = rawWords.map(w => w.length > 5 ? w.slice(0, 5) : w);

    // Povlačimo veći skup dokumenata iz baze
    const { data, error } = await supabase
      .from("pulse_documents")
      .select("id,title,content,permalink")
      .limit(500);

    let matchedDocs = [];

    if (data && data.length > 0) {
      matchedDocs = data.filter(d => {
        const fullText = ((d.title || "") + " " + (d.content || "")).toLowerCase();
        return stems.some(stem => fullText.includes(stem));
      });
    }

    // Ako i dalje nema pogodaka, uzimamo nasumičnih 5 iz baze kao opšti context
    if (matchedDocs.length === 0 && data && data.length > 0) {
      matchedDocs = data.slice(0, 5);
    }

    if (matchedDocs.length === 0) {
      return res.status(200).json({
        answer: `U zbirci P.U.L.S.E biblioteke trenutno nema pronađenih tekstova o pojmu "${q}".`,
        sources: [],
        ok: true
      });
    }

    // Priprema konteksta sa stvarnim naslovima i linkovima
    const context = matchedDocs
      .slice(0, 6)
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
                "Ti si kustos P.U.L.S.E biblioteke. Odgovori na pitanje isključivo koristeći priložene tekstove iz zbirke. Obavezno navedi tačne naslove članaka iz teksta koji su priloženi."
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
      sources: matchedDocs.slice(0, 6),
      ok: true
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
}
