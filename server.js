const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RACING_ALPHA_API_KEY;
const BASE = "https://racingalpha.co.uk/api/v1";

if (!API_KEY) console.warn("RACING_ALPHA_API_KEY is not set.");

async function racingAlpha(path) {
  const r = await fetch(BASE + path, {
    headers: { "Authorization": `Bearer ${API_KEY}` }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Racing Alpha ${r.status}: ${text.slice(0,200)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

app.get("/api/health", (_req,res) =>
  res.json({ok:true, provider:"Racing Alpha"})
);

app.get("/api/today", async (_req,res) => {
  try {
    const data = await racingAlpha("/today");
    res.json(data);
  } catch(e) {
    res.status(502).json({error:e.message});
  }
});

app.get("/api/jockeys/in-form", async (_req,res) => {
  try {
    const data = await racingAlpha("/jockeys/in-form");
    res.json(data);
  } catch(e) {
    res.status(502).json({error:e.message});
  }
});

app.listen(PORT, () => console.log(`Racing app API listening on ${PORT}`));
