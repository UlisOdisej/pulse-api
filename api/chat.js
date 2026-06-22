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

    // 1. KLASIČNA PRETRAGA (STABILNO)
    const searchRes = await fetch(
      `${supabaseUrl}/rest/v1/pulse_documents?select=id,title,permalink,content&or=(title.ilike.*${q}*,content.ilike.*${q}*)&limit=10`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    const data = await searchRes.json();

    // 2. KONTEXT ZA AI
    const context = (data || [])
      .slice(0, 6)
      .map(d => `${d.title}\n${d.content?.slice(0, 400) || ""}`)
      .join("\n\n");

    // 3. AI ODGOVOR (VODIČ KROZ BIBLIOTEKU)
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
            content:
              "Ti si kustos P.U.L.S.E biblioteke. Odgovaraš kratko, jasno i vodiš korisnika kroz tekstove."
          },
          {
            role: "user",
            content: `Pitanje: ${q}\n\nTekstovi iz arhive:\n${context}\n\nNapiši kratak odgovor i predlog šta dalje čitati.`
          }
        ]
      })
    });

    const aiData = await aiRes.json();
    const answer =
      aiData?.choices?.[0]?.message?.content || "Nema dostupnog odgovora.";

    // 4. RETURN
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
