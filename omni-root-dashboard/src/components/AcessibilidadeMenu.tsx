import { useEffect, useRef, useState } from 'react';
import { alternarModo, useModo, type Modo } from '../acessibilidade';

const OPCOES: { modo: Modo; titulo: string; descricao: string; tecla: string }[] = [
  {
    modo: 'daltonico',
    titulo: 'Cores para daltônicos',
    descricao: 'Status em azul, laranja e vinho, com símbolo ✓ ! ✕ junto da cor',
    tecla: 'C',
  },
  {
    modo: 'dislexia',
    titulo: 'Leitura para dislexia',
    descricao: 'Fonte OpenDyslexic, mais espaço entre letras e linhas',
    tecla: 'D',
  },
  {
    modo: 'contraste',
    titulo: 'Alto contraste',
    descricao: 'Preto e branco puros, bordas fortes: projetor e baixa visão',
    tecla: 'X',
  },
];

function Opcao({ o }: { o: (typeof OPCOES)[number] }) {
  const ligado = useModo(o.modo);
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={ligado}
      className={`export-item acess-item${ligado ? ' ligado' : ''}`}
      onClick={() => alternarModo(o.modo)}
    >
      <span className="acess-chave" aria-hidden="true" />
      <span className="acess-texto">
        <strong>
          {o.titulo} <kbd>{o.tecla}</kbd>
        </strong>
        <span>{o.descricao}</span>
      </span>
    </button>
  );
}

// "Acessibilidade ▾" no cabeçalho: os três modos como chaves liga/desliga.
// O menu fica aberto ao alternar (dá para ligar vários e ver o efeito);
// fecha com clique fora ou Esc. Um ponto no botão avisa que há modo ligado.
export default function AcessibilidadeMenu() {
  const [open, setOpen] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const daltonico = useModo('daltonico');
  const dislexia = useModo('dislexia');
  const contraste = useModo('contraste');
  const algumLigado = daltonico || dislexia || contraste;

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

  return (
    <div className="export-menu" ref={raiz}>
      <button
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Cores para daltônicos (C), leitura para dislexia (D) e alto contraste (X)"
      >
        Acessibilidade
        {algumLigado && <span className="acess-ponto" aria-label="(modo ligado)" />}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="export-dropdown" role="menu" aria-label="Acessibilidade">
          {OPCOES.map((o) => (
            <Opcao key={o.modo} o={o} />
          ))}
        </div>
      )}
    </div>
  );
}
