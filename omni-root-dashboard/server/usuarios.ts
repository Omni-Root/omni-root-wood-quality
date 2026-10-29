// Contas do dashboard (tabela usuarios, PARTE 6 do setup_completo.sql):
// validação do que chega do cliente, leitura e escrita. Tudo pelo poolContas
// — o único pool que escreve, e só nesta tabela.
//
// Regras que valem para a tela de admin E para o script (scripts/usuario.ts):
//   - login sempre minúsculo (o mesmo e-mail com outra caixa é a mesma conta);
//   - nunca fica sem admin ativo: rebaixar, desativar ou remover o último é
//     recusado (senão ninguém mais administra as contas pela interface);
//   - mudou senha, papel ou ativo -> versao_sessao sobe e as sessões abertas
//     dessa conta caem (server/auth.ts confere a versão a cada pedido).
import type pg from 'pg';
import { config } from './configuracoes.js';
import { poolContas } from './db.js';
import { gerarHash, SENHA_MAX, SENHA_MIN } from './senha.js';
import { ConflictError, NotFoundError, ValidationError } from './validate.js';

export const PAPEIS = ['admin', 'leitor', 'convidado'] as const;
export type Papel = (typeof PAPEIS)[number];

export interface Usuario {
  id: number;
  login: string;
  nome: string | null;
  papel: Papel;
  ativo: boolean;
  versaoSessao: number;
  temSenha: boolean; // false = conta só de login social
  criadoEm: string;
  ultimoLogin: string | null;
}

interface Linha {
  id: number;
  login: string;
  nome: string | null;
  senha_hash: string | null;
  papel: Papel;
  ativo: boolean;
  versao_sessao: number;
  criado_em: Date;
  ultimo_login: Date | null;
}

const COLUNAS = 'id, login, nome, senha_hash, papel, ativo, versao_sessao, criado_em, ultimo_login';

function deLinha(l: Linha): Usuario {
  return {
    id: l.id,
    login: l.login,
    nome: l.nome,
    papel: l.papel,
    ativo: l.ativo,
    versaoSessao: l.versao_sessao,
    temSenha: l.senha_hash !== null,
    criadoEm: l.criado_em.toISOString(),
    ultimoLogin: l.ultimo_login ? l.ultimo_login.toISOString() : null,
  };
}

// ---- validação ----

// E-mail ou nome de usuário: letras, números e . _ % + - @ (3 a 254).
const LOGIN_RE = /^[a-z0-9._%+@-]{3,254}$/;

export function normalizarLogin(v: unknown): string {
  if (typeof v !== 'string') throw new ValidationError('Informe o login');
  const login = v.trim().toLowerCase();
  if (!LOGIN_RE.test(login)) {
    throw new ValidationError('Login inválido: use um e-mail ou nome com letras, números e . _ - @ (3 a 254 caracteres)');
  }
  return login;
}

export function validarSenha(v: unknown): string {
  if (typeof v !== 'string' || v.length < SENHA_MIN) {
    throw new ValidationError(`A senha precisa ter pelo menos ${SENHA_MIN} caracteres`);
  }
  if (v.length > SENHA_MAX) throw new ValidationError(`A senha pode ter no máximo ${SENHA_MAX} caracteres`);
  return v;
}

export function validarNome(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new ValidationError('Nome inválido');
  const nome = v.trim();
  if (nome.length > 120) throw new ValidationError('O nome pode ter no máximo 120 caracteres');
  return nome || null;
}

export function validarPapel(v: unknown): Papel {
  if (typeof v === 'string' && (PAPEIS as readonly string[]).includes(v)) return v as Papel;
  throw new ValidationError(`Papel deve ser um de: ${PAPEIS.join(', ')}`);
}

export function validarId(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError('Id de usuário inválido');
  return n;
}

// ---- leitura ----

/** Conta pelo login, com o hash da senha (só para conferir o login). */
export async function buscarPorLogin(login: string): Promise<(Usuario & { senhaHash: string | null }) | null> {
  const { rows } = await poolContas.query<Linha>(`SELECT ${COLUNAS} FROM usuarios WHERE login = $1`, [login]);
  const l = rows[0];
  return l ? { ...deLinha(l), senhaHash: l.senha_hash } : null;
}

export async function buscarPorId(id: number): Promise<Usuario | null> {
  const { rows } = await poolContas.query<Linha>(`SELECT ${COLUNAS} FROM usuarios WHERE id = $1`, [id]);
  return rows[0] ? deLinha(rows[0]) : null;
}

export async function buscarHashPorId(id: number): Promise<string | null> {
  const { rows } = await poolContas.query<{ senha_hash: string | null }>('SELECT senha_hash FROM usuarios WHERE id = $1', [id]);
  return rows[0]?.senha_hash ?? null;
}

export async function listarUsuarios(): Promise<Usuario[]> {
  const { rows } = await poolContas.query<Linha>(`SELECT ${COLUNAS} FROM usuarios ORDER BY papel, login`);
  return rows.map(deLinha);
}

// Conta de VISITANTE (convidado do QR code e do login social sem conta, se a
// configuração acesso.oauth_convidados estiver ligada): a conta da tabela
// cujo login está em acesso.visitante_login (padrão "visitante"), com papel
// convidado. O admin a desativa na tela de Usuários e o acesso de visitante
// some junto.

/** A conta de visitante, se existir, estiver ativa e for de convidado. */
export async function contaVisitante(): Promise<Usuario | null> {
  const conta = await buscarPorLogin(config('acesso.visitante_login'));
  return conta && conta.ativo && conta.papel === 'convidado' ? conta : null;
}

export async function registrarLogin(id: number): Promise<void> {
  await poolContas.query('UPDATE usuarios SET ultimo_login = now() WHERE id = $1', [id]);
}

/**
 * Explica, em português, por que o servidor não alcança as contas — para o
 * console, nunca para o navegador (não vaza detalhe do banco).
 */
export function motivoFalhaContas(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const papel = process.env.PG_CONTAS_USER?.trim() || process.env.PG_USER || 'postgres';
  switch (e.code) {
    case '28P01':
    case '28000':
      return (
        `o Postgres recusou o login "${papel}" (papel inexistente ou senha errada). ` +
        'PG_CONTAS_USER é um login DO POSTGRES, não uma conta do painel: crie-o com ' +
        "CREATE ROLE omniroot_dashboard_contas LOGIN PASSWORD '...' IN ROLE omniroot_contas; " +
        'ou deixe PG_CONTAS_USER vazio para usar o PG_USER'
      );
    case '3D000':
      return `o banco "${process.env.PG_DBNAME ?? 'desafio_madeira'}" não existe (PG_DBNAME)`;
    case '42P01':
      return 'a tabela usuarios (ou configuracoes) não existe — aplique o setup_completo.sql atualizado';
    case '42501':
      return `o login "${papel}" não tem permissão nas tabelas de contas — ele precisa ser membro de omniroot_contas (GRANT omniroot_contas TO ${papel};)`;
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ETIMEDOUT':
      return `o Postgres não responde em ${process.env.PG_HOST ?? 'localhost'}:${process.env.PG_PORT ?? 5432} (está de pé?)`;
    default:
      return e.message ?? String(err);
  }
}

/** Confere, no boot, se as contas estão acessíveis e se há admin. Só loga. */
export async function conferirContasNoBoot(): Promise<void> {
  try {
    const { rows } = await poolContas.query<{ admins: number }>(
      "SELECT COUNT(*)::int AS admins FROM usuarios WHERE papel = 'admin' AND ativo",
    );
    if (rows[0].admins === 0) {
      console.warn(
        '[contas] nenhuma conta de admin ativa — ninguém consegue gerenciar o painel. ' +
          'Crie uma: npm run usuario -- criar voce@empresa.com --papel admin',
      );
    } else {
      console.log(`[contas] ok — ${rows[0].admins} admin(s) ativo(s)`);
    }
  } catch (err) {
    console.error(`[contas] PROBLEMA: ${motivoFalhaContas(err)}. O login não vai funcionar até corrigir.`);
  }
}

// ---- escrita ----

export async function criarUsuario(dados: {
  login: string;
  nome: string | null;
  papel: Papel;
  senha: string | null;
}): Promise<Usuario> {
  const hash = dados.senha === null ? null : await gerarHash(dados.senha);
  try {
    const { rows } = await poolContas.query<Linha>(
      `INSERT INTO usuarios (login, nome, papel, senha_hash) VALUES ($1, $2, $3, $4) RETURNING ${COLUNAS}`,
      [dados.login, dados.nome, dados.papel, hash],
    );
    return deLinha(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ConflictError('Já existe uma conta com esse login');
    throw err;
  }
}

export interface Mudancas {
  nome?: string | null;
  papel?: Papel;
  ativo?: boolean;
  /** string = nova senha; null = remove a senha (conta só de login social). */
  senha?: string | null;
}

// Toda escrita começa travando as linhas de admin ativo, sempre na mesma
// ordem (id): duas mudanças simultâneas não conseguem, juntas, tirar o
// último admin — e, travando sempre na mesma ordem, não se travam entre si.
async function travarAdmins(cliente: pg.PoolClient): Promise<number[]> {
  const { rows } = await cliente.query<{ id: number }>(
    "SELECT id FROM usuarios WHERE papel = 'admin' AND ativo ORDER BY id FOR UPDATE",
  );
  return rows.map((r) => r.id);
}

function garantirOutroAdmin(admins: number[], id: number): void {
  if (admins.length === 1 && admins[0] === id) {
    throw new ConflictError('Esta é a última conta de admin ativa: crie ou ative outro admin antes');
  }
}

async function emTransacao<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const cliente = await poolContas.connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    cliente.release();
  }
}

export async function atualizarUsuario(id: number, m: Mudancas): Promise<Usuario> {
  const hash = typeof m.senha === 'string' ? await gerarHash(m.senha) : m.senha;
  return emTransacao(async (c) => {
    const admins = await travarAdmins(c);
    const { rows } = await c.query<Linha>(`SELECT ${COLUNAS} FROM usuarios WHERE id = $1 FOR UPDATE`, [id]);
    const atual = rows[0];
    if (!atual) throw new NotFoundError('Conta não encontrada');

    const deixaDeSerAdmin =
      atual.papel === 'admin' && atual.ativo && ((m.papel !== undefined && m.papel !== 'admin') || m.ativo === false);
    if (deixaDeSerAdmin) garantirOutroAdmin(admins, id);

    const sets: string[] = [];
    const valores: unknown[] = [];
    const set = (coluna: string, valor: unknown) => {
      valores.push(valor);
      sets.push(`${coluna} = $${valores.length}`);
    };
    if (m.nome !== undefined) set('nome', m.nome);
    if (m.papel !== undefined) set('papel', m.papel);
    if (m.ativo !== undefined) set('ativo', m.ativo);
    if (hash !== undefined) set('senha_hash', hash);
    const derrubaSessoes =
      (m.papel !== undefined && m.papel !== atual.papel) ||
      (m.ativo !== undefined && m.ativo !== atual.ativo) ||
      hash !== undefined;
    if (derrubaSessoes) sets.push('versao_sessao = versao_sessao + 1');
    if (sets.length === 0) return deLinha(atual);
    sets.push('atualizado_em = now()');

    valores.push(id);
    const r = await c.query<Linha>(
      `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${valores.length} RETURNING ${COLUNAS}`,
      valores,
    );
    return deLinha(r.rows[0]);
  });
}

export async function removerUsuario(id: number): Promise<void> {
  await emTransacao(async (c) => {
    const admins = await travarAdmins(c);
    const { rows } = await c.query<Linha>(`SELECT ${COLUNAS} FROM usuarios WHERE id = $1 FOR UPDATE`, [id]);
    const atual = rows[0];
    if (!atual) throw new NotFoundError('Conta não encontrada');
    if (atual.papel === 'admin' && atual.ativo) garantirOutroAdmin(admins, id);
    await c.query('DELETE FROM usuarios WHERE id = $1', [id]);
  });
}
