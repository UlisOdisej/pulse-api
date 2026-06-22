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
      return res.status(200).json({
        answer: "",
        sources: []
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    const query = q.toLowerCase();

    // 1. POVUCI KORPUS
    const searchRes = await fetch(
      `${supabaseUrl}/rest/v1/pulse_documents?select=id,title,permalink,content&limit=200`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    const data = await searchRes.json();

    // 2. INTELIGENTNI FILTER (ključna ispravka)
    const filtered = (data || []).filter(item => {
      const text = (
        (item.title || "") +
        " " +
        (item.content || "")
      ).toLowerCase();

      // hard match za autore
      if (
        text.includes("tarkov") ||
        text.includes("bergman")
      ) {
        return true;
      }

      // fallback keyword match
      return query
        .split(/\s+/)
        .some(word => text.includes(word));
    });

    // 3. KONTEXT ZA AI
    const context = filtered
      .slice(0, 12)
      .map(
        d => `${d.title}\n${(d.content || "").slice(0, 900)}`
      )
      .join("\n\n");

    // 4. AI ODGOVOR
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
                "Ti si kustos P.U.L.S.E biblioteke. Odgovaraš isključivo na osnovu dostavljenih tekstova. Ne izmišljaš izvore. Ako nema materijala, to jasno kažeš."
            },
            {
              role: "user",
              content: `Pitanje: ${q}

Tekstovi iz arhive:

${context}`
            }
          ]
        })
      }
    );

    const aiData = await aiRes.json();

    const answer =
      aiData?.choices?.[0]?.message?.content ||
      "Nema dovoljno podataka u arhivi.";

    return res.status(200).json({
      answer,
      sources: filtered.slice(0, 12),
      ok: true
    });
  } catch (err) {
    return res.status(200).json({
      answer: "",
      sources: [],
      error: err.message
    });
  }
}
