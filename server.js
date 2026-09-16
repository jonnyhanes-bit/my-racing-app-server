const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RACING_ALPHA_API_KEY;
const BASE = 'https://racingalpha.co.uk/api/v1';
const WEB = 'https://racingalpha.co.uk';

const cache = new Map();
const TODAY_TTL = 5 * 60 * 1000;
const CARD_TTL = 15 * 60 * 1000;
const JOCKEY_TTL = 30 * 60 * 1000;

async function getJSON(url) {
  const headers = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
  const r = await fetch(url, { headers });
  const text = await r.text();
  if (!r.ok) throw new Error(`Racing Alpha ${r.status}: ${text.slice(0, 250)}`);
  try { return JSON.parse(text); } catch { throw new Error('Racing Alpha returned non-JSON data'); }
}

async function racingAlpha(path) { return getJSON(BASE + path); }

async function getHTML(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MyRacingApp/3.0)',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Racing Alpha web ${r.status}: ${text.slice(0, 200)}`);
  return text;
}

function first(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function raceId(r) { return first(r, ['id','race_id','raceId','uid']); }

function extractRaceArray(d) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object') return [];
  return d.races || d.data?.races || d.data || [];
}

function runnerArray(d) {
  if (!d || typeof d !== 'object') return [];
  const a = first(d, ['runners','horses','selections','entries','participants']);
  return Array.isArray(a) ? a : [];
}

function horseName(x) {
  if (!x || typeof x !== 'object') return '';
  return String(first(x, ['name','horse','runner_name','selection_name','horse_name']) || '').trim();
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanText(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function absoluteUrl(href) {
  try { return new URL(href, WEB).href; } catch { return href || ''; }
}

function findColumnHeaders($, table) {
  let headers = $(table).find('thead th').map((_, e) => cleanText($(e).text())).get();
  if (!headers.length) headers = $(table).find('tr').first().find('th,td').map((_, e) => cleanText($(e).text())).get();
  return headers.map(h => h.toLowerCase());
}

async function fetchRacecard(id) {
  const key = `card:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CARD_TTL) return hit.data;

  const html = await getHTML(`${WEB}/racecards/${encodeURIComponent(id)}`);
  const $ = cheerio.load(html);
  let bestTable = null;
  let bestHeaders = [];

  $('table').each((_, el) => {
    const hs = findColumnHeaders($, el);
    if (hs.some(h => h.includes('horse')) && hs.some(h => h.includes('jockey'))) {
      bestTable = el;
      bestHeaders = hs;
    }
  });

  const runners = [];
  if (bestTable) {
    const headerRow = $(bestTable).find('thead tr').first().length
      ? $(bestTable).find('thead tr').first()
      : $(bestTable).find('tr').first();
    const headerCells = headerRow.find('th,td');
    const headers = headerCells.map((_, e) => cleanText($(e).text()).toLowerCase()).get();
    const idxHorse = headers.findIndex(h => h.includes('horse'));
    const idxJockey = headers.findIndex(h => h.includes('jockey'));
    const idxAI = headers.findIndex(h => h === 'ai' || h.startsWith('ai '));
    const idxSP = headers.findIndex(h => h === 'sp' || h.includes('sp'));

    $(bestTable).find('tbody tr').each((_, tr) => {
      const cells = $(tr).find('td');
      if (!cells.length) return;
      const hc = cells.eq(idxHorse >= 0 ? idxHorse : 0);
      const jc = cells.eq(idxJockey >= 0 ? idxJockey : 0);
      const horseLink = hc.find('a').first();
      const horse = cleanText(horseLink.text() || hc.text());
      if (!horse || /horse/i.test(horse)) return;

      const jockeyLink = jc.find('a[href*="/jockeys/"]').first();
      const jockey = cleanText(jockeyLink.text());
      const trainerLinks = jc.find('a').filter((i, a) => /\/trainers\//i.test($(a).attr('href') || ''));
      const trainer = cleanText(trainerLinks.first().text());
      const ai = idxAI >= 0 ? cleanText(cells.eq(idxAI).text()) : '';
      const sp = idxSP >= 0 ? cleanText(cells.eq(idxSP).text()) : '';
      const number = cleanText(cells.eq(0).text()).match(/^\d+/)?.[0] || '';

      runners.push({
        horse,
        jockey: jockey || '',
        jockey_url: jockeyLink.attr('href') ? absoluteUrl(jockeyLink.attr('href')) : '',
        trainer,
        ai,
        sp,
        number
      });
    });
  }

  // Fallback: use row text/link structure if the table markup changes.
  if (!runners.length) {
    $('a[href*="/jockeys/jky_"]').each((_, a) => {
      const row = $(a).closest('tr');
      const links = row.find('a');
      const jockey = cleanText($(a).text());
      const horse = cleanText(links.filter((i, x) => /\/horses\//i.test($(x).attr('href') || '')).first().text()) || cleanText(row.find('td').first().text());
      if (jockey && horse) runners.push({ horse, jockey, jockey_url: absoluteUrl($(a).attr('href')), trainer: '', ai: '', sp: '' });
    });
  }

  const data = { race_id: id, url: `${WEB}/racecards/${encodeURIComponent(id)}`, runners };
  cache.set(key, { time: Date.now(), data });
  return data;
}

function mergeRunner(signal, card) {
  const s = signal && typeof signal === 'object' ? signal : {};
  return {
    ...s,
    horse: horseName(s) || card.horse,
    jockey: card.jockey || first(s, ['jockey','jockey_name','rider','jockeyName']) || '',
    jockey_name: card.jockey || first(s, ['jockey_name','jockey','rider','jockeyName']) || '',
    jockey_url: card.jockey_url || s.jockey_url || '',
    trainer: card.trainer || s.trainer || '',
    racecard_url: card ? `${WEB}/racecards/${encodeURIComponent(card.race_id || '')}` : ''
  };
}

function enrichDetail(detail, card) {
  const signals = runnerArray(detail);
  if (!signals.length) return { ...detail, _racecard: card, _runners: card.runners.map(c => ({ ...c })) };
  const byName = new Map(card.runners.map(c => [norm(c.horse), c]));
  const merged = signals.map((s, i) => {
    const n = norm(horseName(s));
    const c = byName.get(n) || card.runners[i] || { race_id: card.race_id };
    return mergeRunner(s, { ...c, race_id: card.race_id });
  });
  return { ...detail, _racecard: card, _runners: merged };
}

async function enrichRace(r) {
  const id = raceId(r);
  if (!id) return r;
  try {
    const [detail, card] = await Promise.all([
      racingAlpha(`/races/${encodeURIComponent(id)}`),
      fetchRacecard(id)
    ]);
    return { ...r, _signals: detail, _detail: detail, _racecard: card, _runners: enrichDetail(detail, card)._runners };
  } catch (e) {
  try {
  const card = await fetchRacecard(id);
  return { ...r, _racecard: card, _runners: card.runners, _racecard_error: e.message };
} catch (e) {
  return { ...r, _racecard_error: e.message };
  }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); } catch { out[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function enrichToday() {
  const raw = await racingAlpha('/today');
  const races = extractRaceArray(raw);
  const out = await mapLimit(races, 4, enrichRace);
  return { ...((raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}), races: out.filter(Boolean) };
}

function jockeyFromRacecardRunner(r) {
  return {
    name: r.jockey,
    url: r.jockey_url
  };
}

async function getJockeyForm(profileUrl) {
  const key = `jockey:${profileUrl}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < JOCKEY_TTL) return hit.data;
  const html = await getHTML(profileUrl);
  const $ = cheerio.load(html);
  const name = cleanText($('h1').first().text()) || '';
  const body = cleanText($('body').text());
  const m = body.match(/Strike\s*\(14d\)\s*(\d+(?:\.\d+)?)%/i);
  const rides = body.match(/(\d+)\s*(?:settled rides|rides)\s*(?:Rides 14d)?/i) || body.match(/Rides 14d\s*(\d+)/i);
  const settled = body.match(/(\d+)W\s*\/\s*(\d+)\s*settled/i);
  const data = {
    name,
    url: profileUrl,
    strikeRate: m ? Number(m[1]) : null,
    rides: settled ? Number(settled[2]) : (rides ? Number(rides[1]) : 0)
  };
  cache.set(key, { time: Date.now(), data });
  return data;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, provider: 'Racing Alpha', version: '3' }));

app.get('/api/today', async (_req, res) => {
  try {
    const hit = cache.get('today');
    if (hit && Date.now() - hit.time < TODAY_TTL) return res.json(hit.data);
    const data = await enrichToday();
    cache.set('today', { time: Date.now(), data });
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/race/:id', async (req, res) => {
  try {
    const detail = await racingAlpha(`/races/${encodeURIComponent(req.params.id)}`);
    let card = null;
    try { card = await fetchRacecard(req.params.id); } catch {}
    res.json(card ? enrichDetail(detail, card) : detail);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/jockeys/top2', async (_req, res) => {
  try {
    let today = cache.get('today')?.data;
    if (!today) { try { today = await enrichToday(); } catch (e) { const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); today = await enrichDate(d.toISOString().slice(0,10)); } cache.set('today', { time: Date.now(), data: today }); }
    const races = extractRaceArray(today);
    const map = new Map();
    for (const r of races) {
      for (const h of (r._runners || r._racecard?.runners || [])) {
        if (!h.jockey || !h.jockey_url) continue;
        if (/saffie\s+osborne/i.test(h.jockey)) continue;
        map.set(h.jockey_url, jockeyFromRacecardRunner(h));
      }
    }
    const candidates = [...map.values()];
    const forms = await mapLimit(candidates, 6, async j => {
      try { return await getJockeyForm(j.url); } catch { return null; }
    });
    const ranked = forms.filter(x => x && x.name && Number.isFinite(x.strikeRate) && x.rides >= 10)
      .sort((a,b) => (b.strikeRate - a.strikeRate) || (b.rides - a.rides));
    res.json({ jockeys: ranked.slice(0, 2), basis: 'Racing Alpha public 14-day jockey form; minimum 10 settled rides; Saffie Osborne excluded from top-two slot', candidates: candidates.length });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

const DATE_TTL = 5 * 60 * 1000;

function parseDatePage(html, date) {
  const $ = cheerio.load(html);
  const races = [];
  let meeting = 'Unknown meeting';

  $('h1,h2,h3,a[href*="/racecards/rac_"]').each((_, el) => {
    const tag = (el.tagName || '').toLowerCase();
    const text = cleanText($(el).text());
    if (!text) return;

    if (tag === 'h2') {
      meeting = text;
      return;
    }

    if (tag !== 'a') return;

    const href = $(el).attr('href') || '';
    const m = href.match(/\/racecards\/(rac_[A-Za-z0-9_-]+)/i);
    if (!m) return;

    const time = (text.match(/\b\d{1,2}:\d{2}\b/) || [])[0] || '';
    const name = cleanText(text.replace(/^\d{1,2}:\d{2}\s*/, ''));
    const id = m[1];

    if (races.some(r => r.id === id)) return;

    races.push({
      id,
      race_id: id,
      course: meeting,
      meeting,
      time,
      name,
      race_name: name,
      racecard_url: `${WEB}/racecards/${id}`,
      date
    });
  });

  return races;
}

async function enrichDate(date) {
  const html = await getHTML(`${WEB}/racecards?date=${encodeURIComponent(date)}`);
  const base = parseDatePage(html, date);
  const out = await mapLimit(base, 4, enrichRace);
  return {
    date,
    races: out.filter(Boolean),
    source: `${WEB}/racecards?date=${encodeURIComponent(date)}`
  };
}

app.get('/api/date', async (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Use date=YYYY-MM-DD' });
    }

    const key = `date:${date}`;
    const hit = cache.get(key);

    if (hit && Date.now() - hit.time < DATE_TTL) {
      return res.json(hit.data);
    }

    const data = await enrichDate(date);
    cache.set(key, { time: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/tomorrow', async (_req, res) => {
  try {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);

    const key = `date:${date}`;
    const hit = cache.get(key);

    if (hit && Date.now() - hit.time < DATE_TTL) {
      return res.json(hit.data);
    }

    const data = await enrichDate(date);
    cache.set(key, { time: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});app.listen(PORT, () => console.log(`Racing app API v3 listening on ${PORT}`));
