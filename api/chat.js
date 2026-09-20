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

    // Povlačimo tekstove direktno iz Supabase baze
    const { data, error } = await supabase
      .from("pulse_documents")
      .select("id,title,content,permalink")
      .limit(100);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Ekstrakcija reči iz pitanja dužih od 2 slova
    const words = q
      .toLowerCase()
      .replace(/[.,?!]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2);

    // Pretraga: provera da li naslov ili sadržaj sadrži bilo koju od reči
    let filtered = (data || []).filter(d => {
      const fullText = ((d.title || "") + " " + (d.content || "")).toLowerCase();
      return words.some(w => fullText.includes(w));
    });

    // Ako nema direktnog pogotka po rečima, uzimamo prvih 5 članaka iz baze
    if (filtered.length === 0) {
      filtered = (data || []).slice(0, 5);
    }

    // Priprema konteksta za OpenAI
    const context = filtered
      .slice(0, 8)
      .map(d => `Naslov: ${d.title}\nSadržaj: ${(d.content || "").slice(0, 1000)}`)
      .join("\n\n");

    // Poziv OpenAI API-ja
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
                "Ti si kustos P.U.L.S.E biblioteke. Odgovaraš na pitanja na osnovu ponuđenih tekstova iz biblioteke. Ako u ponuđenim tekstovima nema direktnih informacija o traženom pojmu, navedi ono što imaš u kontekstu ili pruži uopšten odgovor na osnovu tekstova."
            },
            {
              role: "user",
              content: `Pitanje: ${q}\n\nTekstovi zbirke:\n${context}`
            }
          ]
        })
      }
    );

    const aiData = await aiRes.json();

    return res.status(200).json({
      answer:
        aiData?.choices?.[0]?.message?.content ||
        "Nema odgovora.",
      sources: filtered,
      ok: true
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
}
