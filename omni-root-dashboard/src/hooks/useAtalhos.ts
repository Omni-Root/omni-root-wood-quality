import { useEffect, useRef } from 'react';

// Teclas de atalho do painel ("modo apresentação"): uma tecla por parte do
// roteiro da demo, sem caçar o mouse na frente da banca. A MESMA lista
// alimenta a ajuda (tecla ?), então ela nunca fica desatualizada.
//
// Só teclas sem Ctrl/Alt/Cmd (os atalhos do navegador continuam intactos) e
// nunca enquanto se digita num campo ou se escolhe num seletor.

export interface Atalho {
  /** Valores de KeyboardEvent.key (letras em minúsculas). O primeiro é o mostrado na ajuda. */
  teclas: string[];
  descricao: string;
  grupo: 'Ir para' | 'Tela' | 'Demonstração';
  acao: () => void;
}

function digitando(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false;
  if (alvo.isContentEditable) return true;
  const tag = alvo.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  // Checkbox e botões de rádio não recebem texto: o atalho continua valendo.
  const tipo = (alvo as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(tipo);
}

export function useAtalhos(atalhos: Atalho[]): void {
  // A lista muda a cada render (fecha sobre o estado do painel); o ouvinte
  // é registrado uma vez e lê sempre a versão mais recente.
  const atual = useRef(atalhos);
  atual.current = atalhos;

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (digitando(e.target)) return;
      const tecla = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const atalho = atual.current.find((a) => a.teclas.includes(tecla));
      if (!atalho) return;
      e.preventDefault();
      atalho.acao();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);
}
