import { useSyncExternalStore } from 'react';

// Modos de acessibilidade do painel, ligados/desligados de forma
// independente (menu "Acessibilidade" no cabeçalho, teclas C, D e X). Cada um
// vira um atributo no <html> e o CSS faz o resto (estilos/acessibilidade.css):
//
//   daltonico  data-cores="daltonico": status em azul / laranja / vinho em vez
//              de verde / amarelo / vermelho, com símbolo (✓ ! ✕) junto da cor.
//              Medido com o validador de paleta: aprovado × rejeitado tinham
//              ΔE 3,8 para deuteranopia (praticamente a mesma cor; mínimo
//              aceitável 8); a paleta nova dá 19 no claro e 13,6 no escuro.
//   dislexia   data-leitura="dislexia": fonte OpenDyslexic (local, funciona
//              offline), mais espaço entre letras, palavras e linhas, sem
//              itálico nem CAIXA ALTA — recomendações do guia de estilo da
//              British Dyslexia Association.
//   contraste  data-contraste="alto": preto e branco puros (claro) ou branco
//              sobre preto (escuro), bordas de 2px, sem sombra/transparência,
//              status em tons fortes. Todo texto e cor de status >= 7:1 (nível
//              AAA da WCAG). Projetor "lavado" e baixa visão.
//
// A escolha fica no localStorage, como o tema e o tamanho do texto.

export type Modo = 'daltonico' | 'dislexia' | 'contraste';

const ATRIBUTO: Record<Modo, { nome: string; valor: string }> = {
  daltonico: { nome: 'data-cores', valor: 'daltonico' },
  dislexia: { nome: 'data-leitura', valor: 'dislexia' },
  contraste: { nome: 'data-contraste', valor: 'alto' },
};

const STORAGE_KEY = 'omniroot-acessibilidade';
const ouvintes = new Set<() => void>();

function lerPreferencia(): Record<Modo, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return { daltonico: o.daltonico === true, dislexia: o.dislexia === true, contraste: o.contraste === true };
    }
  } catch {
    /* storage bloqueado ou valor inválido — tudo desligado */
  }
  return { daltonico: false, dislexia: false, contraste: false };
}

let atual = lerPreferencia();

function aplicar(): void {
  const root = document.documentElement;
  (Object.keys(ATRIBUTO) as Modo[]).forEach((m) => {
    const { nome, valor } = ATRIBUTO[m];
    if (atual[m]) root.setAttribute(nome, valor);
    else root.removeAttribute(nome);
  });
}

/** Aplica os modos salvos ANTES do React renderizar (main.tsx), sem piscar. */
export function aplicarAcessibilidadeSalva(): void {
  aplicar();
}

/** Liga/desliga um modo e devolve o novo estado (para o aviso do atalho). */
export function alternarModo(m: Modo): boolean {
  atual = { ...atual, [m]: !atual[m] };
  aplicar();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(atual));
  } catch {
    /* sem persistência; vale nesta sessão */
  }
  ouvintes.forEach((f) => f());
  return atual[m];
}

function inscrever(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

export function useModo(m: Modo): boolean {
  return useSyncExternalStore(inscrever, () => atual[m]);
}
