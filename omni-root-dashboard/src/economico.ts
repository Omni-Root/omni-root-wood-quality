import { useSyncExternalStore } from 'react';

// Modo econômico no navegador (o lado do servidor está em server/economia.ts).
// Liga sozinho quando o painel é aberto pelo túnel público — o celular da
// plateia, pelo QR code. O notebook (e o telão) nunca entram nele.
//
//   - o servidor diz se é econômico (/api/me) e o RITMO da lotação atual
//     (no 'hello' e no evento 'ritmo' do SSE, ver hooks/useLive.ts);
//   - com o ritmo, as recargas são espaçadas: a "última inspeção" no máximo a
//     cada `ultimaMs`, o resto do painel a cada `painelMs` — os avisos de
//     tora que chegam no meio se juntam numa recarga só (limitador abaixo);
//   - tela apagada ou aba em segundo plano: para de pedir dados (e a conexão
//     de tempo real fecha, saindo da contagem de lotação); ao voltar, relê.

export interface Ritmo {
  nivel: 'leve' | 'medio' | 'cheio';
  conectados: number;
  ultimaMs: number;
  painelMs: number;
  fps: number;
}

interface Estado {
  economico: boolean;
  ritmo: Ritmo;
}

// Até o primeiro 'hello' chegar, a faixa do meio.
let estado: Estado = {
  economico: false,
  ritmo: { nivel: 'medio', conectados: 0, ultimaMs: 10_000, painelMs: 60_000, fps: 1 },
};
const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const f of ouvintes) f();
}

export function definirEconomico(economico: boolean): void {
  if (estado.economico === economico) return;
  estado = { ...estado, economico };
  avisar();
}

export function definirRitmo(ritmo: Ritmo): void {
  estado = { ...estado, ritmo };
  avisar();
}

/** Leitura direta (fora do React: temporizadores, limitadores). */
export function lerEconomia(): Estado {
  return estado;
}

export function useEconomia(): Estado {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => ouvintes.delete(f);
    },
    () => estado,
  );
}

/** A aba está à vista (tela acesa, não em segundo plano)? */
export function paginaVisivel(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** No modo econômico com a aba escondida, polling deve pular a vez. */
export function devePausar(): boolean {
  return estado.economico && !paginaVisivel();
}

export interface Limitador {
  /** Pede a ação: roda já, se o intervalo passou; senão, uma vez no fim dele. */
  pedir(): void;
  /** A ação acabou de acontecer por outro caminho (conta como feita agora). */
  marcar(): void;
  cancelar(): void;
}

/**
 * No máximo uma execução a cada `intervaloMs()` (lido na hora: o ritmo pode
 * mudar). Pedidos no meio do intervalo não se perdem nem se acumulam: viram
 * UMA execução no fim dele.
 */
export function limitador(intervaloMs: () => number, acao: () => void): Limitador {
  let ultima = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const executar = () => {
    timer = null;
    ultima = Date.now();
    acao();
  };
  return {
    pedir() {
      if (timer) return;
      const falta = ultima + intervaloMs() - Date.now();
      if (falta <= 0) executar();
      else timer = setTimeout(executar, falta);
    },
    marcar() {
      ultima = Date.now();
    },
    cancelar() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
