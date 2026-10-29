import { useEffect, useRef } from 'react';
import type { Atalho } from '../hooks/useAtalhos';

const GRUPOS: Atalho['grupo'][] = ['Ir para', 'Tela', 'Demonstração'];

// Nome legível da tecla na ajuda.
function rotulo(tecla: string): string {
  if (tecla === 'Escape') return 'Esc';
  if (tecla === ' ') return 'Espaço';
  return tecla.length === 1 ? tecla.toUpperCase() : tecla;
}

// Janela com a lista de atalhos (tecla ? ou o botão ⌨ do cabeçalho). Fecha
// com Esc, com o botão ou clicando fora; devolve o foco a quem a abriu.
export default function AjudaAtalhos({ atalhos, onFechar }: { atalhos: Atalho[]; onFechar: () => void }) {
  const fechar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    return () => anterior?.focus?.();
  }, []);

  return (
    <div className="ajuda-fundo" onClick={onFechar}>
      <div
        className="ajuda-atalhos"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ajuda-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ajuda-topo">
          <h2 id="ajuda-titulo">Teclas de atalho</h2>
          <button ref={fechar} type="button" className="btn" onClick={onFechar}>
            Fechar <kbd>Esc</kbd>
          </button>
        </div>
        <div className="ajuda-grupos">
          {GRUPOS.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              <dl>
                {atalhos
                  .filter((a) => a.grupo === g)
                  .map((a) => (
                    <div key={a.teclas[0]} className="ajuda-linha">
                      <dt>
                        <kbd>{rotulo(a.teclas[0])}</kbd>
                      </dt>
                      <dd>{a.descricao}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
