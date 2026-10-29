import { useEffect, useRef, useState } from 'react';
import type { AlertaTendencia } from '../types';
import Icone from './Icone';

// Sino de notificações do "supervisor no bolso" (barra superior). Substitui
// a antiga faixa de alertas fixa no topo: quando uma máquina tem várias toras
// seguidas acima do limite (ver server/tendencia.ts), o aviso entra aqui e o
// contador do sino sobe — sem cobrir o painel.
//
//   - Aviso NOVO (não estava na leitura anterior): vibra o celular, fala a
//     frase (se a narração estiver ligada) e o sino balança uma vez. A
//     primeira carga da página só mostra — não dispara por problemas que já
//     estavam lá.
//   - "Ciente" tira aquele aviso da lista NESTE aparelho até ele sumir e
//     voltar. Não grava nada: o dashboard é somente leitura por contrato.
//   - Abre e fecha no próprio sino (e na tecla N); fecha com Esc ou clique fora.

const PADRAO_VIBRACAO = [200, 100, 200, 100, 400];

/** Evento da tecla N (useAtalhos): abre/fecha o painel de notificações. */
export const EVENTO_NOTIFICACOES = 'omniroot:notificacoes';

export default function Notificacoes({
  alertas,
  falar,
}: {
  alertas: AlertaTendencia[] | null;
  falar: (texto: string) => void;
}) {
  const [cientes, setCientes] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState(false);
  const [tocou, setTocou] = useState(0); // muda a cada aviso novo: reinicia a animação do sino
  const vistos = useRef<Set<string> | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!alertas) return;
    const atuais = new Set(alertas.map((a) => a.chave));
    if (vistos.current !== null) {
      const novos = alertas.filter((a) => !vistos.current!.has(a.chave));
      if (novos.length > 0) {
        if ('vibrate' in navigator) navigator.vibrate(PADRAO_VIBRACAO);
        falar('Atenção. ' + novos.map((a) => a.texto).join(' '));
        setTocou((n) => n + 1);
      }
    }
    vistos.current = atuais;
    // Aviso que sumiu (problema resolvido) sai da lista de "ciente": se
    // voltar, avisa de novo.
    setCientes((c) => new Set([...c].filter((k) => atuais.has(k))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertas]);

  useEffect(() => {
    const alternar = () => setAberto((v) => !v);
    window.addEventListener(EVENTO_NOTIFICACOES, alternar);
    return () => window.removeEventListener(EVENTO_NOTIFICACOES, alternar);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent | TouchEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('touchstart', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('touchstart', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  const visiveis = (alertas ?? []).filter((a) => !cientes.has(a.chave));
  const n = visiveis.length;
  const rotulo = n === 0 ? 'Notificações: nenhum alerta' : `Notificações: ${n} ${n === 1 ? 'alerta' : 'alertas'}`;

  return (
    <div className="notif" ref={raiz}>
      <button
        type="button"
        className={`btn notif-sino${n > 0 ? ' com-alerta' : ''}`}
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-label={rotulo}
        title={`${rotulo} (tecla N)`}
        onClick={() => setAberto((v) => !v)}
      >
        <span key={tocou} className={tocou ? 'notif-balanca' : undefined}>
          <Icone nome="sino" />
        </span>
        {n > 0 && (
          <span className="notif-contador" aria-hidden="true">
            {n > 9 ? '9+' : n}
          </span>
        )}
      </button>

      {/* Leitor de tela: anuncia quando a contagem muda. */}
      <span className="sr-only" role="status" aria-live="polite">
        {n > 0 ? rotulo : ''}
      </span>

      {aberto && (
        <div className="notif-painel" role="region" aria-label="Notificações">
          <div className="notif-topo">
            <strong>Notificações</strong>
            {n > 0 && <span className="notif-total">{n} {n === 1 ? 'novo' : 'novos'}</span>}
            {n > 1 && (
              <button
                type="button"
                className="notif-todos"
                onClick={() => setCientes((c) => new Set([...c, ...visiveis.map((a) => a.chave)]))}
              >
                Marcar todos como ciente
              </button>
            )}
          </div>
          {n === 0 ? (
            <p className="notif-vazio">Nenhum alerta no momento. Quando uma máquina tiver várias toras seguidas acima do limite, o aviso aparece aqui.</p>
          ) : (
            <ul className="notif-lista">
              {visiveis.map((a) => (
                <li key={a.chave} className="notif-item">
                  <span className="notif-icone" aria-hidden="true">
                    ⚠
                  </span>
                  <span className="notif-texto">{a.texto}</span>
                  <button
                    type="button"
                    className="btn notif-ciente"
                    onClick={() => setCientes((c) => new Set(c).add(a.chave))}
                    title="Tirar este aviso da lista neste aparelho (volta se o problema sumir e reaparecer)"
                  >
                    Ciente
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
