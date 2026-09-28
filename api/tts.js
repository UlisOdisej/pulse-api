export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const text = (body.text || "").trim();

    if (!text) return res.status(400).json({ error: "Nedostaje tekst za čitanje." });
    if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: "Missing ELEVENLABS_API_KEY in Vercel." });

    const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "LmECtQKlHFHPX4psgBT1";

    const cleanText = text
      .replace(/[*#_~`]/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .slice(0, 1000);

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.85,
          style: 0.15,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.detail?.message || "Greška pri pozivu ElevenLabs API-ja." });
    }

    const audioBuffer = await response.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    return res.status(200).send(Buffer.from(audioBuffer));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
