// Login social (Google, Microsoft, GitHub) — OAuth 2.0 "authorization code",
// todo do lado do servidor: o segredo de cada app nunca vai ao navegador.
//
//   GET /api/auth/provedores        quais botões estão configurados (público)
//   GET /api/auth/:provedor/entrar  → redireciona para o provedor
//   GET /api/auth/:provedor/retorno ← o provedor volta aqui com ?code&state
//
// Segurança:
//   - `state` aleatório num cookie assinado (HMAC do SESSION_SECRET, 10 min):
//     um site de terceiros não consegue "plantar" um login;
//   - entra quem tem CONTA ativa na tabela usuarios com login = e-mail
//     VERIFICADO pelo provedor, com o papel dessa conta (o admin cadastra o
//     e-mail na tela de Usuários; a conta pode nem ter senha);
//   - configuração acesso.oauth_convidados ligada (tela "Configurações"):
//     qualquer outra conta entra na conta de VISITANTE
//     (papel convidado: painel de leitura com os limites da plateia), para a
//     banca e o público entrarem com o e-mail que tiverem. Desativar a conta
//     de visitante desliga isso também;
//   - deu certo: a MESMA sessão (cookie assinado) do login com senha.
// Precisa de internet (fala com o provedor); o login do admin funciona offline.
import crypto from 'node:crypto';
import express from 'express';
import { assinar, createSessionToken, iguais, parseCookies, setSessionCookie } from '../auth.js';
import { buscarPorLogin, contaVisitante, registrarLogin } from '../usuarios.js';
import { config } from '../configuracoes.js';
import { viaTunel } from '../economia.js';
import { urlPublica } from '../plateia.js';

type NomeProvedor = 'google' | 'microsoft' | 'github';
export interface Perfil {
  email: string | null;
  verificado: boolean;
}

const COOKIE_ESTADO = 'omniroot_oauth';
const VALIDADE_ESTADO_MS = 10 * 60 * 1000;
const TEMPO_LIMITE_MS = 10_000;

const credenciais: Record<NomeProvedor, { id: string; segredo: string }> = {
  google: { id: process.env.GOOGLE_CLIENT_ID ?? '', segredo: process.env.GOOGLE_CLIENT_SECRET ?? '' },
  microsoft: { id: process.env.MICROSOFT_CLIENT_ID ?? '', segredo: process.env.MICROSOFT_CLIENT_SECRET ?? '' },
  github: { id: process.env.GITHUB_CLIENT_ID ?? '', segredo: process.env.GITHUB_CLIENT_SECRET ?? '' },
};

// Microsoft: "common" mostra a tela de login para contas pessoais e de
// organização, mas só aceitamos as que têm e-mail confiável (ver perfil()).
// Para aceitar contas de UMA organização (ex.: a da faculdade), coloque aqui
// o ID dela (GUID do "locatário" no portal do Azure / Entra ID).
const MICROSOFT_TENANT = process.env.MICROSOFT_TENANT?.trim() || 'common';
// Locatário fixo de todas as contas pessoais da Microsoft (Outlook/Hotmail/Live).
const TID_CONTAS_PESSOAIS = '9188040d-6c67-4c5b-b112-36a304b66dad';
const ehGuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Conta sem cadastro entra como visitante? Inclusive conta de organização da
// Microsoft, cujo e-mail não é verificado. Só e-mail verificado casa com uma
// conta cadastrada: acesso.oauth_convidados nunca abre a porta de uma conta.

function configurado(p: NomeProvedor): boolean {
  return Boolean(credenciais[p].id && credenciais[p].segredo);
}

function ehProvedor(p: string): p is NomeProvedor {
  return p === 'google' || p === 'microsoft' || p === 'github';
}

// Endereço de retorno registrado no provedor. Em dev, o Vite repassa o Host
// do navegador (changeOrigin: false), então vira http://localhost:5173/...;
// pelo túnel da plateia (zrok/Tailscale/ngrok, que chega aqui em http), vira
// o endereço público https. OAUTH_URL_BASE fixa um endereço por cima de tudo.
async function urlRetorno(req: express.Request, p: NomeProvedor): Promise<string> {
  const fixa = process.env.OAUTH_URL_BASE?.trim().replace(/\/$/, '');
  const base = fixa || ((await viaTunel(req)) ? await urlPublica() : `${req.protocol}://${req.get('host')}`);
  return `${base}/api/auth/${p}/retorno`;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} respondeu ${res.status}`);
  return (await res.json()) as T;
}

// ---- cada provedor: para onde mandar o usuário e como ler o e-mail ----

function urlAutorizacao(p: NomeProvedor, redirect: string, estado: string): string {
  const { id } = credenciais[p];
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  if (p === 'google') {
    return `https://accounts.google.com/o/oauth2/v2/auth?${q({
      client_id: id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'openid email profile',
      state: estado,
      prompt: 'select_account',
    })}`;
  }
  if (p === 'github') {
    return `https://github.com/login/oauth/authorize?${q({
      client_id: id,
      redirect_uri: redirect,
      scope: 'read:user user:email',
      state: estado,
      allow_signup: 'false',
    })}`;
  }
  return `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize?${q({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid email profile',
    state: estado,
    prompt: 'select_account',
  })}`;
}

async function perfil(p: NomeProvedor, code: string, redirect: string): Promise<Perfil> {
  const { id, segredo } = credenciais[p];
  if (p === 'google') {
    const tok = await json<{ access_token: string }>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: id, client_secret: segredo, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    const u = await json<{ email?: string; email_verified?: boolean }>('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    return { email: u.email ?? null, verificado: u.email_verified === true };
  }
  if (p === 'github') {
    const tok = await json<{ access_token?: string; error?: string }>('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: segredo, code, redirect_uri: redirect }),
    });
    if (!tok.access_token) throw new Error(`GitHub: ${tok.error ?? 'sem token'}`);
    const cab = { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'omni-root-dashboard' };
    // O e-mail do perfil pode ser privado: a lista de e-mails diz qual é o principal e se é verificado.
    const emails = await json<{ email: string; primary: boolean; verified: boolean }[]>('https://api.github.com/user/emails', { headers: cab });
    const e = emails.find((x) => x.primary && x.verified) ?? emails.find((x) => x.verified);
    return { email: e?.email ?? null, verificado: Boolean(e) };
  }
  // Microsoft: o id_token vem DIRETO do endpoint de token, por HTTPS, em troca
  // do código — o OpenID Connect dispensa conferir a assinatura nesse caso
  // (seção 3.1.3.7); conferimos o destinatário (aud).
  const tok = await json<{ id_token?: string }>(`https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: segredo, code, redirect_uri: redirect, grant_type: 'authorization_code', scope: 'openid email profile' }),
  });
  if (!tok.id_token) throw new Error('Microsoft: sem id_token');
  const c = JSON.parse(Buffer.from(tok.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
    aud?: string;
    tid?: string;
    email?: string;
    preferred_username?: string;
  };
  return perfilMicrosoft(c, id, MICROSOFT_TENANT);
}

/**
 * Decide se o e-mail de uma conta Microsoft é confiável (função pura: testada
 * em tests/oauth-microsoft.test.ts). Conta pessoal: a Microsoft verifica o
 * e-mail. Conta de organização: o e-mail é definido pelo admin DAQUELA
 * organização — de uma organização qualquer, não prova nada (falha "nOAuth");
 * só vale a organização configurada em MICROSOFT_TENANT.
 */
export function perfilMicrosoft(
  c: { aud?: string; tid?: string; email?: string; preferred_username?: string },
  clientId: string,
  tenant: string,
): Perfil {
  if (c.aud !== clientId) throw new Error('Microsoft: id_token para outro app');
  const pessoal = c.tid === TID_CONTAS_PESSOAIS;
  const daOrganizacao = ehGuid(tenant) && c.tid?.toLowerCase() === tenant.toLowerCase();
  // Fora da organização configurada o e-mail fica como NÃO verificado: só
  // serve para acesso.oauth_convidados (entra como visitante), nunca para uma conta cadastrada.
  const email = c.email ?? c.preferred_username ?? null;
  return { email, verificado: pessoal || daOrganizacao };
}

// ---- cookie de `state` (provedor.nonce.validade.assinatura) ----

function gravarEstado(req: express.Request, res: express.Response, p: NomeProvedor, nonce: string): void {
  const corpo = `${p}.${nonce}.${Date.now() + VALIDADE_ESTADO_MS}`;
  const https = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append(
    'Set-Cookie',
    `${COOKIE_ESTADO}=${corpo}.${assinar(corpo)}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${VALIDADE_ESTADO_MS / 1000}${https ? '; Secure' : ''}`,
  );
}

function lerEstado(req: express.Request, p: NomeProvedor): string | null {
  const v = parseCookies(req.headers.cookie)[COOKIE_ESTADO];
  if (!v) return null;
  const partes = v.split('.');
  if (partes.length !== 4) return null;
  const [prov, nonce, validade, sig] = partes;
  if (!iguais(sig, assinar(`${prov}.${nonce}.${validade}`))) return null;
  if (prov !== p || Date.now() > Number(validade)) return null;
  return nonce;
}

function apagarEstado(res: express.Response): void {
  res.append('Set-Cookie', `${COOKIE_ESTADO}=; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=0`);
}

// Volta ao app com um código de erro que a tela de login traduz.
function falha(res: express.Response, codigo: string): void {
  res.redirect(302, `/?erro_login=${encodeURIComponent(codigo)}`);
}

export const rotasOAuth = express.Router();

rotasOAuth.get('/api/auth/provedores', (_req, res) => {
  res.json({
    google: configurado('google'),
    microsoft: configurado('microsoft'),
    github: configurado('github'),
    convidados: config('acesso.oauth_convidados'),
  });
});

rotasOAuth.get('/api/auth/:provedor/entrar', async (req, res) => {
  const p = req.params.provedor;
  if (!ehProvedor(p)) return falha(res, 'provedor_desconhecido');
  if (!configurado(p)) return falha(res, 'nao_configurado');
  const nonce = crypto.randomBytes(24).toString('base64url');
  gravarEstado(req, res, p, nonce);
  res.redirect(302, urlAutorizacao(p, await urlRetorno(req, p), nonce));
});

rotasOAuth.get('/api/auth/:provedor/retorno', async (req, res) => {
  const p = req.params.provedor;
  if (!ehProvedor(p) || !configurado(p)) return falha(res, 'nao_configurado');
  const esperado = lerEstado(req, p);
  apagarEstado(res);
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) return falha(res, 'cancelado'); // a pessoa clicou em "cancelar" no provedor
  if (!esperado || !state || !iguais(state, esperado)) return falha(res, 'estado_invalido');
  if (!code) return falha(res, 'cancelado');
  try {
    const { email, verificado } = await perfil(p, code, await urlRetorno(req, p));
    const convidados = config('acesso.oauth_convidados');
    if (!email || (!verificado && !convidados)) return falha(res, 'sem_email');
    const propria = verificado ? await buscarPorLogin(email.toLowerCase()) : null;
    const conta = propria?.ativo ? propria : convidados ? await contaVisitante() : null;
    if (!conta) {
      console.warn(`[oauth] ${p}: ${email} sem conta ativa — acesso negado`);
      return falha(res, 'nao_autorizado');
    }
    await registrarLogin(conta.id);
    setSessionCookie(req, res, createSessionToken(conta));
    console.info(`[oauth] ${p}: entrou ${email} (conta ${conta.login}, ${conta.papel})`);
    res.redirect(302, '/');
  } catch (err) {
    console.error(`[oauth] ${p}: falha ao falar com o provedor —`, err instanceof Error ? err.message : err);
    falha(res, 'falha_provedor');
  }
});
