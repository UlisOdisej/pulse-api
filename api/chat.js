export default function handler(req, res) {
  // dozvoli samo POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { question } = req.body || {};

    // lokalni dataset (za sada bez baze)
    const data = [
      { id: 1, category: "Film", author: "Tarkovski", title: "Ogledalo" },
      { id: 2, category: "Film", author: "Tarkovski", title: "Stalker" },
      { id: 3, category: "Film", author: "Bergman", title: "Persona" },
      { id: 4, category: "Filozofija", author: "Niče", title: "Tako je govorio Zaratustra" },
      { id: 5, category: "Filozofija", author: "Platon", title: "Država" },
      { id: 6, category: "Muzika", author: "The Beatles", title: "Abbey Road" },
      { id: 7, category: "Muzika", author: "Bowie", title: "Heroes" }
    ];

    const q = (question || "").toLowerCase().trim();

    // ako nema query → vrati sve
    if (!q) {
      return res.status(200).json({
        answer: data,
        offset: 0,
        has_more: false,
        sources: []
      });
    }

    // filter po author/title/category
    const result = data.filter(item =>
      item.author.toLowerCase().includes(q) ||
      item.title.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );

    return res.status(200).json({
      answer: result.length ? result : [],
      offset: 0,
      has_more: false,
      sources: []
    });

  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      detail: err.message
    });
  }
}
