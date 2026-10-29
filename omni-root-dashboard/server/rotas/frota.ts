// Frota (ver server/frota.ts): a máquina EMPURRA a posição atual (token da
// máquina, como a câmera); o navegador lê a frota e o trajeto (sessão).
import express from 'express';
import { requireAuth } from '../auth.js';
import { getRastro, listarFrota, receberPosicao } from '../frota.js';
import { filtersFrom, route } from '../http.js';

export const rotasFrota = express.Router();

rotasFrota.post('/api/maquinas/posicao', receberPosicao); // JSON já lido pelo express.json do app.ts
rotasFrota.get('/api/frota', requireAuth, route(() => listarFrota()));
rotasFrota.get('/api/frota/rastro', requireAuth, route((req) => getRastro(filtersFrom(req))));
