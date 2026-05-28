// ==============================
// server.js COMPLETO
// ==============================

import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();

app.use(cors());

app.use((req,res,next)=>{
    res.set("Cache-Control","no-store");
    next();
});

const PORT = process.env.PORT || 3000;

const API_KEY = process.env.API_FOOTBALL_KEY;

// ==============================
// NORMALIZAR JOGOS
// ==============================

function normalizarJogo(f){

    return {

        id: f.fixture.id,

        fontes:["API-Football"],

        cat:"futebol",

        camp:f.league.name,

        pais:f.league.country,

        status:
            f.fixture.status.short === "FT"
            ? "past"
            :
            (
                f.fixture.status.short === "NS"
                ? "future"
                : "live"
            ),

        data:f.fixture.date,

        casa:f.teams.home.name,

        fora:f.teams.away.name,

        placar:
            `${f.goals.home ?? 0}-${f.goals.away ?? 0}`,

        min:
            f.fixture.status.elapsed || 0,

        stats:{
            over25:50,
            btts:50
        }

    };

}

// ==============================
// API PRINCIPAL
// ==============================

app.get("/api/dados", async(req,res)=>{

    try{

        if(!API_KEY){

            return res.json({
                modo:"demo-sem-chave",
                atualizadoEm:new Date(),
                totalJogos:0,
                jogos:[]
            });

        }

        // =========================
        // TODOS OS JOGOS AO VIVO
        // =========================

        const liveReq = await axios.get(

            "https://v3.football.api-sports.io/fixtures?live=all",

            {
                headers:{
                    "x-apisports-key":API_KEY
                }
            }

        );

        const liveJogos =
            liveReq.data.response.map(normalizarJogo);

        // =========================
        // PRÓXIMOS JOGOS
        // =========================

        const nextReq = await axios.get(

            "https://v3.football.api-sports.io/fixtures?next=20",

            {
                headers:{
                    "x-apisports-key":API_KEY
                }
            }

        );

        const futuros =
            nextReq.data.response.map(normalizarJogo);

        // =========================
        // FINAL
        // =========================

        const jogos = [
            ...liveJogos,
            ...futuros
        ];

        res.json({

            modo:"live",

            atualizadoEm:new Date(),

            totalJogos:jogos.length,

            jogos

        });

    }catch(e){

        console.log(e.message);

        res.json({

            modo:"erro",

            erro:e.message,

            jogos:[]

        });

    }

});

app.listen(PORT,()=>{

    console.log("Servidor online na porta",PORT);

});
