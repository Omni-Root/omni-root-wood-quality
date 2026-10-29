// Export CSV — dados brutos das inspeções do período (uma linha por tora).
// Gerado em streaming por lotes keyset: nunca materializa a tabela inteira.
// Formato amigável ao Excel pt-BR: BOM UTF-8, separador ';' e decimal com
// vírgula.
import type express from 'express';
import { fetchInspectionBatch } from '../consultas/exportacao.js';
import { type Filters } from '../consultas/filtros.js';
import { STATUS_LABEL, fmtDateBR } from './rotulos.js';

const BATCH = 1000;

function csvCell(v: string): string {
  // Escapa aspas e envolve o campo se contiver o separador, aspas ou quebra.
  return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function pctBR(conf: number): string {
  return (conf * 100).toFixed(2).replace('.', ',');
}

export async function streamCsv(f: Filters, res: express.Response): Promise<void> {
  const filename = `inspecoes_${f.from}_a_${f.to}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  res.write('﻿'); // BOM UTF-8
  const header = [
    'Data/Hora',
    'Classificacao',
    'Confianca IA (%)',
    'Maquina',
    'Numero de serie',
    'Talhao',
    'Log ID',
  ];
  res.write(header.map(csvCell).join(';') + '\r\n');

  let afterId = 0;
  for (;;) {
    const rows = await fetchInspectionBatch(f, afterId, BATCH);
    if (rows.length === 0) break;
    for (const r of rows) {
      const line = [
        fmtDateBR(r.data),
        STATUS_LABEL[r.status] ?? r.status,
        pctBR(r.confianca),
        r.maquina_modelo ?? '',
        r.maquina_serie ?? '',
        r.talhao_nome ?? '',
        r.log_id,
      ]
        .map(csvCell)
        .join(';');
      res.write(line + '\r\n');
      afterId = r.id;
    }
    if (rows.length < BATCH) break;
  }
  res.end();
}
