import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_BASE = "https://v3.football.api-sports.io";

app.use(cors({ origin: "*" }));
app.use(express.json());

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function apiFootball(path) {
  if (!API_KEY) throw new Error("API_FOOTBALL_KEY não configurada no Render");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "x-apisports-key": API_KEY }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

function categoriaLiga(leagueName = "", country = "") {
  const n = `${leagueName} ${country}`.toLowerCase();
  if (n.includes("cup") || n.includes("copa") || n.includes("taça")) {
    if (n.includes("world") || n.includes("euro") || n.includes("libertadores") || n.includes("sudamericana") || n.includes("champions")) return "copa-internacional";
    return "copa-nacional";
  }
  if (n.includes("champions") || n.includes("europa") || n.includes("libertadores") || n.includes("sudamericana") || n.includes("world") || country === "World") return "internacional";
  return "nacional";
}

function statusNormalizado(short) {
  const live = ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"];
  const past = ["FT", "AET", "PEN"];
  if (live.includes(short)) return "live";
  if (past.includes(short)) return "past";
  return "future";
}

function normalizarFixture(item) {
  const statusShort = item.fixture?.status?.short || "NS";
  const homeGoals = item.goals?.home;
  const awayGoals = item.goals?.away;
  const placar = homeGoals === null || homeGoals === undefined ? "-" : `${homeGoals}-${awayGoals}`;
  const casaProb = 38 + Math.floor(Math.random() * 24);
  const empateProb = 20 + Math.floor(Math.random() * 14);
  const foraProb = Math.max(5, 100 - casaProb - empateProb);
  return {
    id: String(item.fixture?.id || Math.random()),
    fontes: ["API-Football"],
    cat: categoriaLiga(item.league?.name, item.league?.country),
    camp: item.league?.name || "Liga",
    pais: item.league?.country || "",
    status: statusNormalizado(statusShort),
    data: (item.fixture?.date || "").replace("T", " ").slice(0, 16),
    casa: item.teams?.home?.name || "Mandante",
    fora: item.teams?.away?.name || "Visitante",
    placar,
    min: item.fixture?.status?.elapsed || null,
    xg: [Number((1.05 + Math.random() * 1.15).toFixed(2)), Number((0.85 + Math.random() * 1.05).toFixed(2))],
    stats: {
      pos: [50, 50],
      fin: [0, 0],
      gol: [0, 0],
      esc: [0, 0],
      over25: 40 + Math.floor(Math.random() * 31),
      btts: 38 + Math.floor(Math.random() * 29),
      casa: casaProb,
      empate: empateProb,
      fora: foraProb
    },
    eventos: [],
    logos: {
      casa: item.teams?.home?.logo || "",
      fora: item.teams?.away?.logo || "",
      liga: item.league?.logo || ""
    }
  };
}

function montarTimes(jogos) {
  const map = new Map();
  for (const j of jogos) {
    for (const nome of [j.casa, j.fora]) {
      if (!map.has(nome)) {
        map.set(nome, {
          nome,
          pais: j.pais,
          camp: [j.camp],
          fontes: j.fontes,
          forma: 50,
          gp: 0,
          gc: 0,
          btts: 0,
          over25: 0,
          last: "-"
        });
      } else {
        const t = map.get(nome);
        if (!t.camp.includes(j.camp)) t.camp.push(j.camp);
      }
    }
  }
  return [...map.values()];
}

function montarOdds(jogos) {
  return jogos.slice(0, 80).map(j => {
    const casa = +(1 / Math.max(0.05, j.stats.casa / 100) * 1.04).toFixed(2);
    const empate = +(1 / Math.max(0.05, j.stats.empate / 100) * 1.05).toFixed(2);
    const fora = +(1 / Math.max(0.05, j.stats.fora / 100) * 1.04).toFixed(2);
    return {
      jogo: j.id,
      mercado: "Match Odds",
      back: { casa, empate, fora },
      lay: { casa: +(casa + 0.06).toFixed(2), empate: +(empate + 0.10).toFixed(2), fora: +(fora + 0.08).toFixed(2) }
    };
  });
}

const demoJogos = [
  { id:"demo-el-geish", fontes:["Demo"], cat:"nacional", camp:"Egypt Premier League", pais:"Egypt", status:"live", data:"2026-05-28 12:00", casa:"El Geish", fora:"Wadi Degla SC", placar:"0-0", min:22, xg:[0.32,0.18], stats:{pos:[53,47],fin:[3,2],gol:[1,0],esc:[2,1],over25:42,btts:45,casa:41,empate:33,fora:26}, eventos:[], logos:{} },
  { id:"demo-2", fontes:["Demo"], cat:"nacional", camp:"La Liga", pais:"Spain", status:"live", data:"2026-05-28 16:30", casa:"Barcelona", fora:"Sevilla", placar:"1-0", min:38, xg:[1.12,.34], stats:{pos:[63,37],fin:[9,3],gol:[4,1],esc:[5,1],over25:64,btts:48,casa:66,empate:20,fora:14}, eventos:[["12","Gol","Barcelona","Atacante 9"]], logos:{} },
  { id:"demo-3", fontes:["Demo"], cat:"nacional", camp:"Brasileirão Série A", pais:"Brazil", status:"future", data:"2026-05-31 18:00", casa:"Flamengo", fora:"Palmeiras", placar:"-", min:null, xg:[1.39,1.26], stats:{pos:[52,48],fin:[12,11],gol:[4,4],esc:[5,5],over25:47,btts:55,casa:39,empate:30,fora:31}, eventos:[], logos:{} }
];

async function carregarDadosReais() {
  const liveResp = await apiFootball("/fixtures?live=all");
  let jogos = (liveResp.response || []).map(normalizarFixture);

  if (jogos.length < 20) {
    const date = todayISO();
    const todayResp = await apiFootball(`/fixtures?date=${date}`);
    const hoje = (todayResp.response || []).map(normalizarFixture);
    const ids = new Set(jogos.map(j => j.id));
    for (const j of hoje) if (!ids.has(j.id)) jogos.push(j);
  }

  if (jogos.length < 40) {
    const nextResp = await apiFootball(`/fixtures?from=${todayISO()}&to=${addDaysISO(2)}`);
    const proximos = (nextResp.response || []).map(normalizarFixture);
    const ids = new Set(jogos.map(j => j.id));
    for (const j of proximos) if (!ids.has(j.id)) jogos.push(j);
  }

  return {
    atualizadoEm: new Date().toISOString(),
    modo: "real-api-football",
    jogos,
    times: montarTimes(jogos),
    odds: montarOdds(jogos)
  };
}

app.get("/", (req, res) => {
  res.json({ ok: true, nome: "BetStats Arena API", rotas: ["/api/dados", "/api/status"] });
});

app.get("/api/status", (req, res) => {
  res.json({ ok: true, apiFootballConfigurada: Boolean(API_KEY), atualizadoEm: new Date().toISOString() });
});

app.get("/api/dados", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.json({ atualizadoEm: new Date().toISOString(), modo: "demo-sem-chave", jogos: demoJogos, times: montarTimes(demoJogos), odds: montarOdds(demoJogos) });
    }
    const dados = await carregarDadosReais();
    res.json(dados);
  } catch (err) {
    res.status(200).json({ atualizadoEm: new Date().toISOString(), modo: "demo-erro-api", erro: err.message, jogos: demoJogos, times: montarTimes(demoJogos), odds: montarOdds(demoJogos) });
  }
});

app.listen(PORT, () => console.log(`BetStats API rodando na porta ${PORT}`));
