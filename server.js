import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY || "";
const BASE = "https://v3.football.api-sports.io";

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

const cache = new Map();
const TTL = {
  live: 7000,
  detail: 12000,
  future: 60000,
  odds: 120000,
  standings: 300000
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function football(path, params = {}, ttl = 15000) {
  if (!API_KEY) throw new Error("API_FOOTBALL_KEY ausente no Render");
  const key = path + JSON.stringify(params);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < ttl) return cached.data;

  const { data } = await axios.get(BASE + path, {
    params,
    timeout: 15000,
    headers: { "x-apisports-key": API_KEY }
  });

  cache.set(key, { at: Date.now(), data });
  return data;
}

function apiStatus(short) {
  if (short === "NS" || short === "TBD") return "future";
  if (["FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"].includes(short)) return "past";
  return "live";
}

function category(leagueName = "", country = "") {
  const n = leagueName.toLowerCase();
  const c = country.toLowerCase();
  if (n.includes("cup") || n.includes("copa") || n.includes("taça")) {
    if (["world", "europe", "asia", "africa", "south america", "north america"].some(x => c.includes(x))) return "copa-internacional";
    if (["champions", "libertadores", "sudamericana", "conference", "europa"].some(x => n.includes(x))) return "copa-internacional";
    return "copa-nacional";
  }
  if (["world", "europe", "asia", "africa", "south america", "north america"].some(x => c.includes(x))) return "internacional";
  if (["champions", "libertadores", "sudamericana", "conference", "europa", "club world"].some(x => n.includes(x))) return "internacional";
  return "nacional";
}

function safeNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeFixture(item) {
  const short = item.fixture?.status?.short || "NS";
  const elapsed = item.fixture?.status?.elapsed || null;
  const homeGoals = item.goals?.home;
  const awayGoals = item.goals?.away;
  const home = item.teams?.home || {};
  const away = item.teams?.away || {};
  const league = item.league || {};
  return {
    id: String(item.fixture?.id || ""),
    apiId: item.fixture?.id,
    fontes: ["API-Football"],
    cat: category(league.name, league.country),
    camp: league.name || "Competição",
    pais: league.country || "",
    logoLiga: league.logo || "",
    temporada: league.season || "",
    rodada: league.round || "",
    status: apiStatus(short),
    statusApi: short,
    statusTexto: item.fixture?.status?.long || "",
    data: item.fixture?.date || "",
    timestamp: item.fixture?.timestamp || 0,
    estadio: item.fixture?.venue?.name || "",
    cidade: item.fixture?.venue?.city || "",
    casa: home.name || "Mandante",
    fora: away.name || "Visitante",
    casaId: home.id || null,
    foraId: away.id || null,
    logoCasa: home.logo || "",
    logoFora: away.logo || "",
    placar: homeGoals === null || homeGoals === undefined ? "-" : `${homeGoals}-${awayGoals ?? 0}`,
    golsCasa: homeGoals ?? null,
    golsFora: awayGoals ?? null,
    min: elapsed,
    intervalo: {
      casa: item.score?.halftime?.home ?? null,
      fora: item.score?.halftime?.away ?? null
    },
    score: item.score || {},
    xg: [1.2, 1.1],
    stats: {
      pos: [0, 0],
      fin: [0, 0],
      gol: [0, 0],
      esc: [0, 0],
      faltas: [0, 0],
      impedimentos: [0, 0],
      amarelos: [0, 0],
      vermelhos: [0, 0],
      passes: [0, 0],
      precisaoPasses: [0, 0],
      over25: 50,
      btts: 50,
      casa: 33,
      empate: 34,
      fora: 33
    },
    eventos: [],
    lineups: [],
    odds: null,
    atualizadoEm: new Date().toISOString()
  };
}

function statValue(statistics, type) {
  const found = statistics?.find(s => s.type === type);
  if (!found) return 0;
  const value = found.value;
  if (typeof value === "string" && value.includes("%")) return safeNumber(value.replace("%", ""));
  return safeNumber(value);
}

function applyStatistics(fixture, statsResp = []) {
  const home = statsResp[0]?.statistics || [];
  const away = statsResp[1]?.statistics || [];
  const shotsHome = statValue(home, "Total Shots");
  const shotsAway = statValue(away, "Total Shots");
  const onHome = statValue(home, "Shots on Goal");
  const onAway = statValue(away, "Shots on Goal");
  const cornersHome = statValue(home, "Corner Kicks");
  const cornersAway = statValue(away, "Corner Kicks");
  const posHome = statValue(home, "Ball Possession");
  const posAway = statValue(away, "Ball Possession");

  fixture.stats = {
    ...fixture.stats,
    pos: [posHome, posAway],
    fin: [shotsHome, shotsAway],
    gol: [onHome, onAway],
    esc: [cornersHome, cornersAway],
    faltas: [statValue(home, "Fouls"), statValue(away, "Fouls")],
    impedimentos: [statValue(home, "Offsides"), statValue(away, "Offsides")],
    amarelos: [statValue(home, "Yellow Cards"), statValue(away, "Yellow Cards")],
    vermelhos: [statValue(home, "Red Cards"), statValue(away, "Red Cards")],
    passes: [statValue(home, "Total passes"), statValue(away, "Total passes")],
    precisaoPasses: [statValue(home, "Passes %"), statValue(away, "Passes %")]
  };

  const pressure = shotsHome + shotsAway + onHome * 2 + onAway * 2 + cornersHome + cornersAway;
  fixture.stats.over25 = Math.max(25, Math.min(82, Math.round(35 + pressure * 1.3)));
  fixture.stats.btts = Math.max(20, Math.min(78, Math.round(38 + Math.min(onHome, onAway) * 8 + Math.min(shotsHome, shotsAway) * 1.5)));
  const homeIndex = 33 + onHome * 5 + shotsHome * 1.2 + cornersHome - onAway * 2;
  const awayIndex = 33 + onAway * 5 + shotsAway * 1.2 + cornersAway - onHome * 2;
  const drawIndex = 28 + Math.max(0, 12 - Math.abs(homeIndex - awayIndex));
  const total = Math.max(1, homeIndex + awayIndex + drawIndex);
  fixture.stats.casa = Math.round(homeIndex / total * 100);
  fixture.stats.empate = Math.round(drawIndex / total * 100);
  fixture.stats.fora = Math.max(0, 100 - fixture.stats.casa - fixture.stats.empate);
  fixture.xg = [Number((0.25 + shotsHome * 0.06 + onHome * 0.18).toFixed(2)), Number((0.25 + shotsAway * 0.06 + onAway * 0.18).toFixed(2))];
  return fixture;
}

function normalizeEvents(events = []) {
  return events.map(e => ({
    minuto: e.time?.elapsed || 0,
    extra: e.time?.extra || null,
    time: e.team?.name || "",
    timeLogo: e.team?.logo || "",
    jogador: e.player?.name || "",
    assistencia: e.assist?.name || "",
    tipo: e.type || "",
    detalhe: e.detail || "",
    comentario: e.comments || ""
  }));
}

function normalizeLineups(lineups = []) {
  return lineups.map(l => ({
    time: l.team?.name || "",
    logo: l.team?.logo || "",
    tecnico: l.coach?.name || "",
    formacao: l.formation || "",
    titulares: (l.startXI || []).map(x => ({
      nome: x.player?.name || "",
      numero: x.player?.number || "",
      pos: x.player?.pos || "",
      grid: x.player?.grid || ""
    })),
    reservas: (l.substitutes || []).slice(0, 12).map(x => ({
      nome: x.player?.name || "",
      numero: x.player?.number || "",
      pos: x.player?.pos || ""
    }))
  }));
}

function demoData() {
  const now = new Date().toISOString();
  return {
    atualizadoEm: now,
    modo: "demo-sem-chave-ou-limite",
    mensagem: "Configure API_FOOTBALL_KEY no Render para dados reais.",
    jogos: [
      {
        id: "demo-1", fontes: ["Demo"], cat: "nacional", camp: "Egypt Premier League", pais: "Egito", status: "live", statusTexto: "Second Half", data: now, casa: "El Geish", fora: "Wadi Degla SC", placar: "0-0", min: 58,
        logoCasa: "", logoFora: "", rodada: "Regular Season", estadio: "Demo Stadium", cidade: "Cairo", intervalo: { casa: 0, fora: 0 }, xg: [0.92, 0.48],
        stats: { pos: [54,46], fin: [9,4], gol: [3,1], esc: [5,2], faltas: [8,10], impedimentos: [1,0], amarelos: [1,2], vermelhos: [0,0], passes: [290,244], precisaoPasses: [82,76], over25: 47, btts: 41, casa: 44, empate: 34, fora: 22 },
        eventos: [{ minuto: 32, tipo: "Card", detalhe: "Yellow Card", time: "Wadi Degla SC", jogador: "Player Demo" }],
        lineups: [], odds: null
      }
    ],
    times: [],
    odds: []
  };
}

async function enrichFixture(fixture) {
  const id = fixture.apiId || fixture.id;
  const results = await Promise.allSettled([
    football("/fixtures/statistics", { fixture: id }, TTL.detail),
    football("/fixtures/events", { fixture: id }, TTL.detail),
    football("/fixtures/lineups", { fixture: id }, TTL.detail)
  ]);

  if (results[0].status === "fulfilled") applyStatistics(fixture, results[0].value.response || []);
  if (results[1].status === "fulfilled") fixture.eventos = normalizeEvents(results[1].value.response || []);
  if (results[2].status === "fulfilled") fixture.lineups = normalizeLineups(results[2].value.response || []);
  return fixture;
}

async function getLiveFixtures() {
  const live = await football("/fixtures", { live: "all" }, TTL.live);
  const fixtures = (live.response || []).map(normalizeFixture);
  const enriched = await Promise.all(fixtures.slice(0, 40).map(enrichFixture));
  return enriched;
}

async function getFutureFixtures() {
  const next = await football("/fixtures", { next: 40 }, TTL.future);
  return (next.response || []).map(normalizeFixture);
}

async function getTodayFixtures() {
  const today = await football("/fixtures", { date: todayISO() }, TTL.future);
  return (today.response || []).map(normalizeFixture);
}

function buildTeams(jogos) {
  const map = new Map();
  for (const j of jogos) {
    for (const side of ["casa", "fora"]) {
      const nome = j[side];
      const logo = side === "casa" ? j.logoCasa : j.logoFora;
      if (!nome) continue;
      if (!map.has(nome)) {
        map.set(nome, { nome, logo, pais: j.pais, camp: [j.camp], fontes: j.fontes, forma: 50, gp: 0, gc: 0, btts: 0, over25: 0, jogos: 0, last: "-" });
      } else {
        const t = map.get(nome);
        if (!t.camp.includes(j.camp)) t.camp.push(j.camp);
      }
    }
  }
  return Array.from(map.values());
}

app.get("/api/status", (req, res) => {
  res.json({ ok: true, apiKeyConfigurada: Boolean(API_KEY), atualizadoEm: new Date().toISOString() });
});

app.get("/api/live", async (req, res) => {
  try {
    if (!API_KEY) return res.json(demoData());
    const jogos = await getLiveFixtures();
    res.json({ modo: "live", atualizadoEm: new Date().toISOString(), totalJogos: jogos.length, jogos, times: buildTeams(jogos), odds: [] });
  } catch (err) {
    res.status(200).json({ modo: "erro", erro: err.message, atualizadoEm: new Date().toISOString(), jogos: [], times: [], odds: [] });
  }
});

app.get("/api/jogo/:id", async (req, res) => {
  try {
    if (!API_KEY) return res.json({ modo: "demo", jogo: demoData().jogos[0] });
    const fix = await football("/fixtures", { id: req.params.id }, TTL.detail);
    const base = (fix.response || [])[0];
    if (!base) return res.status(404).json({ erro: "Jogo não encontrado" });
    const jogo = await enrichFixture(normalizeFixture(base));
    res.json({ modo: "live", atualizadoEm: new Date().toISOString(), jogo });
  } catch (err) {
    res.status(200).json({ modo: "erro", erro: err.message, jogo: null });
  }
});

app.get("/api/dados", async (req, res) => {
  try {
    if (!API_KEY) return res.json(demoData());
    const [live, today, future] = await Promise.allSettled([getLiveFixtures(), getTodayFixtures(), getFutureFixtures()]);
    const all = [];
    for (const r of [live, today, future]) if (r.status === "fulfilled") all.push(...r.value);
    const seen = new Set();
    const jogos = all.filter(j => {
      if (!j.id || seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    }).sort((a, b) => {
      if (a.status === "live" && b.status !== "live") return -1;
      if (a.status !== "live" && b.status === "live") return 1;
      return (a.timestamp || 0) - (b.timestamp || 0);
    });
    res.json({ modo: "live", atualizadoEm: new Date().toISOString(), totalJogos: jogos.length, jogos, times: buildTeams(jogos), odds: [] });
  } catch (err) {
    res.status(200).json({ modo: "erro", erro: err.message, atualizadoEm: new Date().toISOString(), jogos: [], times: [], odds: [] });
  }
});

app.get("/", (req, res) => {
  res.type("html").send(`<h1>BetStats API online</h1><p>Use <a href="/api/dados">/api/dados</a> ou <a href="/api/live">/api/live</a>.</p>`);
});

app.listen(PORT, () => console.log(`BetStats API online na porta ${PORT}`));
