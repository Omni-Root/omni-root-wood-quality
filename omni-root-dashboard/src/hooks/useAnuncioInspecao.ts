import { useEffect, useRef } from 'react';
import { descreverInspecao, type Voz } from '../voz';
import type { UltimaInspecao } from '../types';

// Alerta falado: quando a "última inspeção" muda DEPOIS da primeira carga,
// anuncia conforme a preferência (todas / só falhas / nenhuma). Numa
// rajada do sync (várias toras de uma vez) fala quantas chegaram e
// descreve só a última — sem enfileirar dezenas de frases.
export function useAnuncioInspecao(ultima: UltimaInspecao | null, novas: number, voz: Voz): void {
  const ultimaAnunciada = useRef<number | null>(null);
  const novasVistas = useRef(0);
  useEffect(() => {
    if (!ultima) return;
    if (ultimaAnunciada.current === null) {
      ultimaAnunciada.current = ultima.id; // primeira carga: não anuncia
      novasVistas.current = novas;
      return;
    }
    if (ultima.id === ultimaAnunciada.current) return;
    ultimaAnunciada.current = ultima.id;
    const chegaram = Math.max(1, novas - novasVistas.current);
    novasVistas.current = novas;

    const politica = voz.prefs.anunciar;
    if (politica === 'nenhuma') return;
    if (politica === 'falhas' && ultima.status === 'aprovado') return;
    const prefixo = chegaram > 1 ? `${chegaram} novas inspeções sincronizadas. Última: ` : 'Nova inspeção. ';
    voz.falar(prefixo + descreverInspecao(ultima));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultima?.id]);
}
