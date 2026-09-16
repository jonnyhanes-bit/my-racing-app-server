const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RACING_ALPHA_API_KEY;
const BASE = "https://racingalpha.co.uk/api/v1";
const WEB = "https://racingalpha.co.uk";

const cache = new Map();
const TTL = 5 * 60 * 1000;

async function getJSON(url) {
  const headers = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
  const r = await fetch(url, { headers });
  const text = await r.text();
  if (!r.ok) throw new Error(`Racing Alpha ${r.status}: ${text.slice(0, 250)}`);
  try { return JSON.parse(text); }
  catch { throw new Error("Racing Alpha returned non-JSON data"); }
}

async function racingAlpha(path) {
  return getJSON(BASE + path);
}

function first(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function raceId(r) {
  return first(r, ["id","race_id","raceId","uid","raceId"]);
}

function runnerArray(d) {
  if (!d || typeof d !== "object") return [];
  const a = first(d, ["runners","horses","selections","entries","participants"]);
  return Array.isArray(a) ? a : [];
}

function extractRaceArray(d) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== "object") return [];
  return d.races || d.data?.races || d.data || [];
}

async function enrichToday() {
  const raw = await racingAlpha("/today");
  const races = extractRaceArray(raw);

  const out = [];
  for (let i = 0; i < races.length; i += 4) {
    const batch = races.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (r) => {
      const id = raceId(r);
      if (!id) return r;
      try {
        const detail = await racingAlpha(`/races/${encodeURIComponent(id)}`);
        return { ...r, _signals: detail };
      } catch {
        return r;
      }
    }));
    out.push(...results);
  }
  return { ...((raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {}), races: out };
}

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, provider: "Racing Alpha", version: "2" })
);

app.get("/api/today", async (_req, res) => {
  try {
    const now = Date.now();
    const hit = cache.get("today");
    if (hit && now - hit.time < TTL) return res.json(hit.data);
    const data = await enrichToday();
    cache.set("today", { time: now, data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/race/:id", async (req, res) => {
  try { res.json(await racingAlpha(`/races/${encodeURIComponent(req.params.id)}`)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

/*
  Racing Alpha's public site displays jockey 14-day form on jockey profile
  pages, but it is not part of the documented API. This endpoint therefore
  tries the public jockey leaderboard page. If the site changes that page,
  the app will say "Unavailable" rather than inventing a jockey.
*/
app.get("/api/jockeys/in-form", async (_req, res) => {
  try {
    const urls = [
      `${WEB}/jockeys?min_runs=10`,
      `${WEB}/jockeys?min_runs=5`
    ];
    let html = "";
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (r.ok) { html = await r.text(); if (html) break; }
      } catch {}
    }
    if (!html) return res.status(503).json({ error: "Public jockey leaderboard unavailable" });

    const rows = [];
    const linkRe = /href=["'](\/jockeys\/jky_[^"']+)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi;
    let m;
    while ((m = linkRe.exec(html))) {
      const name = m[2].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
      const pct = m[0].match(/(\d+(?:\.\d+)?)%/);
      const runs = m[0].match(/(\d+)\s*(?:settled rides|rides)/i);
      if (name && pct) rows.push({ name, strikeRate: +pct[1], runs: runs ? +runs[1] : 0, url: WEB + m[1] });
    }
    rows.sort((a,b) => (b.strikeRate-a.strikeRate) || (b.runs-a.runs));
    if (!rows.length) return res.status(503).json({ error: "No jockey form data found" });
    res.json({ jockey: rows[0], source: "Racing Alpha public jockey form" });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Racing app API v2 listening on ${PORT}`));
