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

    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : (req.body || {});

    const q = (body.question || "").trim();

    if (!q) {
      return res.status(200).json({ answer: "", sources: [] });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    // 1. OTVORENA PRETRAGA (DA UVEK VRATI NEŠTO)
    const keywords = q.split(" ").filter(Boolean);

    const orQuery = keywords
      .map(k => `content.ilike.*${k}*,title.ilike.*${k}*`)
      .join(",");

    const searchRes = await fetch(
      `${supabaseUrl}/rest/v1/pulse_documents?select=id,title,permalink,content&or=(${orQuery})&limit=20`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    const data = await searchRes.json();

    // 2. AI SAŽETAK
    const context = (data || [])
      .slice(0, 6)
      .map(d => `${d.title}\n${d.content?.slice(0, 300) || ""}`)
      .join("\n\n");

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Ti si kustos P.U.L.S.E biblioteke. Kratko objašnjavaš i vodiš kroz tekstove."
          },
          {
            role: "user",
            content: `Pitanje: ${q}\n\nTekstovi:\n${context}`
          }
        ]
      })
    });

    const aiData = await aiRes.json();

    const answer =
      aiData?.choices?.[0]?.message?.content || "Nema dovoljno podataka u arhivi.";

    return res.status(200).json({
      answer,
      sources: data || [],
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
