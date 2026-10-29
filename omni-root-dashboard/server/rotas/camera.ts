// Câmera ao vivo.
// A máquina de campo (main.py) EMPURRA quadros JPEG para cá, autenticada por
// STREAM_TOKEN — é a única rota que recebe dados de fora, e nada dela toca o
// Postgres (fica só o último quadro em memória). O navegador assiste via
// MJPEG, com a mesma sessão das outras rotas.
import express from 'express';
import { requireAuth } from '../auth.js';
import { cameraLigada, listarCameras, receberQuadro, streamCamera } from '../camera.js';
import { ehEconomico } from '../economia.js';

export const rotasCamera = express.Router();

rotasCamera.post('/api/camera/frame', express.raw({ type: 'image/jpeg', limit: '2mb' }), receberQuadro);
rotasCamera.get('/api/camera/maquinas', requireAuth, (_req, res) => {
  res.json({ ligada: cameraLigada(), maquinas: listarCameras() });
});
// Celular pelo túnel: vídeo menor, no fps da lotação (server/economia.ts).
rotasCamera.get('/api/camera/stream', requireAuth, async (req, res) => streamCamera(req, res, await ehEconomico(req)));
