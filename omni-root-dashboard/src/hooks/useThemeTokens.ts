import { useEffect, useState } from 'react';

// O Recharts recebe cores como atributos SVG, onde var(--x) não resolve.
// Este hook lê os tokens computados do tema e re-lê quando o esquema
// claro/escuro do sistema muda.
export interface ThemeTokens {
  grid: string;
  axis: string;
  muted: string;
  textSecondary: string;
  surface: string;
  border: string;
  accent: string;
  textPrimary: string;
  status: { aprovado: string; quarentena: string; reprovado: string };
}

function readTokens(): ThemeTokens {
  const s = getComputedStyle(document.documentElement);
  const get = (name: string) => s.getPropertyValue(name).trim();
  return {
    grid: get('--grid'),
    axis: get('--axis'),
    muted: get('--text-muted'),
    textSecondary: get('--text-secondary'),
    surface: get('--surface'),
    border: get('--border'),
    accent: get('--accent'),
    textPrimary: get('--text-primary'),
    status: {
      aprovado: get('--status-good'),
      quarentena: get('--status-warning'),
      reprovado: get('--status-critical'),
    },
  };
}

export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(readTokens);
  useEffect(() => {
    const reler = () => setTokens(readTokens());

    // 1) Preferência do SISTEMA muda (vale quando o tema está em "Sistema").
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', reler);

    // 2) Troca MANUAL pelo botão de tema: o ThemeToggle escreve data-theme no
    //    <html>, então observamos esse atributo. Sem isto, as cores dos
    //    gráficos (que o Recharts recebe como atributo SVG, onde var(--x) não
    //    resolve) ficariam congeladas no tema anterior.
    //    Os modos daltônico (data-cores) e alto contraste (data-contraste)
    //    trocam cores: mesma razão.
    const observador = new MutationObserver(reler);
    observador.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-cores', 'data-contraste'],
    });

    return () => {
      mq.removeEventListener('change', reler);
      observador.disconnect();
    };
  }, []);
  return tokens;
}

// Cores de status do tema CLARO, como hex, para quem não puder usar o hook
// (ex.: código fora de componente). Dentro de componentes prefira
// useThemeTokens().status, que acompanha o tema escuro.
export const STATUS_HEX = {
  aprovado: '#367c2b',
  quarentena: '#d99a00',
  reprovado: '#c0392b',
} as const;
