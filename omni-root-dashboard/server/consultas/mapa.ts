// MAPA DE QUALIDADE — onde está a madeira ruim, não só onde a máquina passou.
//
// Cada tora chega do campo com a posição da máquina no momento do corte
// (colunas pos_* de toras_inspecionadas, gravadas pelo main.py a partir do
// GNSS). Aqui as toras são agrupadas em CÉLULAS de ~25 m: GNSS + alcance da
// grua (~10 m) não sustentam ponto a ponto, e uma célula com N toras é o que
// dá uma média confiável de casca / tortuosidade / rejeição por trecho.
//
// A agregação é feita NO BANCO (nunca traz a tabela inteira). Só os pontos
// individuais — para mostrar onde cada tora foi colhida — vêm limitados.
//
// Tolerante a banco antigo: sem as colunas pos_* (setup_completo.sql não
// reaplicado), devolve `disponivel: false` com o aviso, e o resto do
// dashboard segue funcionando.
import { pool } from '../db.js';
import type { Status } from '../validate.js';
import { RANGE_WHERE_T, type Filters } from './filtros.js';

// Luz crítica (omniroot/luz.py na máquina): a tora foi MEDIDA, mas em
// condição de baixa confiança — o método dos indicadores de imagem termina em
// "_luz_critica". Ela conta como tora e aparece no mapa, mas a casca e a
// tortuosidade dela não entram nas médias que disparam alertas. `i` é o
// apelido de indicadores_qualidade nas consultas.
export const EM_LUZ_CRITICA = `i.metodo_medicao LIKE '%\\_luz\\_critica'`;
export const SEM_LUZ_CRITICA = `i.metodo_medicao NOT LIKE '%\\_luz\\_critica'`;

export const CELULA_M = 25; // lado da célula, em metros
const METROS_POR_GRAU_LAT = 111_320;
const MAX_PONTOS = 3000;

// ------------------------------------------------------------
// Limites de referência e "Onde agir" — FONTE ÚNICA: o painel do dashboard e
// o relatório PDF recebem daqui (via /api/mapa e getMapa), nunca repetem os
// números. Os mesmos cortes das faixas dos histogramas (qualidade.ts).
// ------------------------------------------------------------
export type Metrica = 'casca' | 'tort' | 'falhas';
export type Nivel = 'ok' | 'atencao' | 'critico' | 'sem';

export const LIMITES: Record<Metrica, [number, number]> = {
  casca: [5, 15], // % de casca residual: <= 5 ok, <= 15 atenção, acima crítico
  tort: [5, 10], // % flecha/comprimento: < 5 ok, 5–10 atenção, >= 10 crítico
  falhas: [10, 30], // % de toras rejeitadas/em contenção na zona
};

// Menos toras que isso numa zona é pouco para afirmar algo sobre o trecho.
export const MIN_TORAS_ALERTA = 2;

const ACOES: Record<Metrica, { curto: string; acao: string }> = {
  casca: {
    curto: 'casca média',
    acao: 'revisar a regulagem do descascamento (rolos e facas) neste trecho',
  },
  tort: {
    curto: 'tortuosidade média',
    acao: 'madeira torta concentrada aqui: separar o destino e avisar o pátio da fábrica',
  },
  falhas: {
    curto: 'toras rejeitadas ou em contenção',
    acao: 'inspecionar o trecho: concentração de toras reprovadas',
  },
};

export function valorMetrica(c: MapaCelula, m: Metrica): number | null {
  if (m === 'casca') return c.casca_media;
  if (m === 'tort') return c.tort_media;
  return c.toras > 0 ? (100 * c.falhas) / c.toras : null;
}

// Quantas toras sustentam o valor (tortuosidade só existe nas vistas de lado).
export function nMetrica(c: MapaCelula, m: Metrica): number {
  return m === 'casca' ? c.casca_n : m === 'tort' ? c.tort_n : c.toras;
}

export function nivelCelula(c: MapaCelula, m: Metrica): Nivel {
  const v = valorMetrica(c, m);
  if (v == null || nMetrica(c, m) === 0) return 'sem';
  const [ok, atencao] = LIMITES[m];
  if (m === 'tort' ? v < ok : v <= ok) return 'ok';
  if (m === 'tort' ? v < atencao : v <= atencao) return 'atencao';
  return 'critico';
}

export interface Alerta {
  zona: string;
  metrica: Metrica;
  nivel: 'atencao' | 'critico';
  valor: number; // % (média da zona, ou % de rejeição)
  n: number; // toras que sustentam o valor
  limite: number; // o limite ultrapassado (%)
  curto: string;
  acao: string;
}

// Zonas acima do limite, crítico antes de atenção e, dentro do nível, quem
// mais passou do limite. Uma zona pode ter mais de um problema (uma linha
// por indicador); a tela agrupa por zona.
export function calcularAlertas(celulas: MapaCelula[]): Alerta[] {
  const out: Alerta[] = [];
  for (const c of celulas) {
    for (const m of Object.keys(LIMITES) as Metrica[]) {
      const nivel = nivelCelula(c, m);
      const v = valorMetrica(c, m);
      const n = nMetrica(c, m);
      if ((nivel === 'critico' || nivel === 'atencao') && v != null && n >= MIN_TORAS_ALERTA) {
        out.push({
          zona: c.zona,
          metrica: m,
          nivel,
          valor: v,
          n,
          limite: LIMITES[m][nivel === 'critico' ? 1 : 0],
          ...ACOES[m],
        });
      }
    }
  }
  return out.sort((a, b) => {
    if (a.nivel !== b.nivel) return a.nivel === 'critico' ? -1 : 1;
    return b.valor / LIMITES[b.metrica][1] - a.valor / LIMITES[a.metrica][1];
  });
}

// ------------------------------------------------------------
// Detecção das colunas de posição. Encontrou: guarda para sempre. Não
// encontrou: re-verifica a cada 30 s (quem reaplicar o setup_completo.sql
// com o servidor no ar vê o mapa aparecer sem reiniciar nada).
// ------------------------------------------------------------
let _temPosicao = false;
let _checadoEm = 0;
// Consulta em andamento: requisições simultâneas (o painel pede mapa e
// última inspeção juntos ao abrir) esperam ESTA resposta — antes, a segunda
// via "checado há pouco" e respondia "sem colunas" por 30 s.
let _checando: Promise<boolean> | null = null;

export async function temColunasPosicao(): Promise<boolean> {
  if (_temPosicao) return true;
  if (_checando) return _checando;
  if (Date.now() - _checadoEm < 30_000) return false;
  _checadoEm = Date.now();
  _checando = pool
    .query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'toras_inspecionadas'
         AND column_name IN ('pos_lat','pos_lon','pos_hdop','pos_satelites','pos_fonte','pos_idade_s','pos_precisao_m')`,
    )
    .then(({ rows }) => (_temPosicao = (rows[0] as { n: number }).n === 7))
    .finally(() => {
      _checando = null;
    });
  return _checando;
}

export interface MapaCelula {
  zona: string; // rótulo legível: coluna (letra, oeste→leste) + linha (número, norte→sul), ex. "B3"
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
  toras: number;
  falhas: number; // reprovado + quarentena
  casca_media: number | null; // %
  casca_n: number;
  tort_media: number | null; // %, só toras vistas de lado
  tort_n: number;
  diam_medio: number | null; // cm
  luz_critica_n: number; // toras medidas em luz crítica (fora das médias de casca/tortuosidade)
  primeira: string; // data da primeira tora da célula
  ultima: string;
  niveis?: Record<Metrica, Nivel>; // cor da zona em cada indicador (calculado aqui, a tela só pinta)
}

export interface MapaPonto {
  id: number;
  lat: number;
  lon: number;
  status: Status;
  data: string;
}

export interface Mapa {
  disponivel: boolean;
  aviso: string | null;
  celula_m: number;
  total: number; // toras no período (com e sem posição)
  com_posicao: number;
  luz_critica: number; // toras com posição medidas em luz crítica (baixa confiança)
  fontes: { fonte: string; toras: number }[];
  celulas: MapaCelula[];
  pontos: MapaPonto[]; // as mais recentes, até MAX_PONTOS
  pontos_truncados: boolean;
  ultima: MapaPonto | null; // tora mais recente com posição (destaque "ao vivo")
  limites: Record<Metrica, [number, number]>;
  min_toras_alerta: number;
  alertas: Alerta[];
}

const COM_POSICAO = `t.pos_lat IS NOT NULL AND t.pos_lon IS NOT NULL`;

// Colunas de planilha: A..Z, AA, AB...
function letraColuna(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function numOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

export async function getMapa(f: Filters): Promise<Mapa> {
  const vazio: Mapa = {
    disponivel: false,
    aviso: null,
    celula_m: CELULA_M,
    total: 0,
    com_posicao: 0,
    luz_critica: 0,
    fontes: [],
    celulas: [],
    pontos: [],
    pontos_truncados: false,
    ultima: null,
    limites: LIMITES,
    min_toras_alerta: MIN_TORAS_ALERTA,
    alertas: [],
  };
  if (!(await temColunasPosicao())) {
    return {
      ...vazio,
      aviso:
        'O banco central ainda não tem as colunas de posição. Reaplique "Banco de dados/setup_completo.sql" (é idempotente) — o mapa aparece sozinho em até 30 s.',
    };
  }

  const args = [f.from, f.to, f.maquinaId];
  const passoLat = CELULA_M / METROS_POR_GRAU_LAT; // graus de latitude por célula

  const [totais, fontes, celulas, pontos] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ${COM_POSICAO})::int AS com_posicao
       FROM toras_inspecionadas t WHERE ${RANGE_WHERE_T}`,
      args,
    ),
    pool.query(
      `SELECT COALESCE(t.pos_fonte, 'desconhecida') AS fonte, COUNT(*)::int AS toras
       FROM toras_inspecionadas t
       WHERE ${RANGE_WHERE_T} AND ${COM_POSICAO}
       GROUP BY 1 ORDER BY 2 DESC`,
      args,
    ),
    // Células: a largura em longitude encolhe com a latitude (cos). Usa a
    // latitude média do conjunto — num talhão (poucos km) o erro é desprezível.
    pool.query(
      `WITH p AS (
         SELECT t.id, t.status_classificacao, t.data_inspecao, t.pos_lat AS lat, t.pos_lon AS lon,
                -- Casca e tortuosidade medidas em luz CRÍTICA (baixa confiança) não
                -- entram na média da zona: ruído noturno não pode disparar "Onde agir".
                MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'porcentagem_casca'
                                       AND ${SEM_LUZ_CRITICA})::float AS casca,
                MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'tortuosidade'
                                       AND i.metodo_medicao LIKE 'opencv%'
                                       AND ${SEM_LUZ_CRITICA})::float AS tort,
                MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'diametro')::float AS diam,
                COALESCE(BOOL_OR(${EM_LUZ_CRITICA}), false) AS luz_critica
         FROM toras_inspecionadas t
         LEFT JOIN indicadores_qualidade i ON i.tora_id = t.id
         WHERE ${RANGE_WHERE_T} AND ${COM_POSICAO}
         GROUP BY t.id
       ),
       ref AS (SELECT AVG(lat) AS lat0 FROM p),
       g AS (
         SELECT p.*, ref.lat0,
                floor(p.lat / $4::float)::int AS gy,
                floor(p.lon / ($4::float / cos(radians(ref.lat0))))::int AS gx
         FROM p, ref
       )
       SELECT gy, gx, MAX(lat0) AS lat0,
              COUNT(*)::int AS toras,
              COUNT(*) FILTER (WHERE status_classificacao IN ('reprovado','quarentena'))::int AS falhas,
              AVG(casca) AS casca_media, COUNT(casca)::int AS casca_n,
              AVG(tort) AS tort_media, COUNT(tort)::int AS tort_n,
              AVG(diam) AS diam_medio,
              COUNT(*) FILTER (WHERE luz_critica)::int AS luz_critica_n,
              to_char(MIN(data_inspecao), 'YYYY-MM-DD"T"HH24:MI:SS') AS primeira,
              to_char(MAX(data_inspecao), 'YYYY-MM-DD"T"HH24:MI:SS') AS ultima
       FROM g
       GROUP BY gy, gx`,
      [...args, passoLat],
    ),
    pool.query(
      `SELECT t.id, t.pos_lat AS lat, t.pos_lon AS lon, t.status_classificacao AS status,
              to_char(t.data_inspecao, 'YYYY-MM-DD"T"HH24:MI:SS') AS data
       FROM toras_inspecionadas t
       WHERE ${RANGE_WHERE_T} AND ${COM_POSICAO}
       ORDER BY t.data_inspecao DESC, t.id DESC
       LIMIT ${MAX_PONTOS + 1}`,
      args,
    ),
  ]);

  const tot = totais.rows[0] as { total: number; com_posicao: number };
  const linhas = celulas.rows as Record<string, unknown>[];

  // Rótulos de zona: colunas da esquerda (oeste) para a direita, linhas de
  // cima (norte) para baixo — como se lê um mapa impresso.
  const gxs = linhas.map((r) => r.gx as number);
  const gys = linhas.map((r) => r.gy as number);
  const gxMin = gxs.length ? Math.min(...gxs) : 0;
  const gyMax = gys.length ? Math.max(...gys) : 0;

  const cels: MapaCelula[] = linhas.map((r) => {
    const gx = r.gx as number;
    const gy = r.gy as number;
    const lat0 = Number(r.lat0);
    const passoLon = passoLat / Math.cos((lat0 * Math.PI) / 180);
    return {
      zona: `${letraColuna(gx - gxMin)}${gyMax - gy + 1}`,
      lat_min: gy * passoLat,
      lat_max: (gy + 1) * passoLat,
      lon_min: gx * passoLon,
      lon_max: (gx + 1) * passoLon,
      toras: r.toras as number,
      falhas: r.falhas as number,
      casca_media: numOrNull(r.casca_media),
      casca_n: r.casca_n as number,
      tort_media: numOrNull(r.tort_media),
      tort_n: r.tort_n as number,
      diam_medio: numOrNull(r.diam_medio),
      luz_critica_n: r.luz_critica_n as number,
      primeira: r.primeira as string,
      ultima: r.ultima as string,
    };
  });

  for (const c of cels) {
    c.niveis = { casca: nivelCelula(c, 'casca'), tort: nivelCelula(c, 'tort'), falhas: nivelCelula(c, 'falhas') };
  }

  const pts = (pontos.rows as MapaPonto[]).map((p) => ({ ...p, lat: Number(p.lat), lon: Number(p.lon) }));
  const truncados = pts.length > MAX_PONTOS;

  return {
    disponivel: true,
    aviso: null,
    celula_m: CELULA_M,
    total: tot.total,
    com_posicao: tot.com_posicao,
    luz_critica: cels.reduce((s, c) => s + c.luz_critica_n, 0),
    fontes: fontes.rows as Mapa['fontes'],
    celulas: cels,
    pontos: truncados ? pts.slice(0, MAX_PONTOS) : pts,
    pontos_truncados: truncados,
    ultima: pts[0] ?? null,
    limites: LIMITES,
    min_toras_alerta: MIN_TORAS_ALERTA,
    alertas: calcularAlertas(cels),
  };
}

// Posição da tora para o cartão "última inspeção" (null = sem posição ou
// banco sem as colunas).
export interface PosicaoTora {
  lat: number;
  lon: number;
  fonte: string | null;
  hdop: number | null;
  satelites: number | null;
  precisao_m: number | null; // raio de incerteza informado pela fonte (Localização do Windows)
}

export async function getPosicaoTora(toraId: number): Promise<PosicaoTora | null> {
  if (!(await temColunasPosicao())) return null;
  const { rows } = await pool.query(
    `SELECT pos_lat AS lat, pos_lon AS lon, pos_fonte AS fonte, pos_hdop AS hdop, pos_satelites AS satelites,
            pos_precisao_m AS precisao_m
     FROM toras_inspecionadas
     WHERE id = $1 AND pos_lat IS NOT NULL AND pos_lon IS NOT NULL`,
    [toraId],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    lat: Number(r.lat),
    lon: Number(r.lon),
    fonte: (r.fonte as string | null) ?? null,
    hdop: numOrNull(r.hdop),
    satelites: numOrNull(r.satelites),
    precisao_m: numOrNull(r.precisao_m),
  };
}
