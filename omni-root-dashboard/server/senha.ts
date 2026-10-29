// Hash de senha com scrypt (node:crypto, sem dependência nova). Formato
// guardado em usuarios.senha_hash, autodescritivo para os parâmetros poderem
// subir no futuro sem invalidar as senhas antigas:
//
//   scrypt$<log2 N>$<r>$<p>$<sal base64url>$<hash base64url>
//
// N = 2^15, r = 8, p = 1: ~32 MB e algumas dezenas de ms por tentativa —
// caro para quem testa milhões de senhas, barato para um login.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (
  senha: crypto.BinaryLike,
  sal: crypto.BinaryLike,
  tamanho: number,
  opcoes: crypto.ScryptOptions,
) => Promise<Buffer>;

const LOG_N = 15;
const R = 8;
const P = 1;
const TAMANHO = 64;
// O scrypt precisa de 128·N·r bytes; o padrão do Node (32 MB) fica no limite.
const MAXMEM = 64 * 1024 * 1024;

export const SENHA_MIN = 10;
export const SENHA_MAX = 200;

export async function gerarHash(senha: string): Promise<string> {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(senha, sal, TAMANHO, { N: 2 ** LOG_N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', LOG_N, R, P, sal.toString('base64url'), hash.toString('base64url')].join('$');
}

/** Confere a senha contra o hash guardado, em tempo constante. Hash malformado = false. */
export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, logN, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64url');
  try {
    const obtido = await scrypt(senha, Buffer.from(salB64, 'base64url'), esperado.length, {
      N: 2 ** Number(logN),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
    return crypto.timingSafeEqual(obtido, esperado);
  } catch {
    return false;
  }
}

// Login inexistente também paga o custo de um scrypt: sem isso, a resposta
// rápida entregaria quais logins existem (enumeração de usuários).
let hashFalso: Promise<string> | null = null;
export async function gastarTempoDeConferencia(senha: string): Promise<void> {
  hashFalso ??= gerarHash(crypto.randomBytes(16).toString('hex'));
  await conferirSenha(senha, await hashFalso);
}
