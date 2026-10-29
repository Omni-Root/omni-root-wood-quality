import { useEffect, useRef, useState } from 'react';
import { definirRitmo, lerEconomia, paginaVisivel, type Ritmo } from '../economico';

// Assina /api/events (Server-Sent Events). Chama `onNova` (com debounce: o
// sync_daemon manda várias toras em rajada, e refazer as consultas uma vez
// por rajada basta) quando:
//   - chega tora nova ou refinada do campo;
//   - a conexão volta depois de cair: o que aconteceu no intervalo não
//     chegou por evento, então os painéis são relidos.
//
// Conexão morta que parece viva: se o servidor reinicia atrás do proxy do
// Vite (o `tsx watch` reinicia a cada arquivo salvo) ou a rede cai no meio
// do caminho, o navegador pode continuar "conectado" a nada — sem erro e sem
// evento. Por isso o servidor manda um 'ping' a cada 15 s (server/live.ts) e,
// passados SILENCIO_MAX_MS sem nenhuma mensagem, a conexão é refeita aqui.
// `estado` mostra isso na interface.
//
// Modo econômico (celular pelo túnel, src/economico.ts): o 'hello' e o
// evento 'ritmo' trazem o ritmo da lotação; com a aba escondida a conexão
// fecha (o celular sai da contagem de lotação) e reabre ao voltar, relendo.
export type EstadoLive = 'conectando' | 'ao-vivo' | 'reconectando';

export const EVENTO_POSICAO = 'omniroot:posicao';
export const EVENTO_RASTRO = 'omniroot:rastro';

const SILENCIO_MAX_MS = 40_000; // ~2,5 pings perdidos
const VERIFICAR_MS = 5_000;

export interface LiveInfo {
  estado: EstadoLive;
  ultimaEm: Date | null; // quando chegou a última tora
  novas: number; // toras recebidas desde que a página carregou
  push: boolean; // true = trigger LISTEN/NOTIFY ativo; false = só polling
}

export function useLive(onNova: () => void, debounceMs = 800): LiveInfo {
  const [info, setInfo] = useState<LiveInfo>({ estado: 'conectando', ultimaEm: null, novas: 0, push: false });
  const cb = useRef(onNova);
  cb.current = onNova;

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let caiu = false;
    let ultimaMensagem = Date.now();
    const recarregar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), debounceMs);
    };
    // Qualquer mensagem (inclusive o ping) prova que a conexão está viva.
    const ouvir = (evento: string, fn: (ev: MessageEvent) => void = () => undefined) =>
      es!.addEventListener(evento, (ev) => {
        ultimaMensagem = Date.now();
        fn(ev as MessageEvent);
      });

    const conectar = () => {
      es = new EventSource('/api/events');
      ultimaMensagem = Date.now();

      ouvir('hello', (ev) => {
        const d = JSON.parse(ev.data) as { listen: boolean; ritmo?: Ritmo };
        if (d.ritmo) definirRitmo(d.ritmo);
        setInfo((i) => ({ ...i, estado: 'ao-vivo', push: d.listen }));
        if (caiu) {
          caiu = false;
          recarregar();
          window.dispatchEvent(new Event(EVENTO_RASTRO)); // trajeto feito no intervalo
        }
      });
      ouvir('ping');
      ouvir('ritmo', (ev) => {
        try {
          definirRitmo(JSON.parse(ev.data) as Ritmo);
        } catch {
          /* payload inválido: mantém o ritmo atual */
        }
      });
      ouvir('tora', (ev) => {
        // op = 'UPDATE' é a MESMA tora sendo refinada (evento incremental):
        // atualiza os painéis, mas não conta como inspeção nova.
        let nova = true;
        try {
          nova = (JSON.parse(ev.data) as { op?: string }).op !== 'UPDATE';
        } catch {
          /* payload sem op: trata como nova */
        }
        setInfo((i) => ({ ...i, estado: 'ao-vivo', ultimaEm: new Date(), novas: nova ? i.novas + 1 : i.novas }));
        recarregar();
      });
      // Frota (server/frota.ts): posição ao vivo de uma máquina e "trajeto novo
      // no banco". Repassados como eventos da janela para o mapa (useFrota), sem
      // abrir uma segunda conexão SSE.
      ouvir('posicao', (ev) => {
        try {
          window.dispatchEvent(new CustomEvent(EVENTO_POSICAO, { detail: JSON.parse(ev.data) }));
        } catch {
          /* payload inválido: ignora */
        }
      });
      ouvir('rastro', () => window.dispatchEvent(new Event(EVENTO_RASTRO)));
      es.onerror = () => {
        caiu = true;
        setInfo((i) => ({ ...i, estado: 'reconectando' }));
      };
    };

    conectar();

    // Econômico com a aba escondida: fecha a conexão; ao voltar, reabre e o
    // 'hello' (com caiu = true) relê os painéis.
    let pausado = false;
    const aoMudarVisibilidade = () => {
      if (!lerEconomia().economico) return;
      if (!paginaVisivel() && !pausado) {
        pausado = true;
        caiu = true;
        es?.close();
      } else if (paginaVisivel() && pausado) {
        pausado = false;
        conectar();
      }
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);

    // Silêncio demais: a conexão morreu sem avisar. Fecha e abre outra; o
    // 'hello' da nova relê os painéis.
    const vigia = setInterval(() => {
      if (pausado) return;
      if (Date.now() - ultimaMensagem < SILENCIO_MAX_MS) return;
      caiu = true;
      setInfo((i) => ({ ...i, estado: 'reconectando' }));
      es?.close();
      conectar();
    }, VERIFICAR_MS);

    return () => {
      clearInterval(vigia);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [debounceMs]);

  return info;
}
