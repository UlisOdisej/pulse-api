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
        : (req.body || {});

    const q = (body.question || "").trim();

    if (!q) {
      return res.status(200).json({
        answer: "",
        sources: []
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    // PRETRAGA
    const keywords = q.split(/\s+/).filter(Boolean);

    const orQuery = keywords
      .map(k => `content.ilike.*${k}*,title.ilike.*${k}*`)
      .join(",");

    const searchRes = await fetch(
      `${supabaseUrl}/rest/v1/pulse_documents?select=id,title,permalink,content&or=(${orQuery})&limit=30`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    const data = await searchRes.json();

    // FILTRIRANJE RELEVANTNIH TEKSTOVA
    const keywords2 = q
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2);

    const filtered = (data || []).filter(item => {
      const text = (
        (item.title || "") +
        " " +
        (item.content || "")
      ).toLowerCase();

      return keywords2.some(word => text.includes(word));
    });

    const context = filtered
      .slice(0, 8)
      .map(item =>
        `${item.title}\n${(item.content || "").slice(0, 1000)}`
      )
      .join("\n\n");

    // OPENAI
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
                `Ti si kustos digitalne biblioteke P.U.L.S.E.

Odgovaraj ISKLJUČIVO na osnovu dostavljenih tekstova.

Ne izmišljaj činjenice.

Ako nema dovoljno materijala, reci da arhiva ne sadrži dovoljno relevantnih tekstova.

Na kraju predloži dalje čitanje.`
            },
            {
              role: "user",
              content:
                `Pitanje:

${q}

Relevantni tekstovi:

${context}`
            }
          ]
        })
      }
    );

    const aiData = await aiRes.json();

    const answer =
      aiData?.choices?.[0]?.message?.content ||
      "Nema dovoljno relevantnih tekstova.";

    return res.status(200).json({
      answer,
      sources: filtered.slice(0, 10),
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
