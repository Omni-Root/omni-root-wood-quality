// Dados dos painéis (exigem sessão): operação, indicadores de qualidade, mapa,
// alerta de tendência e o canal de tempo real (SSE).
import express from 'express';
import { requireAuth } from '../auth.js';
import { rotaEventos } from '../live.js';
import { filtersFrom, route } from '../http.js';
import { parseBucket, parseMaquinaId, parseStatuses } from '../validate.js';
import { getHeatmap, getSummary, getTimeseries, listMaquinas } from '../consultas/operacao.js';
import { getQualidade, getUltimaInspecao } from '../consultas/qualidade.js';
import { getMapa } from '../consultas/mapa.js';
import { getTendencia } from '../consultas/tendencia.js';

export const rotasPainel = express.Router();

// ---- Operação ----
rotasPainel.get('/api/maquinas', requireAuth, route(() => listMaquinas()));

rotasPainel.get('/api/summary', requireAuth, route((req) => getSummary(filtersFrom(req))));

rotasPainel.get('/api/timeseries', requireAuth, route((req) =>
  getTimeseries(filtersFrom(req), parseBucket(req.query.bucket)),
));

rotasPainel.get('/api/heatmap', requireAuth, route((req) =>
  getHeatmap(filtersFrom(req), parseStatuses(req.query.statuses)),
));

// ---- Indicadores de qualidade ----
// Última inspeção: só filtro de máquina (é o cartão ao vivo, independe do período).
rotasPainel.get('/api/ultima', requireAuth, route((req) => getUltimaInspecao(parseMaquinaId(req.query.maquinaId))));
rotasPainel.get('/api/qualidade', requireAuth, route((req) => getQualidade(filtersFrom(req))));
// Mapa de qualidade: toras com posição (GNSS) agregadas em células de ~25 m.
rotasPainel.get('/api/mapa', requireAuth, route((req) => getMapa(filtersFrom(req))));
// Alerta de tendência (várias toras seguidas acima do limite na mesma máquina):
// como a "última inspeção", independe do período — é o agora; só filtra máquina.
rotasPainel.get('/api/tendencia', requireAuth, route((req) => getTendencia(parseMaquinaId(req.query.maquinaId))));

// ---- Tempo real: SSE com avisos de tora nova ----
rotasPainel.get('/api/events', requireAuth, rotaEventos);
