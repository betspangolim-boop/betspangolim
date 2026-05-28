import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import { demoData } from './demo-data.js';

dotenv.config();
const app = express();
const cache = new NodeCache({ stdTTL: 45 });
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const footballBase = 'https://v3.football.api-sports.io';
function statusOf(short) {
  if (short === 'NS' || short === 'TBD') return 'future';
  if (['FT','AET','PEN'].includes(short)) return 'past';
  return 'live';
}
function catOf(leagueName = '') {
  const n = leagueName.toLowerCase();
  if (n.includes('cup') || n.includes('copa') || n.includes('taça')) return n.includes('world') || n.includes('champions') || n.includes('libertadores') || n.includes('sudamericana') ? 'copa-internacional' : 'copa-nacional';
  if (n.includes('champions') || n.includes('libertadores') || n.includes('world') || n.includes('europa')) return 'internacional';
  return 'nacional';
}
function blankStats() { return { pos:[50,50], fin:[0,0], gol:[0,0], esc:[0,0], over25:50, btts:50, casa:34, empate:33, fora:33 }; }
function normalizeFixture(f) {
  const goalsHome = f?.goals?.home;
  const goalsAway = f?.goals?.away;
  return {
    id: String(f.fixture.id), fontes:['API-Football'], cat:catOf(f.league.name), camp:f.league.name, pais:f.league.country || '',
    status: statusOf(f.fixture.status.short), data: String(f.fixture.date || '').replace('T',' ').slice(0,16),
    casa:f.teams.home.name, fora:f.teams.away.name, placar: goalsHome === null || goalsHome === undefined ? '-' : `${goalsHome}-${goalsAway}`,
    min:f.fixture.status.elapsed || null, xg:[1.25,1.05], stats:blankStats(), eventos:[]
  };
}
async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.json();
}
async function football(path) {
  if (!process.env.API_FOOTBALL_KEY) return null;
  return fetchJson(`${footballBase}${path}`, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }});
}
async function getFootballFixtures() {
  const key = 'football-fixtures';
  const cached = cache.get(key); if (cached) return cached;
  const today = new Date().toISOString().slice(0,10);
  const [todayResp, liveResp] = await Promise.allSettled([
    football(`/fixtures?date=${today}`), football(`/fixtures?live=all`)
  ]);
  let arr = [];
  for (const res of [todayResp, liveResp]) if (res.status === 'fulfilled' && res.value?.response) arr.push(...res.value.response.map(normalizeFixture));
  arr = [...new Map(arr.map(x => [x.id,x])).values()];
  cache.set(key, arr); return arr;
}
async function getOdds() {
  const key = 'odds'; const cached = cache.get(key); if (cached) return cached;
  if (!process.env.ODDS_API_KEY) return [];
  const sport = process.env.ODDS_API_SPORT || 'soccer_epl';
  const regions = process.env.ODDS_API_REGIONS || 'eu,uk';
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=${regions}&markets=h2h&oddsFormat=decimal`;
  const raw = await fetchJson(url);
  const odds = raw.map((event, idx) => {
    const book = event.bookmakers?.[0]; const m = book?.markets?.find(x => x.key === 'h2h');
    const home = m?.outcomes?.find(o => o.name === event.home_team)?.price || 2;
    const away = m?.outcomes?.find(o => o.name === event.away_team)?.price || 3;
    const draw = m?.outcomes?.find(o => /draw/i.test(o.name))?.price || 3.2;
    return { jogo: event.id || `odds-${idx}`, jogoNome:`${event.home_team} x ${event.away_team}`, mercado:'Match Odds', back:{casa:home,empate:draw,fora:away}, lay:{casa:+(home*1.03).toFixed(2), empate:+(draw*1.03).toFixed(2), fora:+(away*1.03).toFixed(2)}, fonte:'The Odds API' };
  });
  cache.set(key, odds); return odds;
}
function buildTeams(jogos) {
  const map = new Map();
  for (const j of jogos) for (const nome of [j.casa, j.fora]) if (!map.has(nome)) map.set(nome, { nome, pais:j.pais, camp:[j.camp], fontes:j.fontes, forma:50, gp:0, gc:0, btts:0, over25:0, last:'-' });
  return [...map.values()];
}
async function fetchCustomProxy(url) {
  if (!url) return { jogos:[], times:[], odds:[] };
  const headers = process.env.PROXY_TOKEN ? { Authorization:`Bearer ${process.env.PROXY_TOKEN}` } : {};
  return fetchJson(url, { headers });
}
app.get('/api/health', (_, res) => res.json({ ok:true, apiFootball:!!process.env.API_FOOTBALL_KEY, odds:!!process.env.ODDS_API_KEY }));
app.get('/api/dados', async (_, res) => {
  try {
    let jogos = [], times = [], odds = [];
    const proxyUrls = [process.env.SOFASCORE_PROXY_URL, process.env.AISCORE_PROXY_URL, process.env.FULLTBET_PROXY_URL].filter(Boolean);
    if (proxyUrls.length) {
      const out = await Promise.allSettled(proxyUrls.map(fetchCustomProxy));
      for (const r of out) if (r.status === 'fulfilled') { jogos.push(...(r.value.jogos||[])); times.push(...(r.value.times||[])); odds.push(...(r.value.odds||[])); }
    }
    try { jogos.push(...await getFootballFixtures()); } catch (e) { console.warn(e.message); }
    try { odds.push(...await getOdds()); } catch (e) { console.warn(e.message); }
    if (!jogos.length) jogos = demoData.jogos;
    if (!times.length) times = buildTeams(jogos);
    if (!odds.length) odds = demoData.odds;
    res.json({ atualizadoEm:new Date().toISOString(), modo: process.env.API_FOOTBALL_KEY || proxyUrls.length ? 'online' : 'demo', jogos, times, odds });
  } catch (e) { res.status(500).json({ erro:e.message }); }
});
app.listen(PORT, () => console.log(`BetStats Arena rodando em http://localhost:${PORT}`));
