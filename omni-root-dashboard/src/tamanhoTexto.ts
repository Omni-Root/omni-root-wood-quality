import { useSyncExternalStore } from 'react';

// Tamanho do texto do painel: um multiplicador aplicado como a variável CSS
// --escala-texto no <html> (ver estilos/tokens.css). Pensado para o
// projetor: a banca no fundo da sala lê o mapa e os números. A escolha
// fica no localStorage, como o tema. Botões no cabeçalho (TamanhoTexto) e
// teclas + − 0 (useAtalhos) mexem no mesmo estado.

export const ESCALAS = [0.9, 1, 1.15, 1.3, 1.5, 1.75] as const;
export const ESCALA_PADRAO = 1;

const STORAGE_KEY = 'omniroot-escala-texto';
const ouvintes = new Set<() => void>();

function lerPreferencia(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    if ((ESCALAS as readonly number[]).includes(v)) return v;
  } catch {
    /* storage bloqueado (aba anônima etc.) — cai no padrão */
  }
  return ESCALA_PADRAO;
}

let atual = lerPreferencia();

function aplicar(escala: number): void {
  document.documentElement.style.setProperty('--escala-texto', String(escala));
}

/** Aplica a escala salva ANTES do React renderizar (main.tsx), sem piscar. */
export function aplicarEscalaSalva(): void {
  aplicar(atual);
}

function definir(escala: number): void {
  if (escala === atual) return;
  atual = escala;
  aplicar(escala);
  try {
    localStorage.setItem(STORAGE_KEY, String(escala));
  } catch {
    /* sem persistência neste navegador; a escala ainda vale nesta sessão */
  }
  ouvintes.forEach((f) => f());
}

function passo(delta: 1 | -1): void {
  const i = ESCALAS.indexOf(atual as (typeof ESCALAS)[number]);
  const j = Math.min(ESCALAS.length - 1, Math.max(0, (i < 0 ? 1 : i) + delta));
  definir(ESCALAS[j]);
}

/** Escala no momento (fora de componentes: o aviso do atalho mostra o novo %). */
export const escalaAtual = (): number => atual;
export const aumentarTexto = () => passo(1);
export const diminuirTexto = () => passo(-1);
export const textoPadrao = () => definir(ESCALA_PADRAO);

function inscrever(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

/** Escala atual (re-renderiza quando muda) — os gráficos usam para o tamanho dos eixos. */
export function useEscalaTexto(): number {
  return useSyncExternalStore(inscrever, () => atual);
}
