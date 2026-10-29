// Configurações da aplicação (tabela configuracoes, PARTE 7 do
// setup_completo.sql): regras que o admin muda na tela "Configurações" e
// valem em segundos, sem reiniciar. No .env fica só o que é da instalação
// (banco, porta, segredos, túnel).
//
// Cada chave é DECLARADA aqui, com tipo, faixa e valor padrão: o banco só
// guarda o valor. Leitura síncrona (config('camera.offline_ms')) a partir de
// um cache em memória, carregado no boot e relido a cada 15 s — uma mudança
// feita direto no banco também chega. Banco fora: valem os últimos valores
// lidos (ou os padrões, se nunca leu).
import { poolContas } from './db.js';
import { NotFoundError, ValidationError } from './validate.js';

interface Definicao<T> {
  rotulo: string;
  tipo: 'texto' | 'booleano' | 'inteiro';
  padrao: T;
  unidade?: string;
  min?: number;
  max?: number;
}

const DEFINICOES = {
  'acesso.visitante_login': { rotulo: 'Conta de visitante', tipo: 'texto', padrao: 'visitante' } as Definicao<string>,
  'acesso.oauth_convidados': {
    rotulo: 'Login social sem cadastro entra como visitante',
    tipo: 'booleano',
    padrao: false,
  } as Definicao<boolean>,
  'camera.offline_ms': {
    rotulo: 'Câmera sem sinal após',
    tipo: 'inteiro',
    padrao: 4000,
    unidade: 'ms',
    min: 1000,
    max: 120_000,
  } as Definicao<number>,
  'frota.offline_ms': {
    rotulo: 'Máquina sem sinal no mapa após',
    tipo: 'inteiro',
    padrao: 10_000,
    unidade: 'ms',
    min: 2000,
    max: 600_000,
  } as Definicao<number>,
};

type Definicoes = typeof DEFINICOES;
export type Chave = keyof Definicoes;
type ValorDe<K extends Chave> = Definicoes[K] extends Definicao<infer T> ? T : never;

const RECARGA_MS = 15_000;
const valores = new Map<Chave, unknown>();

function ehChave(c: string): c is Chave {
  return Object.prototype.hasOwnProperty.call(DEFINICOES, c);
}

/** Confere tipo e faixa; devolve o valor normalizado ou lança ValidationError. */
function validar(chave: Chave, v: unknown): unknown {
  const d = DEFINICOES[chave] as Definicao<unknown>;
  if (d.tipo === 'booleano') {
    if (typeof v !== 'boolean') throw new ValidationError(`"${d.rotulo}" deve ser verdadeiro ou falso`);
    return v;
  }
  if (d.tipo === 'inteiro') {
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new ValidationError(`"${d.rotulo}" deve ser um número inteiro`);
    if ((d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) {
      throw new ValidationError(`"${d.rotulo}" deve ficar entre ${d.min} e ${d.max}${d.unidade ? ` ${d.unidade}` : ''}`);
    }
    return v;
  }
  if (typeof v !== 'string' || !v.trim()) throw new ValidationError(`"${d.rotulo}" não pode ficar vazio`);
  if (v.length > 254) throw new ValidationError(`"${d.rotulo}" pode ter no máximo 254 caracteres`);
  return v.trim().toLowerCase();
}

/** Valor atual da configuração (do cache; padrão se nunca leu do banco). */
export function config<K extends Chave>(chave: K): ValorDe<K> {
  return (valores.has(chave) ? valores.get(chave) : DEFINICOES[chave].padrao) as ValorDe<K>;
}

/** Lê todas as configurações do banco para o cache. Valor inválido no banco = padrão, com aviso. */
export async function recarregarConfiguracoes(): Promise<void> {
  const { rows } = await poolContas.query<{ chave: string; valor: unknown }>('SELECT chave, valor FROM configuracoes');
  for (const { chave, valor } of rows) {
    if (!ehChave(chave)) continue; // chave de outra versão: ignorada
    try {
      valores.set(chave, validar(chave, valor));
    } catch (err) {
      console.warn(`[config] valor inválido no banco para "${chave}" (${JSON.stringify(valor)}): ${(err as Error).message} — usando o padrão`);
      valores.delete(chave);
    }
  }
}

/** Carga inicial + recarga periódica. Falha não derruba o servidor: fica o padrão. */
export function iniciarConfiguracoes(): void {
  const tentar = () =>
    recarregarConfiguracoes().catch((err: unknown) =>
      console.warn('[config] não consegui ler as configurações do banco:', err instanceof Error ? err.message : err),
    );
  void tentar();
  setInterval(tentar, RECARGA_MS).unref();
}

export interface ItemConfiguracao {
  chave: Chave;
  rotulo: string;
  descricao: string;
  tipo: 'texto' | 'booleano' | 'inteiro';
  valor: unknown;
  padrao: unknown;
  unidade?: string;
  min?: number;
  max?: number;
  atualizadoEm: string | null;
  atualizadoPor: string | null; // login de quem mudou por último
}

/** Lista para a tela do admin: definição + valor do banco + quem mudou. */
export async function listarConfiguracoes(): Promise<ItemConfiguracao[]> {
  const { rows } = await poolContas.query<{
    chave: string;
    valor: unknown;
    descricao: string;
    atualizado_em: Date;
    login: string | null;
  }>(
    `SELECT c.chave, c.valor, c.descricao, c.atualizado_em, u.login
       FROM configuracoes c LEFT JOIN usuarios u ON u.id = c.atualizado_por`,
  );
  const doBanco = new Map(rows.map((r) => [r.chave, r]));
  return (Object.keys(DEFINICOES) as Chave[]).map((chave) => {
    const d = DEFINICOES[chave] as Definicao<unknown>;
    const r = doBanco.get(chave);
    return {
      chave,
      rotulo: d.rotulo,
      descricao: r?.descricao ?? '',
      tipo: d.tipo,
      valor: config(chave),
      padrao: d.padrao,
      unidade: d.unidade,
      min: d.min,
      max: d.max,
      atualizadoEm: r ? r.atualizado_em.toISOString() : null,
      atualizadoPor: r?.login ?? null,
    };
  });
}

export async function atualizarConfiguracao(chave: string, valor: unknown, autorId: number): Promise<void> {
  if (!ehChave(chave)) throw new NotFoundError(`Configuração desconhecida: ${chave}`);
  const v = validar(chave, valor);
  const { rowCount } = await poolContas.query(
    'UPDATE configuracoes SET valor = $2::jsonb, atualizado_em = now(), atualizado_por = $3 WHERE chave = $1',
    [chave, JSON.stringify(v), autorId],
  );
  if (rowCount === 0) {
    throw new NotFoundError(`A configuração "${chave}" não existe no banco: reaplique o setup_completo.sql`);
  }
  valores.set(chave, v);
}
