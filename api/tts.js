export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const text = (body.text || "").trim();

    if (!text) {
      return res.status(400).json({ error: "Nedostaje tekst." });
    }

    const cleanText = text
      .replace(/[*#_~`]/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .slice(0, 400);

    // Korišćenje pouzdanog TTS servisa sa eksplicitnim kodom za srpski jezik (sr-RS)
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(cleanText)}&tl=sr`;

    const response = await fetch(ttsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0",
        "Referer": "https://translate.google.com/"
      }
    });

    if (!response.ok) {
      return res.status(500).json({ error: "Greška pri generisanju zvuka." });
    }

    const audioBuffer = await response.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    return res.status(200).send(Buffer.from(audioBuffer));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
