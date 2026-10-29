import { useEffect, useRef, useState } from 'react';
import { api, UnauthorizedError } from '../api';
import type { Filters } from '../types';

export type Kind = 'csv' | 'pdf' | 'stanford';

// Um único botão "Exportar ▾" com as três saídas num menu. Três botões lado a
// lado no cabeçalho não cabiam ao lado do título em janelas médias (o header
// quebrava em duas linhas) e competiam com o chip "Ao vivo". O menu fecha com
// clique fora, Esc ou ao escolher uma opção. As teclas B, P e S do painel
// fazem o mesmo que escolher no menu (ver pedirExportacao).
const OPCOES: { kind: Kind; titulo: string; descricao: string; tecla: string; run: (f: Filters) => Promise<void> }[] = [
  { kind: 'csv', titulo: 'CSV', descricao: 'Dados brutos das inspeções (Excel pt-BR)', tecla: 'B', run: (f) => api.exportCsv(f) },
  { kind: 'pdf', titulo: 'Relatório PDF', descricao: 'Sumário do período, gerado no servidor', tecla: 'P', run: (f) => api.exportPdf(f) },
  {
    kind: 'stanford',
    titulo: 'StanForD (.hpr)',
    descricao: 'XML padrão florestal, um arquivo por máquina em ZIP',
    tecla: 'S',
    run: (f) => api.exportStanford(f),
  },
];

// Atalho de teclado: exporta pelo MESMO caminho do menu — o botão mostra
// "Gerando…" e um erro aparece ao lado dele. Devolve false se já há uma
// exportação em andamento.
const EVENTO_EXPORTAR = 'omniroot:exportar';
export function pedirExportacao(kind: Kind): boolean {
  return !window.dispatchEvent(new CustomEvent<Kind>(EVENTO_EXPORTAR, { detail: kind, cancelable: true }));
}

export default function ExportMenu({
  filters,
  onUnauthorized,
}: {
  filters: Filters;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setOpen(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [open]);

  const exportar = async (kind: Kind, fn: () => Promise<void>) => {
    setOpen(false);
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : 'Falha na exportação');
    } finally {
      setBusy(null);
    }
  };

  // O ouvinte do atalho é registrado uma vez e lê sempre o estado atual.
  const atual = useRef({ filters, busy, exportar });
  atual.current = { filters, busy, exportar };
  useEffect(() => {
    const aoPedir = (e: Event) => {
      const o = OPCOES.find((x) => x.kind === (e as CustomEvent<Kind>).detail);
      if (!o || atual.current.busy) return;
      e.preventDefault(); // avisa pedirExportacao() que a exportação começou
      void atual.current.exportar(o.kind, () => o.run(atual.current.filters));
    };
    window.addEventListener(EVENTO_EXPORTAR, aoPedir);
    return () => window.removeEventListener(EVENTO_EXPORTAR, aoPedir);
  }, []);

  const ocupado = OPCOES.find((o) => o.kind === busy);

  return (
    <div className="export-menu" ref={raiz}>
      <button
        type="button"
        className="btn"
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Exportar as inspeções do período e máquina filtrados (teclas B, P e S)"
      >
        {ocupado ? `Gerando ${ocupado.titulo}…` : 'Exportar'}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="export-dropdown" role="menu" aria-label="Formatos de exportação">
          {OPCOES.map((o) => (
            <button
              key={o.kind}
              type="button"
              role="menuitem"
              className="export-item"
              onClick={() => void exportar(o.kind, () => o.run(filters))}
            >
              <span className="export-item-topo">
                <strong>{o.titulo}</strong>
                <kbd>{o.tecla}</kbd>
              </span>
              <span>{o.descricao}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <span className="export-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
