// Frota: onde está cada máquina (pelo SN) agora, e por onde ela passou.
//
// Duas fontes, juntas no mapa:
//   - AO VIVO: a máquina (omniroot/telemetria.py) faz POST da posição atual a
//     cada ~2 s enquanto tem rede, com o mesmo token da câmera ao vivo
//     (STREAM_TOKEN). Fica SÓ em memória — a última por SN — e sai na hora
//     para os navegadores pelo SSE (evento 'posicao'). Nada vai ao Postgres
//     por aqui: o dashboard segue somente-leitura no banco.
//   - TRAJETO: rastro_maquinas no Postgres, que o sync_daemon.py preenche a
//     partir do SQLite da máquina — inclusive o trecho feito sem internet.
//     Servidor reiniciado (memória vazia) ou máquina sem rede: a "última
//     posição conhecida" vem daqui (ou, sem trajeto, da última tora com posição).
//
// A hora de tudo é a hora LOCAL da máquina (como data_inspecao), em texto ISO
// sem fuso — o mesmo padrão do resto do painel.
import type express from 'express';
import { config } from './configuracoes.js';
import { pool } from './db.js';
import { transmitir } from './live.js';
import { MAQUINA_RE, tokenDaMaquinaValido } from './camera.js';
import type { Filters } from './consultas/filtros.js';

// Trajeto: no máximo tantos pontos por máquina no período (reduz igualmente).
const MAX_PONTOS_RASTRO = 2000;
// Buraco maior que isso no trajeto (máquina desligada) quebra a linha
// contínua; o painel liga os dois lados com uma linha TRACEJADA ("sem
// registro do caminho"), nunca com uma linha cheia que finja um percurso.
const BURACO_MS = 10 * 60_000;
const MAX_MAQUINAS = 500; // teto da memória (o POST exige token; é só um limite de sanidade)
const FONTE_RE = /^[a-z_]{1,30}$/;

export interface PosicaoFrota {
  maquina: string; // SN (numero_serie = maquina_id do config.json)
  modelo: string | null; // null = SN que não está na tabela maquinas
  online: boolean; // mandou posição há menos que a configuração frota.offline_ms
  estado: string; // ok / sem_fix / sem_receptor / iniciando (o que a máquina disse) — "offline" sem rede
  lat: number | null;
  lon: number | null;
  precisao_m: number | null;
  hdop: number | null;
  satelites: number | null;
  fonte: string | null;
  em: string | null; // hora (local) da posição mostrada
  idadeMs: number | null;
  contatoMs: number | null; // há quanto tempo chegou o último POST da máquina (null = nenhum desde que o servidor subiu)
  origem: 'ao_vivo' | 'trajeto' | 'tora' | null; // de onde veio a posição mostrada
}

interface Contato {
  recebidoEm: number; // Date.now() do último POST
  estado: string;
  fonte: string | null;
  // Última posição VÁLIDA recebida (sem fix agora não apaga onde ela estava)
  pos: { lat: number; lon: number; precisao_m: number | null; hdop: number | null; satelites: number | null; fonte: string | null; lidaEm: number } | null;
}

const contatos = new Map<string, Contato>();

function isoLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function numero(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/**
 * `POST /api/maquinas/posicao` — corpo JSON da máquina:
 *   { maquina, estado, fonte, lat?, lon?, precisao_m?, hdop?, satelites?, idade_s? }
 * Header X-Stream-Token. Sem lat/lon = máquina online sem posição (sem fix).
 */
export function receberPosicao(req: express.Request, res: express.Response): void {
  if (!tokenDaMaquinaValido(String(req.headers['x-stream-token'] ?? ''))) {
    res.status(401).json({ error: 'Token da máquina inválido (ou STREAM_TOKEN ausente no servidor)' });
    return;
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const maquina = typeof b.maquina === 'string' ? b.maquina.trim() : '';
  if (!MAQUINA_RE.test(maquina)) {
    res.status(400).json({ error: '"maquina" (SN) ausente ou inválido' });
    return;
  }
  const temLat = b.lat !== undefined && b.lat !== null;
  const lat = numero(b.lat, -90, 90);
  const lon = numero(b.lon, -180, 180);
  if (temLat && (lat === null || lon === null)) {
    res.status(400).json({ error: 'lat/lon fora do intervalo' });
    return;
  }
  if (!contatos.has(maquina) && contatos.size >= MAX_MAQUINAS) {
    res.status(429).json({ error: 'Máquinas demais' });
    return;
  }

  const agora = Date.now();
  const fonte = typeof b.fonte === 'string' && FONTE_RE.test(b.fonte) ? b.fonte : null;
  const estado = typeof b.estado === 'string' && FONTE_RE.test(b.estado) ? b.estado : 'ok';
  const anterior = contatos.get(maquina);
  const contato: Contato = {
    recebidoEm: agora,
    estado: lat !== null ? 'ok' : estado,
    fonte,
    pos:
      lat !== null && lon !== null
        ? {
            lat,
            lon,
            precisao_m: numero(b.precisao_m, 0, 1e6),
            hdop: numero(b.hdop, 0, 100),
            satelites: numero(b.satelites, 0, 200),
            fonte,
            lidaEm: agora - 1000 * (numero(b.idade_s, 0, 3600) ?? 0),
          }
        : (anterior?.pos ?? null),
  };
  contatos.set(maquina, contato);
  transmitir('posicao', montarAoVivo(maquina, contato, null, agora));
  res.status(204).end();
}

function montarAoVivo(maquina: string, c: Contato, modelo: string | null, agora: number): PosicaoFrota {
  // Sem POST há mais que isso = máquina sem rede (ou main.py parado). A
  // máquina manda a cada 2 s: o padrão de 10 s tolera pacotes perdidos no 4G.
  const online = agora - c.recebidoEm <= config('frota.offline_ms');
  return {
    maquina,
    modelo,
    online,
    estado: online ? c.estado : 'offline',
    lat: c.pos?.lat ?? null,
    lon: c.pos?.lon ?? null,
    precisao_m: c.pos?.precisao_m ?? null,
    hdop: c.pos?.hdop ?? null,
    satelites: c.pos?.satelites ?? null,
    fonte: c.pos?.fonte ?? c.fonte,
    em: c.pos ? isoLocal(c.pos.lidaEm) : null,
    idadeMs: c.pos ? agora - c.pos.lidaEm : null,
    contatoMs: agora - c.recebidoEm,
    origem: c.pos ? 'ao_vivo' : null,
  };
}

// ---- Postgres: a tabela do trajeto existe? (setup antigo não tem) ----
// (Mesmo cuidado de temColunasPosicao em consultas/mapa.ts: chamadas
// simultâneas esperam a mesma consulta, em vez de concluir "não tem".)
let _temRastro = false;
let _checadoEm = 0;
let _checando: Promise<boolean> | null = null;
async function temRastro(): Promise<boolean> {
  if (_temRastro) return true;
  if (_checando) return _checando;
  if (Date.now() - _checadoEm < 30_000) return false;
  _checadoEm = Date.now();
  _checando = pool
    .query(`SELECT to_regclass('rastro_maquinas') IS NOT NULL AS tem`)
    .then(({ rows }) => (_temRastro = (rows[0] as { tem: boolean }).tem))
    .finally(() => {
      _checando = null;
    });
  return _checando;
}

interface UltimaConhecida {
  maquina: string;
  modelo: string;
  lat: number | null;
  lon: number | null;
  precisao_m: number | null;
  hdop: number | null;
  satelites: number | null;
  fonte: string | null;
  em: string | null;
  origem: 'trajeto' | 'tora' | null;
}

/** Todas as máquinas cadastradas, com a última posição conhecida no banco. */
async function ultimasNoBanco(): Promise<UltimaConhecida[]> {
  const rastro = await temRastro();
  const { rows } = await pool.query(
    `SELECT m.numero_serie AS maquina, m.modelo,
            COALESCE(r.lat, t.pos_lat) AS lat, COALESCE(r.lon, t.pos_lon) AS lon,
            CASE WHEN r.lat IS NOT NULL THEN r.precisao_m ELSE t.pos_precisao_m END AS precisao_m,
            CASE WHEN r.lat IS NOT NULL THEN r.hdop ELSE t.pos_hdop END AS hdop,
            CASE WHEN r.lat IS NOT NULL THEN r.satelites ELSE t.pos_satelites END AS satelites,
            CASE WHEN r.lat IS NOT NULL THEN r.fonte ELSE t.pos_fonte END AS fonte,
            to_char(CASE WHEN r.lat IS NOT NULL THEN r.registrado_em ELSE t.data_inspecao END,
                    'YYYY-MM-DD"T"HH24:MI:SS') AS em,
            CASE WHEN r.lat IS NOT NULL THEN 'trajeto' WHEN t.pos_lat IS NOT NULL THEN 'tora' END AS origem
       FROM maquinas m
       ${
         rastro
           ? `LEFT JOIN LATERAL (
                SELECT lat, lon, precisao_m, hdop, satelites, fonte, registrado_em
                  FROM rastro_maquinas WHERE maquina_id = m.id_maquina
                 ORDER BY registrado_em DESC LIMIT 1) r ON true`
           : `LEFT JOIN LATERAL (
                SELECT NULL::double precision AS lat, NULL::double precision AS lon, NULL::double precision AS precisao_m,
                       NULL::double precision AS hdop, NULL::smallint AS satelites, NULL::varchar AS fonte,
                       NULL::timestamp AS registrado_em) r ON true`
       }
       LEFT JOIN LATERAL (
         SELECT pos_lat, pos_lon, pos_precisao_m, pos_hdop, pos_satelites, pos_fonte, data_inspecao
           FROM toras_inspecionadas
          WHERE maquina_id = m.id_maquina AND pos_lat IS NOT NULL
          ORDER BY data_inspecao DESC LIMIT 1) t ON true
      ORDER BY m.numero_serie`,
  );
  return rows as UltimaConhecida[];
}

/**
 * `GET /api/frota` — cada máquina com a posição mais recente que se sabe:
 * a ao vivo (memória) se ela está transmitindo, senão a última do banco.
 * Máquina cadastrada que nunca deu posição nenhuma não entra.
 */
export async function listarFrota(): Promise<PosicaoFrota[]> {
  const agora = Date.now();
  let banco: UltimaConhecida[] = [];
  try {
    banco = await ultimasNoBanco();
  } catch (err) {
    // Banco fora: a frota ao vivo continua (ela não depende do Postgres).
    console.warn('[frota] sem o banco, só posições ao vivo:', (err as Error).message);
  }
  const porSn = new Map(banco.map((b) => [b.maquina, b]));
  const sns = new Set([...contatos.keys(), ...porSn.keys()]);
  const lista: PosicaoFrota[] = [];
  for (const sn of sns) {
    const c = contatos.get(sn);
    const b = porSn.get(sn);
    const vivo = c ? montarAoVivo(sn, c, b?.modelo ?? null, agora) : null;
    // A ao vivo vale se tem posição e é mais nova que a do banco.
    const usarBanco =
      b && b.lat !== null && b.em && (!vivo || vivo.lat === null || (vivo.em !== null && b.em > vivo.em));
    if (usarBanco) {
      lista.push({
        maquina: sn,
        modelo: b.modelo,
        online: vivo?.online ?? false,
        estado: vivo?.estado ?? 'offline',
        lat: b.lat,
        lon: b.lon,
        precisao_m: b.precisao_m,
        hdop: b.hdop,
        satelites: b.satelites,
        fonte: b.fonte,
        em: b.em,
        idadeMs: agora - new Date(b.em as string).getTime(),
        contatoMs: vivo?.contatoMs ?? null,
        origem: b.origem,
      });
    } else if (vivo) {
      lista.push(vivo);
    }
  }
  return lista.sort((a, b) => Number(b.online) - Number(a.online) || a.maquina.localeCompare(b.maquina));
}

export interface TrajetoMaquina {
  maquina: string;
  // Cada trecho é uma linha contínua [lat, lon] (pode ter um ponto só: uma
  // parada). Entre um trecho e o seguinte não há registro do caminho.
  segmentos: [number, number][][];
  pontos: number; // pontos no período (antes de reduzir)
  inicio: string;
  fim: string;
}

/** `GET /api/frota/rastro` — trajeto de cada máquina no período/máquina filtrados. */
export async function getRastro(f: Filters): Promise<{ disponivel: boolean; maquinas: TrajetoMaquina[] }> {
  if (!(await temRastro())) return { disponivel: false, maquinas: [] };
  const { rows } = await pool.query(
    `WITH r AS (
       SELECT maquina_id, lat, lon, precisao_m, registrado_em,
              row_number() OVER (PARTITION BY maquina_id ORDER BY registrado_em) AS n,
              count(*) OVER (PARTITION BY maquina_id) AS total
         FROM rastro_maquinas
        WHERE registrado_em >= $1::date AND registrado_em < $2::date + INTERVAL '1 day'
          AND ($3::int IS NULL OR maquina_id = $3::int)
     )
     SELECT m.numero_serie AS maquina, r.lat, r.lon, r.precisao_m, r.total::int AS total,
            to_char(r.registrado_em, 'YYYY-MM-DD"T"HH24:MI:SS') AS em
       FROM r JOIN maquinas m ON m.id_maquina = r.maquina_id
      WHERE r.total <= $4 OR (r.n - 1) % CEIL(r.total::numeric / $4)::int = 0 OR r.n = r.total
      ORDER BY m.numero_serie, r.registrado_em`,
    [f.from, f.to, f.maquinaId, MAX_PONTOS_RASTRO],
  );
  return { disponivel: true, maquinas: montarTrajetos(rows as PontoRastro[]) };
}

export interface PontoRastro {
  maquina: string;
  lat: number;
  lon: number;
  precisao_m: number | null;
  total: number;
  em: string; // hora local, ISO sem fuso
}

// Deslocamento menor que isso (ou que a precisão informada da leitura, se for
// maior — Wi-Fi do Windows: centenas de metros) é a posição oscilando com a
// máquina PARADA, não um caminho: não vira linha. Parada = só o pino.
export const DESLOCAMENTO_MIN_M = 20;

export function distanciaM(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Pontos (ordenados por máquina e hora) -> trechos contínuos por máquina.
 * Buraco de tempo > BURACO_MS abre um trecho novo (o painel liga um trecho ao
 * outro com linha TRACEJADA: "sem registro do caminho"). Dentro do trecho,
 * ponto que não se afastou do último guardado é oscilação de máquina parada
 * e é descartado — o trecho pode ficar com um ponto só (uma parada).
 */
export function montarTrajetos(rows: PontoRastro[]): TrajetoMaquina[] {
  const porMaquina = new Map<string, TrajetoMaquina>();
  let anterior: { maquina: string; t: number } | null = null;
  let guardado: { p: [number, number]; precisao: number } | null = null;
  for (const row of rows) {
    const t = new Date(row.em).getTime();
    const p: [number, number] = [row.lat, row.lon];
    const precisao = row.precisao_m ?? 0;
    let tr = porMaquina.get(row.maquina);
    if (!tr) {
      tr = { maquina: row.maquina, segmentos: [[]], pontos: row.total, inicio: row.em, fim: row.em };
      porMaquina.set(row.maquina, tr);
      guardado = null;
    } else if (anterior && anterior.maquina === row.maquina && t - anterior.t > BURACO_MS) {
      tr.segmentos.push([]);
      guardado = null;
    }
    const limite = Math.max(DESLOCAMENTO_MIN_M, precisao, guardado?.precisao ?? 0);
    if (!guardado || distanciaM(guardado.p, p) >= limite) {
      tr.segmentos[tr.segmentos.length - 1].push(p);
      guardado = { p, precisao };
    }
    tr.fim = row.em;
    anterior = { maquina: row.maquina, t };
  }
  return [...porMaquina.values()];
}
