// Saúde do servidor/banco (pública) e sessão: login, visitante, logout,
// "quem sou eu" e troca da própria senha. As contas vêm da tabela usuarios.
import express from 'express';
import { pool } from '../db.js';
import {
  clearSessionCookie,
  createSessionToken,
  esquecerSessao,
  mesmaOrigem,
  requireAuth,
  sessaoValida,
  setSessionCookie,
  type Sessao,
} from '../auth.js';
import { route } from '../http.js';
import { ehEconomico, viaTunel } from '../economia.js';
import { esperaParaTentar, registrarFalha, registrarSucesso } from '../limite.js';
import { conferirSenha, gastarTempoDeConferencia } from '../senha.js';
import {
  atualizarUsuario,
  buscarHashPorId,
  buscarPorLogin,
  contaVisitante,
  motivoFalhaContas,
  registrarLogin,
  validarSenha,
} from '../usuarios.js';
import { ValidationError } from '../validate.js';
import { encerrarEventosDe } from '../live.js';

export const rotasSessao = express.Router();

// ---- Saúde (público) ----
rotasSessao.get('/api/health', route(async () => {
  await pool.query('SELECT 1');
  return { ok: true };
}));

// ---- Autenticação ----

const ERRO_LOGIN = 'Usuário ou senha inválidos';

rotasSessao.post('/api/login', mesmaOrigem, async (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Informe usuário e senha' });
  }
  const login = username.trim().toLowerCase();
  const ip = req.ip ?? '';
  const espera = esperaParaTentar(ip, login);
  if (espera > 0) {
    res.setHeader('Retry-After', String(espera));
    return res.status(429).json({ error: `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 60)} min.` });
  }
  try {
    const conta = await buscarPorLogin(login);
    // Mesma resposta e mesmo custo para "não existe", "inativa", "sem senha"
    // e "senha errada": quem tenta não descobre quais logins existem.
    let senhaOk = false;
    if (conta?.senhaHash) senhaOk = await conferirSenha(password, conta.senhaHash);
    else await gastarTempoDeConferencia(password);
    if (!conta || !conta.ativo || !senhaOk) {
      registrarFalha(ip, login);
      return res.status(401).json({ error: ERRO_LOGIN });
    }
    registrarSucesso(login);
    await registrarLogin(conta.id);
    setSessionCookie(req, res, createSessionToken(conta));
    res.json({ user: conta.login, nome: conta.nome, papel: conta.papel, plateia: conta.papel === 'convidado' });
  } catch (err) {
    console.error(`[login] não consegui conferir o login: ${motivoFalhaContas(err)}`);
    res.status(503).json({ error: 'Não foi possível conferir o login agora. O motivo está no console do servidor.' });
  }
});

// Visitante do QR code: entra direto na conta de visitante (papel
// convidado), sem senha — por isso SÓ pelo endereço público do túnel, e só
// enquanto o admin mantiver essa conta ativa.
rotasSessao.post('/api/login/visitante', mesmaOrigem, async (req, res) => {
  try {
    if (!(await viaTunel(req))) {
      return res.status(403).json({ error: 'O acesso de visitante só vale pelo link público (QR code)' });
    }
    const conta = await contaVisitante();
    if (!conta) return res.status(403).json({ error: 'O acesso de visitante está desligado' });
    await registrarLogin(conta.id);
    setSessionCookie(req, res, createSessionToken(conta));
    res.json({ user: conta.login, nome: conta.nome, papel: conta.papel, plateia: true });
  } catch (err) {
    console.error('[login] visitante:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Banco de dados indisponível' });
  }
});

rotasSessao.post('/api/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

// `economico`: acesso pelo túnel público (o celular da plateia) — o painel
// espaça as recargas conforme a lotação (server/economia.ts). Vai também
// para quem ainda não entrou: o caminho de acesso não muda com o login.
// `visitante`: pelo túnel, com a conta de visitante ativa, a tela de login
// mostra o botão "Entrar como visitante".
rotasSessao.get('/api/me', async (req, res) => {
  const economico = await ehEconomico(req);
  let sessao: Sessao | null = null;
  try {
    sessao = await sessaoValida(req);
  } catch {
    return res.status(503).json({ error: 'Banco de dados indisponível' });
  }
  if (sessao) {
    return res.json({
      authenticated: true,
      user: sessao.user,
      nome: sessao.nome,
      papel: sessao.papel,
      plateia: sessao.plateia,
      economico,
    });
  }
  const visitante = (await viaTunel(req)) && (await contaVisitante().catch(() => null)) !== null;
  res.json({ authenticated: false, economico, visitante });
});

// Troca da própria senha: exige a atual. Sobe a versão da sessão (as OUTRAS
// sessões da conta caem) e entrega um cookie novo para esta continuar.
rotasSessao.post(
  '/api/me/senha',
  mesmaOrigem,
  requireAuth,
  route(async (req, res) => {
    const sessao = res.locals.sessao as Sessao;
    if (sessao.plateia) throw new ValidationError('A conta de convidado não troca de senha');
    const { atual, nova } = (req.body ?? {}) as { atual?: unknown; nova?: unknown };
    const novaSenha = validarSenha(nova);
    const hash = await buscarHashPorId(sessao.id);
    // Conta só de login social (sem senha): define a primeira sem pedir a atual.
    if (hash && (typeof atual !== 'string' || !(await conferirSenha(atual, hash)))) {
      throw new ValidationError('A senha atual não confere');
    }
    const conta = await atualizarUsuario(sessao.id, { senha: novaSenha });
    esquecerSessao(conta.id);
    encerrarEventosDe(conta.id);
    setSessionCookie(req, res, createSessionToken(conta));
    return { ok: true };
  }),
);
