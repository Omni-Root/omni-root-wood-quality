// Modo econômico: o painel no celular de quem chega pelo túnel público (QR
// code da plateia) se ajusta sozinho à lotação, para que 100 celulares não
// estourem o túnel nem pesem no notebook da apresentação.
//
//   - QUEM: requisição que chega pelo endereço público do túnel (Host ou
//     X-Forwarded-Host igual ao de server/plateia.ts) ou sessão de convidado.
//     O notebook (localhost) nunca entra: o telão fica sempre ao vivo e cheio.
//   - LOTAÇÃO: cada celular econômico mantém uma conexão de tempo real
//     (server/live.ts); a contagem delas escolhe a faixa de ritmo, que vai
//     para os celulares pelo próprio SSE (evento 'ritmo'). O navegador espaça
//     as recargas conforme a faixa (src/economico.ts).
//   - CACHE: os celulares veem os mesmos dados; a resposta de cada rota de
//     leitura é guardada por alguns segundos e servida a todos — o banco é
//     consultado uma vez, não cem. Pedidos simultâneos esperam a mesma
//     consulta. O notebook não passa pelo cache.
//   - VÍDEO: a câmera continua ao vivo, numa versão menor, no fps da faixa
//     (server/camera.ts).
import type express from 'express';
import { sessaoValida, tokenFrom } from './auth.js';
import { urlPublica } from './plateia.js';

/** A requisição veio pelo endereço público do túnel? */
export async function viaTunel(req: express.Request): Promise<boolean> {
  const publica = await urlPublica();
  if (!publica) return false;
  const host = new URL(publica).host;
  return [req.get('host'), req.get('x-forwarded-host')].some((h) => h === host);
}

/** Modo econômico para esta requisição: pelo túnel ou convidado. */
export async function ehEconomico(req: express.Request): Promise<boolean> {
  // Só o token (sem banco): aqui decide-se o ritmo, não o acesso.
  return tokenFrom(req)?.plateia === true || (await viaTunel(req));
}

// ---- Lotação -> ritmo ----

export type NivelRitmo = 'leve' | 'medio' | 'cheio';
export interface Ritmo {
  nivel: NivelRitmo;
  conectados: number; // celulares econômicos com o painel aberto agora
  ultimaMs: number; // "última inspeção": no máximo uma recarga a cada
  painelMs: number; // resto do painel: no máximo uma recarga a cada
  fps: number; // quadros por segundo da câmera
}

// Faixas: até 10 celulares é o stand tranquilo (quase ao vivo); acima de 40,
// o pitch lotado. Para descer de faixa a lotação precisa cair 3 abaixo do
// limite — sem ficar trocando quando a contagem oscila na fronteira.
const FAIXAS: { ate: number; nivel: NivelRitmo; ultimaMs: number; painelMs: number; fps: number }[] = [
  { ate: 10, nivel: 'leve', ultimaMs: 3_000, painelMs: 20_000, fps: 2 },
  { ate: 40, nivel: 'medio', ultimaMs: 10_000, painelMs: 60_000, fps: 1 },
  { ate: Infinity, nivel: 'cheio', ultimaMs: 15_000, painelMs: 90_000, fps: 1 },
];
const FOLGA_PARA_DESCER = 3;

let conectados = 0;
let faixa = 0;

function recalcularFaixa(): boolean {
  let nova = faixa;
  while (nova < FAIXAS.length - 1 && conectados > FAIXAS[nova].ate) nova++;
  while (nova > 0 && conectados <= FAIXAS[nova - 1].ate - FOLGA_PARA_DESCER) nova--;
  const mudou = nova !== faixa;
  faixa = nova;
  return mudou;
}

export function ritmoAtual(): Ritmo {
  const { nivel, ultimaMs, painelMs, fps } = FAIXAS[faixa];
  return { nivel, conectados, ultimaMs, painelMs, fps };
}

/** Um celular econômico abriu (true = a faixa mudou: avisar os outros). */
export function entrouEconomico(): boolean {
  conectados++;
  return recalcularFaixa();
}

/** Um celular econômico fechou (true = a faixa mudou). */
export function saiuEconomico(): boolean {
  conectados = Math.max(0, conectados - 1);
  return recalcularFaixa();
}

// ---- Cache das rotas de leitura para quem é econômico ----

const CACHE_MS = 5_000;
interface Guardada {
  expira: number;
  corpo: unknown;
}
const guardadas = new Map<string, Guardada>();
const emAndamento = new Map<string, express.Response[]>();

function limparVencidas(): void {
  if (guardadas.size < 200) return;
  const agora = Date.now();
  for (const [chave, g] of guardadas) if (g.expira <= agora) guardadas.delete(chave);
}

/**
 * Middleware para as rotas de leitura (JSON). Só age em GET com sessão
 * válida (conferida no banco: conta revogada não lê do cache) e econômico;
 * o resto segue direto para a rota, que responde 401/503 sozinha.
 * A chave é a URL inteira (rota + filtros): o mesmo filtro, a mesma resposta.
 */
export const cacheEconomico: express.RequestHandler = (req, res, next) => {
  if (req.method !== 'GET' || !tokenFrom(req)) return next();
  void Promise.all([sessaoValida(req).catch(() => null), ehEconomico(req)]).then(([sessao, eco]) => {
    if (!sessao || !eco) return next();
    const chave = req.originalUrl;
    const g = guardadas.get(chave);
    if (g && g.expira > Date.now()) {
      res.setHeader('X-Cache', 'HIT');
      res.json(g.corpo);
      return;
    }
    // Outro celular já pediu isto e a consulta está rodando: espera ela.
    const fila = emAndamento.get(chave);
    if (fila) {
      fila.push(res);
      return;
    }
    emAndamento.set(chave, []);
    const enviar = res.json.bind(res);
    res.json = (corpo: unknown) => {
      const status = res.statusCode;
      if (status === 200) {
        limparVencidas();
        guardadas.set(chave, { expira: Date.now() + CACHE_MS, corpo });
      }
      const esperando = emAndamento.get(chave) ?? [];
      emAndamento.delete(chave);
      for (const r of esperando) {
        r.setHeader('X-Cache', 'HIT');
        r.status(status).json(corpo);
      }
      res.setHeader('X-Cache', 'MISS');
      return enviar(corpo);
    };
    next();
  });
};
