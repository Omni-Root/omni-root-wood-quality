// Sessão do dashboard: as contas vivem na tabela usuarios (server/usuarios.ts)
// e a sessão é um cookie assinado com HMAC-SHA256 (só `node:crypto`).
//
// O cookie leva id, login, papel e a versao_sessao da conta. A cada pedido
// protegido, sessaoValida() confere no banco se a conta continua ativa e na
// MESMA versão — trocar a senha, o papel ou desativar sobe a versão e as
// sessões antigas caem na hora. A conferência fica 5 s em cache por conta
// (o painel faz vários pedidos por recarga); mudanças feitas por este
// servidor limpam o cache na hora (esquecerSessao).
import crypto from 'node:crypto';
import type express from 'express';
import { buscarPorId, type Papel } from './usuarios.js';

const COOKIE_NAME = 'omniroot_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const CACHE_CONTA_MS = 5_000;

// Segredo que assina o cookie. Se não vier no .env, gera um aleatório por boot
// (as sessões caem quando o servidor reinicia — aceitável, só avisa).
const SECRET = (() => {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  console.warn(
    '[auth] SESSION_SECRET não definido no .env — usando segredo aleatório ' +
      '(as sessões vão cair a cada reinício do servidor).',
  );
  return crypto.randomBytes(32).toString('hex');
})();

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

// Comparação de tempo constante que não vaza o tamanho: reduz cada lado a um
// digest de tamanho fixo antes do timingSafeEqual.
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Dados de uma conta que vão dentro do cookie. */
export interface ContaSessao {
  id: number;
  login: string;
  papel: Papel;
  versaoSessao: number;
}

/** Cria um token de sessão assinado: base64url(payload).base64url(hmac). */
export function createSessionToken(conta: ContaSessao): string {
  const payload = JSON.stringify({
    i: conta.id,
    u: conta.login,
    p: conta.papel,
    v: conta.versaoSessao,
    exp: Date.now() + SESSION_TTL_MS,
  });
  const payloadB64 = b64url(Buffer.from(payload, 'utf8'));
  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

/** HMAC do segredo da sessão (base64url) — o OAuth assina o cookie de `state` com ele. */
export function assinar(texto: string): string {
  return b64url(crypto.createHmac('sha256', SECRET).update(texto).digest());
}

/** Comparação de tempo constante entre duas strings (para assinaturas). */
export function iguais(a: string, b: string): boolean {
  return safeEqual(a, b);
}

/** O que o token assinado diz (sem consultar o banco). */
export interface Token {
  id: number;
  user: string;
  papel: Papel;
  versao: number;
  plateia: boolean; // convidado: painel no modo econômico
}

/** Valida o token; devolve o conteúdo se a assinatura bate e não expirou. */
export function verifySessionToken(token: string | undefined): Token | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      i?: unknown;
      u?: unknown;
      p?: unknown;
      v?: unknown;
      exp?: unknown;
    };
    if (typeof data.i !== 'number' || typeof data.u !== 'string' || typeof data.v !== 'number') return null;
    if (typeof data.p !== 'string' || typeof data.exp !== 'number') return null;
    if (Date.now() > data.exp) return null;
    const papel = data.p as Papel;
    return { id: data.i, user: data.u, papel, versao: data.v, plateia: papel === 'convidado' };
  } catch {
    return null;
  }
}

/** Parser mínimo de cookies (sem dependência de cookie-parser). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function isHttps(req: express.Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function isLoopback(req: express.Request): boolean {
  const h = req.hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/**
 * SameSite (e Secure) do cookie de sessão.
 *
 * Padrão: Lax. Exceção: no PRÓPRIO notebook (localhost / 127.0.0.1) vira
 * `SameSite=None; Secure; Partitioned`. Motivo: as extensões de visualização
 * mobile do VS Code mostram o painel dentro de um iframe de outro "site"
 * (vscode-webview://), e nesse contexto o navegador não envia cookie Lax —
 * o login passava, a chamada seguinte ia sem sessão e o app voltava para a
 * tela de login. Testado num Chromium (base do VS Code): no iframe, o cookie
 * Lax não volta; o None+Secure volta, inclusive em http://127.0.0.1 (o
 * navegador trata loopback como contexto seguro). Partitioned = o cookie fica
 * preso ao site que embute (não serve para rastrear entre sites).
 *
 * Fica restrito ao loopback: só quem está no próprio notebook chega por esse
 * endereço, e a API é de leitura (outro site não consegue LER as respostas,
 * o CORS barra). Pela rede (celular, 192.168.x.x) e em produção: Lax, como
 * sempre.
 */
function atributosSameSite(req: express.Request): string[] {
  if (isLoopback(req)) return ['SameSite=None', 'Secure', 'Partitioned'];
  return isHttps(req) ? ['SameSite=Lax', 'Secure'] : ['SameSite=Lax'];
}

/** Grava o cookie de sessão na resposta. */
export function setSessionCookie(req: express.Request, res: express.Response, token: string): void {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    ...atributosSameSite(req),
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  res.append('Set-Cookie', attrs.join('; ')); // append: não apaga outro cookie da mesma resposta (ex.: o `state` do OAuth)
}

/** Limpa o cookie de sessão (logout). Mesmos atributos, senão o navegador não apaga. */
export function clearSessionCookie(req: express.Request, res: express.Response): void {
  const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', ...atributosSameSite(req), 'Path=/', 'Max-Age=0'];
  res.append('Set-Cookie', attrs.join('; ')); // append: não apaga outro cookie da mesma resposta (ex.: o `state` do OAuth)
}

/**
 * Só o token (assinatura e validade), SEM consultar o banco. Serve para
 * decisões que não protegem nada — ex.: se o pedido entra no modo econômico.
 * Para liberar dados, use sessaoValida() / requireAuth.
 */
export function tokenFrom(req: express.Request): Token | null {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

/** Sessão conferida contra o banco: conta existe, está ativa e na mesma versão. */
export interface Sessao {
  id: number;
  user: string;
  nome: string | null;
  papel: Papel;
  plateia: boolean;
}

const cacheContas = new Map<number, { sessao: Sessao; versao: number; expira: number }>();

/** Esquece a conferência guardada da conta (chamar depois de mudar a conta). */
export function esquecerSessao(id: number): void {
  cacheContas.delete(id);
}

/** Sessão válida do pedido, ou null. Lança erro se o banco não responder. */
export async function sessaoValida(req: express.Request): Promise<Sessao | null> {
  const tok = tokenFrom(req);
  if (!tok) return null;
  const agora = Date.now();
  let guardada = cacheContas.get(tok.id);
  if (!guardada || guardada.expira <= agora) {
    const conta = await buscarPorId(tok.id);
    if (!conta || !conta.ativo) {
      cacheContas.delete(tok.id);
      return null;
    }
    guardada = {
      sessao: { id: conta.id, user: conta.login, nome: conta.nome, papel: conta.papel, plateia: conta.papel === 'convidado' },
      versao: conta.versaoSessao,
      expira: agora + CACHE_CONTA_MS,
    };
    cacheContas.set(tok.id, guardada);
  }
  return guardada.versao === tok.versao ? guardada.sessao : null;
}

/** Middleware: bloqueia rotas de dados sem sessão válida (401). Banco fora = 503. */
export const requireAuth: express.RequestHandler = (req, res, next) => {
  sessaoValida(req).then(
    (sessao) => {
      if (!sessao) return res.status(401).json({ error: 'Não autenticado' });
      res.locals.sessao = sessao;
      next();
    },
    (err: unknown) => {
      console.error('[auth] não consegui conferir a sessão no banco:', err instanceof Error ? err.message : err);
      res.status(503).json({ error: 'Banco de dados indisponível' });
    },
  );
};

/** Middleware (depois do requireAuth): só admin passa (403). */
export const requireAdmin: express.RequestHandler = (_req, res, next) => {
  if ((res.locals.sessao as Sessao | undefined)?.papel === 'admin') return next();
  res.status(403).json({ error: 'Só administradores podem fazer isso' });
};

/**
 * Middleware para pedidos que MUDAM algo (contas, senha): recusa pedido
 * vindo de outro site. O navegador manda Sec-Fetch-Site em todo fetch; sem
 * ele (navegador antigo), compara o Origin com o Host. O cookie de sessão é
 * SameSite=None no localhost (ver atributosSameSite), então isto não é
 * redundante.
 */
export const mesmaOrigem: express.RequestHandler = (req, res, next) => {
  const site = req.get('sec-fetch-site');
  if (site) {
    if (site === 'same-origin' || site === 'none') return next();
    return res.status(403).json({ error: 'Pedido de outra origem recusado' });
  }
  const origem = req.get('origin');
  if (!origem) return next();
  let hostOrigem = '';
  try {
    hostOrigem = new URL(origem).host;
  } catch {
    /* Origin malformado: recusa abaixo */
  }
  if ([req.get('host'), req.get('x-forwarded-host')].includes(hostOrigem)) return next();
  res.status(403).json({ error: 'Pedido de outra origem recusado' });
};
