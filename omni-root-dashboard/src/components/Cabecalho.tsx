import { useEffect, useRef, useState } from 'react';
import { api, type Conta } from '../api';
import type { LiveInfo } from '../hooks/useLive';
import type { AlertaTendencia, Filters } from '../types';
import type { Voz } from '../voz';
import AcessibilidadeMenu from './AcessibilidadeMenu';
import ExportMenu from './ExportMenu';
import LiveBadge from './LiveBadge';
import Notificacoes from './Notificacoes';
import TamanhoTexto from './TamanhoTexto';
import ThemeToggle from './ThemeToggle';
import VozMenu from './VozMenu';

// Faixa verde do topo: título, "Ao vivo", narração, exportações, tamanho do
// texto, acessibilidade (daltônico / dislexia), atalhos, tema e a conta
// ("Usuários" e "Configurações" para admin, "Senha" para quem não é
// convidado, "Sair").
export default function Cabecalho({
  live,
  voz,
  filters,
  conta,
  onLogout,
  onUsuarios,
  onConfiguracoes,
  onSenha,
  onAtalhos,
  alertas,
}: {
  live: LiveInfo;
  voz: Voz;
  filters: Filters;
  conta: Conta;
  onLogout: () => void;
  onUsuarios: () => void;
  onConfiguracoes: () => void;
  onSenha: () => void;
  onAtalhos: () => void;
  alertas: AlertaTendencia[] | null;
}) {
  // Menu do celular/tablet: fecha com toque fora, Esc ou se a janela
  // crescer para o tamanho de computador (onde o menu não existe).
  const [menuAberto, setMenuAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuAberto) return;
    const fora = (e: MouseEvent | TouchEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setMenuAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAberto(false);
    };
    const largo = window.matchMedia('(min-width: 1025px)');
    const cresceu = () => largo.matches && setMenuAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('touchstart', fora);
    document.addEventListener('keydown', tecla);
    largo.addEventListener('change', cresceu);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('touchstart', fora);
      document.removeEventListener('keydown', tecla);
      largo.removeEventListener('change', cresceu);
    };
  }, [menuAberto]);

  async function logout() {
    await api.logout().catch(() => {
      /* ignora: seguimos deslogando o cliente de qualquer forma */
    });
    onLogout();
  }

  return (
    <header className="header">
      <div className="header-title">
        {/* No computador a marca está na barra lateral; aqui só no celular/tablet. */}
        <h1>
          <span className="h-marca">Omni-Root</span> Qualidade da madeira
        </h1>
        <span className="subtitle">
          Inspeções sincronizadas do campo — leitura do banco central
        </span>
      </div>
      <div className="header-actions" ref={raiz}>
        <LiveBadge info={live} />
        {/* Sino fica fora do Menu do celular: o contador precisa estar sempre à vista. */}
        <Notificacoes alertas={alertas} falar={(t) => voz.falar(t)} />
        {/* Celular e tablet (até 1024px): os controles abaixo ficam num
            painel aberto por este botão. No computador o botão some e o
            painel é "transparente" (display: contents) — tudo na faixa,
            como sempre. Ver estilos/cabecalho.css. */}
        <button
          type="button"
          className="btn btn-menu"
          aria-expanded={menuAberto}
          aria-controls="header-controles"
          aria-label="Menu"
          onClick={() => setMenuAberto((v) => !v)}
        >
          <span aria-hidden="true">{menuAberto ? '✕' : '☰'}</span> <span className="btn-menu-texto">Menu</span>
        </button>
        <div id="header-controles" className={`header-controles${menuAberto ? ' aberto' : ''}`}>
          <VozMenu voz={voz} />
          <ExportMenu filters={filters} onUnauthorized={onLogout} />
          <TamanhoTexto />
          <AcessibilidadeMenu />
          <button
            type="button"
            className="btn theme-btn btn-atalhos"
            onClick={onAtalhos}
            title="Teclas de atalho (tecla ?)"
            aria-label="Mostrar as teclas de atalho"
          >
            <span aria-hidden="true">⌨</span>
          </button>
          <ThemeToggle />
          <span className="user-chip" title={`${conta.user} · ${conta.papel}`}>
            {conta.nome ?? conta.user}
            {conta.papel === 'admin' && (
              <>
                <button type="button" className="chip-link" onClick={onUsuarios} title="Criar e gerenciar as contas do painel">
                  Usuários
                </button>
                <button type="button" className="chip-link" onClick={onConfiguracoes} title="Regras da aplicação guardadas no banco">
                  Configurações
                </button>
              </>
            )}
            {!conta.plateia && (
              <button type="button" className="chip-link" onClick={onSenha}>
                Senha
              </button>
            )}
            <button type="button" className="chip-link" onClick={logout}>
              Sair
            </button>
          </span>
        </div>
      </div>
    </header>
  );
}
