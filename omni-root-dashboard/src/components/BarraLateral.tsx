import { useEffect, useState } from 'react';
import logo from '../assets/logo-omniroot.png';
import Icone, { type NomeIcone } from './Icone';
import { CartaoQr, type Plateia } from './QrPlateia';

// Navegação lateral (computador, acima de 1024px). Os itens são as seções
// do painel — as mesmas das teclas 1–8 — e o item ativo acompanha a
// rolagem. No celular e no tablet ela some: lá ficam o Menu do cabeçalho e
// a barra de navegação do rodapé.

const GRUPOS: { titulo: string; itens: { id: string; rotulo: string; icone: NomeIcone; tecla?: string }[] }[] = [
  {
    titulo: 'Painel',
    itens: [
      { id: 'resumo', rotulo: 'Resumo do período', icone: 'resumo', tecla: '1' },
      { id: 'agora', rotulo: 'Agora', icone: 'camera', tecla: '2' },
      { id: 'mapa', rotulo: 'Onde agir', icone: 'mapa', tecla: '3' },
      { id: 'qualidade', rotulo: 'Talhão e clone', icone: 'tabela', tecla: '4' },
    ],
  },
  {
    titulo: 'Análises',
    itens: [
      { id: 'diametro', rotulo: 'Distribuições', icone: 'barras', tecla: '5' },
      { id: 'tempo', rotulo: 'Ao longo do tempo', icone: 'linha', tecla: '6' },
      { id: 'proporcao', rotulo: 'Proporção', icone: 'rosca', tecla: '7' },
      { id: 'calor', rotulo: 'Mapa de calor', icone: 'calor', tecla: '8' },
    ],
  },
];

const IDS = GRUPOS.flatMap((g) => g.itens.map((i) => i.id));

/** Evento disparado por quem leva a página a uma seção (clique aqui, teclas 1–8). */
export const EVENTO_SECAO = 'omniroot:secao';

// Seção "ativa" = a que tem o topo mais perto (por cima) da linha de
// leitura, a 25% da altura da tela. Decide pela POSIÇÃO na página, não pela
// ordem da lista; em empate (seções lado a lado, como "ao longo do tempo" e
// "proporção"), vale a que vem antes na lista. No fim da página, a última.
function useSecaoAtiva(): string {
  const [ativa, setAtiva] = useState(IDS[0]);
  useEffect(() => {
    // Medição direta (8 seções: barato). Sem requestAnimationFrame: o
    // navegador pausa rAF com a janela em segundo plano e o item ativo
    // ficava preso. Remede também quando a página muda de altura (dados
    // chegando, painel recolhido), não só ao rolar.
    // Seção escolhida (clique / atalho): fica marcada enquanto a página rola
    // até ela — perto do fim, a página não rola o bastante para a seção
    // chegar ao topo e a regra de "fim da página" marcaria a última.
    let escolhida: { id: string; ate: number } | null = null;
    const aoEscolher = (e: Event) => {
      escolhida = { id: (e as CustomEvent<string>).detail, ate: performance.now() + 1500 };
      setAtiva(escolhida.id);
    };
    const medir = () => {
      if (escolhida && performance.now() < escolhida.ate) return;
      escolhida = null;
      const linha = window.innerHeight * 0.25;
      let atual = IDS[0];
      let melhorTopo = -Infinity;
      for (const id of IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const topo = el.getBoundingClientRect().top;
        if (topo <= linha && topo > melhorTopo + 1) {
          melhorTopo = topo;
          atual = id;
        }
      }
      const doc = document.documentElement;
      if (doc.scrollHeight > window.innerHeight + 8 && window.innerHeight + window.scrollY >= doc.scrollHeight - 8) {
        atual = IDS[IDS.length - 1];
      }
      setAtiva(atual);
    };
    medir();
    window.addEventListener(EVENTO_SECAO, aoEscolher);
    window.addEventListener('scroll', medir, { passive: true });
    window.addEventListener('resize', medir);
    const obs = new ResizeObserver(medir);
    obs.observe(document.body);
    return () => {
      window.removeEventListener(EVENTO_SECAO, aoEscolher);
      window.removeEventListener('scroll', medir);
      window.removeEventListener('resize', medir);
      obs.disconnect();
    };
  }, []);
  return ativa;
}

export default function BarraLateral({
  onIr,
  onAtalhos,
  qr,
  onQr,
}: {
  onIr: (id: string) => void;
  onAtalhos: () => void;
  qr: Plateia | null; // null = sem link público (ou convidado): sem cartão
  onQr: () => void;
}) {
  const ativa = useSecaoAtiva();
  return (
    <aside className="barra-lateral" aria-label="Seções do painel">
      <div className="bl-marca">
        {/* Brasão do Omni-Root (harvester), PNG com fundo transparente. O
            nome ao lado já diz "OmniRoot": a imagem é decorativa (alt=""). */}
        <img className="bl-logo" src={logo} alt="" width={48} height={48} />
        <span className="bl-nome">
          Omni<b>Root</b>
        </span>
      </div>

      <nav className="bl-nav">
        {GRUPOS.map((g) => (
          <div key={g.titulo} className="bl-grupo">
            <span className="bl-grupo-titulo">{g.titulo}</span>
            {g.itens.map((i) => (
              <a
                key={i.id}
                href={`#${i.id}`}
                className={`bl-item${ativa === i.id ? ' ativo' : ''}`}
                aria-current={ativa === i.id ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onIr(i.id);
                }}
              >
                <Icone nome={i.icone} />
                <span>{i.rotulo}</span>
                {i.tecla && <kbd className="bl-tecla">{i.tecla}</kbd>}
              </a>
            ))}
          </div>
        ))}
      </nav>

      {qr && <CartaoQr estado={qr} onAmpliar={onQr} />}

      <button type="button" className="bl-dica" onClick={onAtalhos}>
        <span className="bl-dica-icone">
          <Icone nome="teclado" />
        </span>
        <span>
          <strong>Atalhos de teclado</strong>
          <span>Aperte ? para ver todos</span>
        </span>
      </button>
    </aside>
  );
}
