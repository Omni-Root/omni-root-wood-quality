// Consultas dos INDICADORES DE QUALIDADE — o que o desafio pede (casca,
// tortuosidade, densidade, volume/massa) e que até aqui só saía no export
// StanForD. Tudo lê `indicadores_qualidade` (8 linhas por tora, gravadas pelo
// main.py do repositório principal) e, quando existe, `clones_densidade`
// (proveniência e faixa da densidade por clone).
//
// Fica num módulo separado de queries.ts de propósito: são painéis novos, com
// SQL próprio, e assim não misturam com as consultas de operação.
import { pool } from '../db.js';
import { celulosePrevistaT, consumoEspecifico, faixaConsumo, origemCombinada } from './consumo.js';
import { getPosicaoTora, type PosicaoTora } from './mapa.js';
import type { Filters } from './filtros.js';
import type { Status } from '../validate.js';

// ------------------------------------------------------------
// clones_densidade (e as colunas de rendimento dela) vêm do
// setup_completo.sql do repo principal e podem faltar num banco que ainda
// não rodou a versão nova. O dashboard não pode cair por isso: confere e
// adapta o SQL. Só o "existe" fica guardado; o "não existe" é conferido de
// novo a cada 30 s, para o painel enxergar o banco atualizado sem precisar
// reiniciar o servidor.
// ------------------------------------------------------------
const RECHECAR_MS = 30_000;

function verificacaoComCache(sql: string): () => Promise<boolean> {
  let existe = false;
  let conferidoEm = 0;
  return async () => {
    if (existe || Date.now() - conferidoEm < RECHECAR_MS) return existe;
    const { rows } = await pool.query(sql);
    existe = Boolean((rows[0] as { existe: boolean }).existe);
    conferidoEm = Date.now();
    return existe;
  };
}

const temTabelaClones = verificacaoComCache(
  `SELECT to_regclass('public.clones_densidade') IS NOT NULL AS existe`,
);

const temColunasRendimento = verificacaoComCache(
  `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'clones_densidade' AND column_name = 'rendimento_depurado') AS existe`,
);

// O clone não é coluna da tora: o main.py grava o lookup de densidade como
// metodo_medicao = 'lookup_clone_<ID>'. É daí que o clone de cada tora sai.
const CLONE_SQL = `substring(i.metodo_medicao from '^lookup_clone_(.+)$')`;

// Uma linha por tora com os indicadores pivotados. `tort` só existe quando
// foi medida de verdade (vista lateral) — na seção o main.py grava 0 com
// metodo 'nao_aplicavel_secao', e esse 0 não pode entrar em média nenhuma.
const PIVOT_POR_TORA = `
  SELECT t.id, t.talhao_id, t.maquina_id, t.status_classificacao,
         MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'porcentagem_casca')::float AS casca,
         MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'tortuosidade'
                                AND i.metodo_medicao LIKE 'opencv%')::float      AS tort,
         MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'diametro')::float          AS diam,
         MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'volume_util')::float       AS volume,
         MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'massa_seca')::float        AS massa,
         MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'densidade')::float         AS densidade,
         MAX(${CLONE_SQL}) FILTER (WHERE i.tipo_indicador = 'densidade')          AS clone
  FROM toras_inspecionadas t
  JOIN indicadores_qualidade i ON i.tora_id = t.id
  WHERE t.data_inspecao >= $1::date
    AND t.data_inspecao < $2::date + INTERVAL '1 day'
    AND ($3::int IS NULL OR t.maquina_id = $3::int)
  GROUP BY t.id
`;

// ============================================================
// Última inspeção (cartão ao vivo)
// ============================================================

export interface DensidadeInfo {
  valor: number | null; // kg/m3 usado pelo pipeline
  clone: string | null;
  tipo_dado: 'laboratorio' | 'literatura' | 'referencia_generica' | null;
  min: number | null;
  max: number | null;
  fonte: string | null;
}

export interface UltimaInspecao {
  id: number;
  data: string; // "YYYY-MM-DDTHH:mm:ss"
  status: Status;
  confianca: number;
  log_id: string;
  maquina_modelo: string | null;
  maquina_serie: string | null;
  talhao_nome: string | null;
  vista: 'secao' | 'lateral' | 'desconhecida';
  diametro_cm: number | null;
  comprimento_cm: number | null;
  comprimento_medido: boolean; // false = comprimento de traçamento do config
  tortuosidade: number | null; // null = não mensurável (vista de seção)
  casca_pct: number | null;
  volume_m3: number | null;
  massa_kg: number | null;
  massa_min_kg: number | null; // volume x densidade_min do clone (se houver faixa)
  massa_max_kg: number | null;
  densidade: DensidadeInfo;
  saude_pct: number | null;
  defeitos: number;
  defeitos_tipos: string[];
  posicao: PosicaoTora | null; // posição da máquina no corte (GNSS); null = sem posição
  // Luz em que a tora foi medida (omniroot/luz.py na máquina). 'critica' =
  // medida com baixa confiança; sai do método de medição da casca.
  luz: 'boa' | 'baixa' | 'critica';
}

async function buscarClone(cloneId: string | null): Promise<Omit<DensidadeInfo, 'valor' | 'clone'>> {
  const vazio = { tipo_dado: null, min: null, max: null, fonte: null } as const;
  if (!cloneId || !(await temTabelaClones())) return vazio;
  const { rows } = await pool.query(
    `SELECT tipo_dado, densidade_min::float AS min, densidade_max::float AS max, fonte
     FROM clones_densidade WHERE upper(clone_id) = upper($1) LIMIT 1`,
    [cloneId],
  );
  if (rows.length === 0) return vazio;
  const r = rows[0] as { tipo_dado: DensidadeInfo['tipo_dado']; min: number | null; max: number | null; fonte: string | null };
  return { tipo_dado: r.tipo_dado, min: r.min, max: r.max, fonte: r.fonte };
}

export async function getUltimaInspecao(maquinaId: number | null): Promise<UltimaInspecao | null> {
  // A "última" é a mais recente que existe, independente do período filtrado
  // (é o cartão ao vivo); respeita só o filtro de máquina.
  const { rows } = await pool.query(
    `SELECT t.id, to_char(t.data_inspecao, 'YYYY-MM-DD"T"HH24:MI:SS') AS data,
            t.status_classificacao AS status, t.confianca_ia::float AS confianca, t.log_id,
            m.modelo AS maquina_modelo, m.numero_serie AS maquina_serie, tal.nome AS talhao_nome
     FROM toras_inspecionadas t
     LEFT JOIN maquinas m   ON m.id_maquina = t.maquina_id
     LEFT JOIN talhoes  tal ON tal.id_talhao = t.talhao_id
     WHERE ($1::int IS NULL OR t.maquina_id = $1::int)
     ORDER BY t.data_inspecao DESC, t.id DESC
     LIMIT 1`,
    [maquinaId],
  );
  if (rows.length === 0) return null;
  const t = rows[0] as Pick<UltimaInspecao, 'id' | 'data' | 'status' | 'confianca' | 'log_id' | 'maquina_modelo' | 'maquina_serie' | 'talhao_nome'>;

  const [ind, def, posicao] = await Promise.all([
    pool.query(
      `SELECT tipo_indicador, valor::float AS valor, metodo_medicao
       FROM indicadores_qualidade WHERE tora_id = $1`,
      [t.id],
    ),
    pool.query(
      `SELECT tipo_defeito, COUNT(*)::int AS n FROM defeitos_detectados
       WHERE tora_id = $1 GROUP BY 1 ORDER BY n DESC`,
      [t.id],
    ),
    getPosicaoTora(t.id),
  ]);

  const por = new Map<string, { valor: number; metodo: string }>();
  for (const r of ind.rows as { tipo_indicador: string; valor: number; metodo_medicao: string }[]) {
    por.set(r.tipo_indicador, { valor: r.valor, metodo: r.metodo_medicao });
  }
  const v = (k: string) => por.get(k)?.valor ?? null;
  const metodo = (k: string) => por.get(k)?.metodo ?? '';

  // A vista sai do método do diâmetro: 'imagem_secao_...' / 'imagem_lateral_...'
  const mDiam = metodo('diametro');
  const vista: UltimaInspecao['vista'] = mDiam.includes('secao')
    ? 'secao'
    : mDiam.includes('lateral')
      ? 'lateral'
      : 'desconhecida';
  const tortMedida = metodo('tortuosidade').startsWith('opencv');
  const comprimentoMedido = !metodo('altura').startsWith('comprimento_tracamento');

  const clone = /^lookup_clone_(.+)$/.exec(metodo('densidade'))?.[1] ?? null;
  const cloneInfo = await buscarClone(clone);
  const volume = v('volume_util');

  return {
    ...t,
    vista,
    diametro_cm: v('diametro'),
    comprimento_cm: v('altura'),
    comprimento_medido: comprimentoMedido,
    tortuosidade: tortMedida ? v('tortuosidade') : null,
    casca_pct: v('porcentagem_casca'),
    volume_m3: volume,
    massa_kg: v('massa_seca'),
    massa_min_kg: volume != null && cloneInfo.min != null ? round1(volume * cloneInfo.min) : null,
    massa_max_kg: volume != null && cloneInfo.max != null ? round1(volume * cloneInfo.max) : null,
    densidade: { valor: v('densidade'), clone, ...cloneInfo },
    saude_pct: v('apodrecimento_pragas'),
    defeitos: (def.rows as { n: number }[]).reduce((a, r) => a + r.n, 0),
    defeitos_tipos: (def.rows as { tipo_defeito: string }[]).map((r) => r.tipo_defeito),
    posicao,
    luz: metodo('porcentagem_casca').endsWith('_luz_critica')
      ? 'critica'
      : metodo('porcentagem_casca').endsWith('_luz_baixa')
        ? 'baixa'
        : 'boa',
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ============================================================
// Qualidade por talhão / clone + distribuições
// ============================================================

export interface QualidadeTalhao {
  talhao: string | null;
  clone: string | null;
  tipo_dado: DensidadeInfo['tipo_dado'];
  densidade: number | null; // kg/m3 (referência usada)
  densidade_min: number | null;
  densidade_max: number | null;
  toras: number;
  falhas: number;
  casca_media: number | null; // %
  tort_media: number | null; // %, só toras com vista lateral
  tort_n: number; // quantas toras tinham tortuosidade medida
  diam_medio: number | null; // cm
  volume_m3: number | null; // soma
  massa_kg: number | null; // soma (volume x densidade de referência)
  massa_min_kg: number | null; // soma(volume) x densidade_min
  massa_max_kg: number | null;
  // Previsão para a fábrica (consumo.ts): rendimento depurado do clone, com
  // proveniência própria, e o que sai dele.
  rendimento: number | null; // % (kraft, base madeira a.s.)
  rendimento_min: number | null;
  rendimento_max: number | null;
  rendimento_tipo_dado: DensidadeInfo['tipo_dado'];
  rendimento_fonte: string | null;
  celulose_t: number | null; // t seca ao ar = massa seca x rendimento / 0,9
  consumo_m3_tsa: number | null; // 0,9 / (densidade x rendimento)
  consumo_min: number | null; // faixa herdada das faixas de densidade e rendimento
  consumo_max: number | null;
  consumo_tipo_dado: DensidadeInfo['tipo_dado']; // a menos confiável das duas origens
}

export interface Faixa {
  faixa: string;
  total: number;
}

export interface Qualidade {
  porTalhao: QualidadeTalhao[];
  tortuosidade: Faixa[]; // histograma (só toras com medida)
  casca: Faixa[]; // histograma
  diametro: Faixa[]; // distribuição diamétrica (classes de 4 cm)
}

// Faixas de tortuosidade (flecha/comprimento, %): o main.py documenta que 0 é
// reta, ~5 já é curvatura visível e > 10 é tora torta de verdade.
const FAIXAS_TORT: [string, number, number][] = [
  ['reta (< 2%)', -1, 2],
  ['leve (2–5%)', 2, 5],
  ['visível (5–10%)', 5, 10],
  ['torta (≥ 10%)', 10, 1e9],
];
// Casca residual (% da superfície ainda com casca).
const FAIXAS_CASCA: [string, number, number][] = [
  ['≤ 5%', -1, 5],
  ['5–15%', 5, 15],
  ['15–30%', 15, 30],
  ['> 30%', 30, 1e9],
];

// Distribuição diamétrica em classes de 4 cm — o gráfico clássico do
// inventário florestal, só que com 100% das toras e ao vivo.
const FAIXAS_DIAM: [string, number, number][] = [
  ['< 10 cm', -1, 10],
  ['10–14', 10, 14],
  ['14–18', 14, 18],
  ['18–22', 18, 22],
  ['22–26', 22, 26],
  ['26–30', 26, 30],
  ['≥ 30 cm', 30, 1e9],
];

function histograma(valores: (number | null)[], faixas: [string, number, number][]): Faixa[] {
  return faixas.map(([faixa, lo, hi]) => ({
    faixa,
    total: valores.filter((x) => x != null && x > lo && x <= hi).length,
  }));
}

export async function getQualidade(f: Filters): Promise<Qualidade> {
  const comClones = await temTabelaClones();
  const comRend = comClones && (await temColunasRendimento());
  const args = [f.from, f.to, f.maquinaId];
  const colsRend = comRend
    ? `c.rendimento_depurado::float AS rendimento, c.rendimento_min::float AS rendimento_min,
       c.rendimento_max::float AS rendimento_max, c.rendimento_tipo_dado, c.rendimento_fonte,`
    : `NULL::float AS rendimento, NULL::float AS rendimento_min, NULL::float AS rendimento_max,
       NULL::text AS rendimento_tipo_dado, NULL::text AS rendimento_fonte,`;
  const groupRend = comRend
    ? ', c.rendimento_depurado, c.rendimento_min, c.rendimento_max, c.rendimento_tipo_dado, c.rendimento_fonte'
    : '';

  const [agg, dist] = await Promise.all([
    pool.query(
      `WITH p AS (${PIVOT_POR_TORA})
       SELECT tal.nome AS talhao, p.clone,
              ${comClones ? 'c.tipo_dado, c.densidade_min::float AS densidade_min, c.densidade_max::float AS densidade_max,' : 'NULL::text AS tipo_dado, NULL::float AS densidade_min, NULL::float AS densidade_max,'}
              ${colsRend}
              MAX(p.densidade) AS densidade,
              COUNT(*)::int AS toras,
              COUNT(*) FILTER (WHERE p.status_classificacao IN ('reprovado','quarentena'))::int AS falhas,
              AVG(p.casca) AS casca_media,
              AVG(p.tort) AS tort_media,
              COUNT(p.tort)::int AS tort_n,
              AVG(p.diam) AS diam_medio,
              SUM(p.volume) AS volume_m3,
              SUM(p.massa) AS massa_kg
       FROM p
       LEFT JOIN talhoes tal ON tal.id_talhao = p.talhao_id
       ${comClones ? 'LEFT JOIN clones_densidade c ON upper(c.clone_id) = upper(p.clone)' : ''}
       GROUP BY tal.nome, p.clone${comClones ? ', c.tipo_dado, c.densidade_min, c.densidade_max' : ''}${groupRend}
       ORDER BY toras DESC`,
      args,
    ),
    pool.query(`WITH p AS (${PIVOT_POR_TORA}) SELECT p.tort, p.casca, p.diam FROM p`, args),
  ]);

  const porTalhao = (agg.rows as Record<string, unknown>[]).map((r) => {
    const volume = numOrNull(r.volume_m3);
    const dmin = numOrNull(r.densidade_min);
    const dmax = numOrNull(r.densidade_max);
    const densidade = numOrNull(r.densidade);
    const massa = numOrNull(r.massa_kg);
    const tipoDens = (r.tipo_dado as DensidadeInfo['tipo_dado']) ?? null;
    const rend = numOrNull(r.rendimento);
    const rmin = numOrNull(r.rendimento_min);
    const rmax = numOrNull(r.rendimento_max);
    const tipoRend = (r.rendimento_tipo_dado as DensidadeInfo['tipo_dado']) ?? null;
    const consumo = consumoEspecifico(densidade, rend);
    const faixa = consumo != null ? faixaConsumo(densidade, dmin, dmax, rend, rmin, rmax) : null;
    const celulose = celulosePrevistaT(massa, rend);
    return {
      talhao: (r.talhao as string | null) ?? null,
      clone: (r.clone as string | null) ?? null,
      tipo_dado: tipoDens,
      densidade,
      densidade_min: dmin,
      densidade_max: dmax,
      toras: r.toras as number,
      falhas: r.falhas as number,
      casca_media: numOrNull(r.casca_media),
      tort_media: numOrNull(r.tort_media),
      tort_n: r.tort_n as number,
      diam_medio: numOrNull(r.diam_medio),
      volume_m3: volume,
      massa_kg: massa,
      massa_min_kg: volume != null && dmin != null ? round1(volume * dmin) : null,
      massa_max_kg: volume != null && dmax != null ? round1(volume * dmax) : null,
      rendimento: rend,
      rendimento_min: rmin,
      rendimento_max: rmax,
      rendimento_tipo_dado: tipoRend,
      rendimento_fonte: (r.rendimento_fonte as string | null) ?? null,
      celulose_t: celulose != null ? round3(celulose) : null,
      consumo_m3_tsa: consumo != null ? round2(consumo) : null,
      consumo_min: faixa ? round2(faixa.min) : null,
      consumo_max: faixa ? round2(faixa.max) : null,
      consumo_tipo_dado: consumo != null ? origemCombinada(tipoDens, tipoRend) : null,
    } satisfies QualidadeTalhao;
  });

  const linhas = dist.rows as { tort: number | null; casca: number | null; diam: number | null }[];
  return {
    porTalhao,
    tortuosidade: histograma(linhas.map((r) => r.tort), FAIXAS_TORT),
    casca: histograma(linhas.map((r) => r.casca), FAIXAS_CASCA),
    diametro: histograma(linhas.map((r) => r.diam), FAIXAS_DIAM),
  };
}

// NUMERIC/AVG/SUM chegam do pg como string (para não perder precisão); aqui
// viram número ou null.
function numOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}
