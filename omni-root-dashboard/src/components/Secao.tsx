import { useSyncExternalStore, type ReactNode } from 'react';

// Painel da grade com botão de recolher (▾ no canto direito): esconde o
// conteúdo e deixa só o título, para tirar da tela o que não entra na
// apresentação. Quais estão recolhidos fica no localStorage — arruma uma vez
// antes da demo e continua assim. O atalho E expande tudo; pular para uma
// seção pelo número (1–8) a expande.

const STORAGE_KEY = 'omniroot-recolhidas';
const ouvintes = new Set<() => void>();

function ler(): ReadonlySet<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(v)) return new Set(v.filter((x): x is string => typeof x === 'string'));
  } catch {
    /* storage bloqueado ou valor inválido — tudo expandido */
  }
  return new Set();
}

let recolhidas = ler();

function gravar(novo: ReadonlySet<string>): void {
  recolhidas = novo;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...novo]));
  } catch {
    /* sem persistência; vale nesta sessão */
  }
  ouvintes.forEach((f) => f());
}

export function definirRecolhida(id: string, recolher: boolean): void {
  if (recolhidas.has(id) === recolher) return;
  const novo = new Set(recolhidas);
  if (recolher) novo.add(id);
  else novo.delete(id);
  gravar(novo);
}

export function estaRecolhida(id: string): boolean {
  return recolhidas.has(id);
}

export function expandirTodas(): boolean {
  if (recolhidas.size === 0) return false;
  gravar(new Set());
  return true;
}

function inscrever(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

function useRecolhida(id: string): boolean {
  return useSyncExternalStore(inscrever, () => recolhidas.has(id));
}

export default function Secao({
  id,
  titulo,
  sub,
  className = '',
  acoes,
  children,
}: {
  id: string;
  titulo: string;
  sub?: ReactNode;
  className?: string;
  /** Controles do canto direito (botão Ler, seletor…); somem quando recolhido. */
  acoes?: ReactNode;
  children: ReactNode;
}) {
  const recolhida = useRecolhida(id);
  const corpo = `${id}-corpo`;
  return (
    <section className={`panel ${className}${recolhida ? ' recolhida' : ''}`} id={id}>
      {/* O ▾ fica FORA da linha que quebra: título longo em coluna estreita
          (ou texto ampliado) empurra as ações para baixo, nunca o ▾. */}
      <div className="secao-topo">
        <div className="panel-controls">
          <div>
            <h2>{titulo}</h2>
            {sub && !recolhida && <p className="panel-sub">{sub}</p>}
          </div>
          {acoes && !recolhida && <div className="panel-opcoes">{acoes}</div>}
        </div>
        <button
          type="button"
          className="btn-recolher"
          onClick={() => definirRecolhida(id, !recolhida)}
          aria-expanded={!recolhida}
          aria-controls={corpo}
          title={recolhida ? `Mostrar "${titulo}"` : `Recolher "${titulo}"`}
          aria-label={recolhida ? `Mostrar ${titulo}` : `Recolher ${titulo}`}
        >
          <span aria-hidden="true">▾</span>
        </button>
      </div>
      {!recolhida && <div id={corpo}>{children}</div>}
    </section>
  );
}
