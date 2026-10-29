// Atualização em tempo real: Postgres -> servidor -> navegador.
//
// 1. Um trigger em toras_inspecionadas (Banco de dados/migration_notify_toras.sql
//    no repositório principal) faz NOTIFY 'omniroot_toras' a cada tora que o
//    sync_daemon.py insere. Aqui uma conexão dedicada fica em LISTEN.
// 2. Cada aviso é repassado aos navegadores conectados em /api/events por
//    Server-Sent Events (SSE) — sem WebSocket, sem dependência nova.
// 3. Reserva: se o trigger não estiver instalado (banco antigo), um polling
//    leve (LIVE_POLL_MS, padrão 5 s) compara COUNT/MAX(id) e avisa do mesmo
//    jeito. Com o trigger presente os dois caminhos convivem sem duplicar:
//    o polling só emite quando vê id maior que o último anunciado.
//
// A conexão de LISTEN mantém default_transaction_read_only=on, como o pool:
// LISTEN não escreve nada.
import pg from 'pg';
import type express from 'express';
import { pool } from './db.js';
import { ehEconomico, entrouEconomico, ritmoAtual, saiuEconomico } from './economia.js';

const CANAL = 'omniroot_toras';
// Trajeto das máquinas: um aviso por lote que o sync insere (trigger em
// rastro_maquinas). A posição AO VIVO não passa pelo banco: chega por POST
// da máquina e sai daqui direto (server/frota.ts, evento SSE 'posicao').
const CANAL_RASTRO = 'omniroot_rastro';
const POLL_MS = Number(process.env.LIVE_POLL_MS ?? 5000);
// Sinal de vida: um EVENTO (não comentário) para o navegador poder medir o
// silêncio. Sem ele, uma conexão morta no meio do caminho (servidor
// reiniciado atrás do proxy do Vite, Wi-Fi que caiu) continua parecendo
// aberta, e a tela para de atualizar sem aviso. Ver src/hooks/useLive.ts.
const HEARTBEAT_MS = 15_000;

interface Cliente {
  res: express.Response;
  economico: boolean; // celular pelo túnel público (server/economia.ts)
  usuarioId: number | null; // conta dona da conexão (para derrubá-la se a conta for revogada)
}

const clientes = new Set<Cliente>();
let ultimoIdAnunciado = 0;
let listenAtivo = false;

/** Manda um evento a todos os navegadores conectados (também usado pela frota: server/frota.ts). */
export function transmitir(evento: string, dados: unknown): void {
  const payload = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const c of clientes) {
    try {
      c.res.write(payload);
    } catch {
      clientes.delete(c);
    }
  }
}

/**
 * Rota SSE: `GET /api/events` (exige sessão — o middleware requireAuth vem
 * antes). Celular econômico (pelo túnel) entra na contagem de lotação: o
 * 'hello' leva o ritmo atual e, quando a faixa muda (entrou ou saiu gente),
 * todos recebem o novo num evento 'ritmo' (o notebook ignora).
 */
export async function rotaEventos(req: express.Request, res: express.Response): Promise<void> {
  const economico = await ehEconomico(req);
  // Fechou enquanto decidíamos: o 'close' já passou e ninguém o ouviu — sem
  // isto a contagem de lotação subiria e nunca desceria.
  if (req.socket.destroyed) return;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: não bufferizar
  });
  res.write(`retry: 3000\n`);
  const mudou = economico && entrouEconomico();
  res.write(
    `event: hello\ndata: ${JSON.stringify({ listen: listenAtivo, pollMs: POLL_MS, ultimoId: ultimoIdAnunciado, economico, ritmo: ritmoAtual() })}\n\n`,
  );

  const usuarioId = (res.locals.sessao as { id?: number } | undefined)?.id ?? null;
  const cliente: Cliente = { res, economico, usuarioId };
  clientes.add(cliente);
  if (mudou) transmitir('ritmo', ritmoAtual());
  req.on('close', () => {
    // false = encerrarEventosDe() já tirou (e descontou) esta conexão.
    if (!clientes.delete(cliente)) return;
    if (economico && saiuEconomico()) transmitir('ritmo', ritmoAtual());
  });
}

/**
 * Fecha as conexões de tempo real de uma conta (senha trocada, papel mudado,
 * desativada ou removida). O navegador reconecta sozinho: com cookie velho,
 * leva 401 e volta ao login; com cookie novo (trocou a própria senha), segue.
 */
export function encerrarEventosDe(usuarioId: number): void {
  for (const c of clientes) {
    if (c.usuarioId !== usuarioId) continue;
    clientes.delete(c);
    if (c.economico && saiuEconomico()) transmitir('ritmo', ritmoAtual());
    c.res.end();
  }
}

async function lerUltimoId(): Promise<number> {
  const { rows } = await pool.query('SELECT COALESCE(MAX(id), 0)::int AS max_id FROM toras_inspecionadas');
  return (rows[0] as { max_id: number }).max_id;
}

/** Anuncia uma tora nova (vinda do trigger ou do polling), sem repetir ids. */
function anunciar(id: number, extra: Record<string, unknown> = {}): void {
  if (id <= ultimoIdAnunciado) return;
  ultimoIdAnunciado = id;
  transmitir('tora', { id, op: 'INSERT', ...extra, em: new Date().toISOString() });
}

/**
 * Tora já conhecida que foi ATUALIZADA (evento incremental do main.py: o
 * mesmo registro é refinado enquanto a tora está na frente da câmera).
 * Não passa pelo filtro de id novo — é o mesmo id, com números novos.
 */
function anunciarAtualizacao(id: number, extra: Record<string, unknown> = {}): void {
  transmitir('tora', { id, ...extra, op: 'UPDATE', em: new Date().toISOString() });
}

async function iniciarListen(): Promise<void> {
  const cliente = new pg.Client({
    host: process.env.PG_HOST ?? 'localhost',
    port: Number(process.env.PG_PORT ?? 5432),
    user: process.env.PG_USER ?? 'postgres',
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DBNAME ?? 'desafio_madeira',
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    options: '-c default_transaction_read_only=on',
  });

  cliente.on('notification', (msg) => {
    // Trajeto: o sync inseriu um lote em rastro_maquinas (inclusive o trecho
    // feito sem internet) — o navegador recarrega a linha do trajeto.
    if (msg.channel === CANAL_RASTRO) {
      transmitir('rastro', { em: new Date().toISOString() });
      return;
    }
    if (msg.channel !== CANAL) return;
    let dados: Record<string, unknown> = {};
    try {
      dados = msg.payload ? (JSON.parse(msg.payload) as Record<string, unknown>) : {};
    } catch {
      /* payload não-JSON: só avisa que houve tora nova */
    }
    const id = Number(dados.id ?? 0);
    if (id > 0 && dados.op === 'UPDATE') anunciarAtualizacao(id, dados);
    else if (id > 0) anunciar(id, dados);
    else transmitir('tora', { ...dados, em: new Date().toISOString() });
  });

  cliente.on('error', (err) => {
    console.warn('[live] conexão LISTEN caiu, reconectando em 5 s:', err.message);
    listenAtivo = false;
    setTimeout(() => void iniciarListen(), 5000);
  });

  try {
    await cliente.connect();
    await cliente.query(`LISTEN ${CANAL}`);
    await cliente.query(`LISTEN ${CANAL_RASTRO}`);
    listenAtivo = true;
    console.log(`[live] LISTEN ${CANAL} ativo (push do Postgres)`);
  } catch (err) {
    listenAtivo = false;
    console.warn('[live] não foi possível abrir LISTEN (fica só o polling):', (err as Error).message);
    setTimeout(() => void iniciarListen(), 15_000);
  }
}

function iniciarPolling(): void {
  setInterval(async () => {
    if (clientes.size === 0) return; // ninguém olhando: não gasta consulta
    try {
      const id = await lerUltimoId();
      if (id > ultimoIdAnunciado) anunciar(id, { origem: 'polling' });
    } catch {
      /* banco fora: o próximo ciclo tenta de novo */
    }
  }, POLL_MS);
}

function iniciarHeartbeat(): void {
  setInterval(() => transmitir('ping', {}), HEARTBEAT_MS);
}

/** Chamado uma vez no boot do servidor. */
export async function iniciarTempoReal(): Promise<void> {
  try {
    ultimoIdAnunciado = await lerUltimoId();
  } catch {
    ultimoIdAnunciado = 0;
  }
  void iniciarListen();
  iniciarPolling();
  iniciarHeartbeat();
}
