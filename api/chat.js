export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { question } = req.body || {};

  const data = [
    { id: 1, category: "Film", author: "Tarkovski", title: "Ogledalo" },
    { id: 2, category: "Film", author: "Tarkovski", title: "Stalker" },
    { id: 3, category: "Film", author: "Bergman", title: "Persona" },
    { id: 4, category: "Filozofija", author: "Niče", title: "Zaratustra" },
    { id: 5, category: "Filozofija", author: "Platon", title: "Država" },
    { id: 6, category: "Muzika", author: "The Beatles", title: "Abbey Road" },
    { id: 7, category: "Muzika", author: "Bowie", title: "Heroes" }
  ];

  const q = (question || "").toLowerCase().trim();

  const result = q
    ? data.filter(d =>
        d.author.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q)
      )
    : data;

  return res.status(200).json({
    answer: result,
    ok: true
  });
}
