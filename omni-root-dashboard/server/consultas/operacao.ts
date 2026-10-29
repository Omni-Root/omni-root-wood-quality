// Consultas de OPERAÇÃO — resumo, série temporal, mapa de calor e máquinas.
import { pool } from '../db.js';
import type { Bucket, Status } from '../validate.js';
import { RANGE_WHERE, type Filters } from './filtros.js';

export async function listMaquinas() {
  const { rows } = await pool.query(
    `SELECT id_maquina AS id, modelo, numero_serie
     FROM maquinas
     ORDER BY modelo, numero_serie`,
  );
  return rows as { id: number; modelo: string; numero_serie: string }[];
}

export async function getSummary(f: Filters) {
  const { rows } = await pool.query(
    `SELECT status_classificacao AS status, COUNT(*)::int AS total
     FROM toras_inspecionadas
     WHERE ${RANGE_WHERE}
     GROUP BY status_classificacao`,
    [f.from, f.to, f.maquinaId],
  );
  return rows as { status: Status; total: number }[];
}

// Passo de cada granularidade, para preencher os intervalos vazios.
const PASSO: Record<Bucket, string> = {
  minute: '1 minute',
  hour: '1 hour',
  day: '1 day',
  week: '1 week',
};
// Acima disso, não preenche (30 dias por minuto seriam 43 mil pontos): devolve
// só os intervalos com dado, como antes.
const MAX_PONTOS_PREENCHIDOS = 3000;

export async function getTimeseries(f: Filters, bucket: Bucket) {
  // date_trunc aceita a unidade como parâmetro text; ainda assim `bucket` já
  // chegou aqui validado contra a whitelist em validate.ts.
  //
  // Intervalos SEM inspeção entram como zero, do primeiro ao último intervalo
  // com dado: um gráfico de linha precisa de eixo contínuo — sem isso, "por
  // hora" com dado numa hora só virava um ponto solto, e na demonstração
  // (5 minutos de inspeções) a linha não se formava.
  const { rows } = await pool.query(
    `WITH agg AS (
       SELECT date_trunc($4, data_inspecao) AS b,
              COUNT(*) FILTER (WHERE status_classificacao = 'aprovado')::int   AS aprovado,
              COUNT(*) FILTER (WHERE status_classificacao = 'quarentena')::int AS quarentena,
              COUNT(*) FILTER (WHERE status_classificacao = 'reprovado')::int  AS reprovado
       FROM toras_inspecionadas
       WHERE ${RANGE_WHERE}
       GROUP BY 1
     ),
     lim AS (SELECT MIN(b) AS b0, MAX(b) AS b1, COUNT(*) AS n FROM agg),
     eixo AS (
       SELECT gs AS b
       FROM lim, generate_series(lim.b0, lim.b1, $5::interval) AS gs
       WHERE lim.n > 0
         AND (EXTRACT(EPOCH FROM (lim.b1 - lim.b0)) / EXTRACT(EPOCH FROM $5::interval)) <= $6
       UNION
       SELECT b FROM agg
     )
     SELECT to_char(eixo.b, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
            COALESCE(agg.aprovado, 0)   AS aprovado,
            COALESCE(agg.quarentena, 0) AS quarentena,
            COALESCE(agg.reprovado, 0)  AS reprovado
     FROM eixo LEFT JOIN agg ON agg.b = eixo.b
     ORDER BY eixo.b`,
    [f.from, f.to, f.maquinaId, bucket, PASSO[bucket], MAX_PONTOS_PREENCHIDOS],
  );
  return rows as { bucket: string; aprovado: number; quarentena: number; reprovado: number }[];
}

export async function getHeatmap(f: Filters, statuses: Status[]) {
  // dow: 0 = domingo ... 6 = sábado (convenção do EXTRACT(DOW) do Postgres)
  const { rows } = await pool.query(
    `SELECT EXTRACT(DOW FROM data_inspecao)::int  AS dow,
            EXTRACT(HOUR FROM data_inspecao)::int AS hora,
            COUNT(*)::int AS total
     FROM toras_inspecionadas
     WHERE ${RANGE_WHERE}
       AND status_classificacao = ANY($4::text[])
     GROUP BY 1, 2`,
    [f.from, f.to, f.maquinaId, statuses],
  );
  return rows as { dow: number; hora: number; total: number }[];
}
