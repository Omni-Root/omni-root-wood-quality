// Exportações (exigem sessão): CSV, relatório PDF e StanForD 2010 (.hpr em ZIP).
import express from 'express';
import { requireAuth } from '../auth.js';
import { exportRoute } from '../http.js';
import { streamCsv } from '../exportacoes/csv.js';
import { streamPdf } from '../exportacoes/pdf.js';
import { streamStanford } from '../exportacoes/stanford.js';

export const rotasExportacoes = express.Router();

rotasExportacoes.get('/api/export/csv', requireAuth, exportRoute(streamCsv));
rotasExportacoes.get('/api/export/pdf', requireAuth, exportRoute(streamPdf));
rotasExportacoes.get('/api/export/stanford', requireAuth, exportRoute(streamStanford));
