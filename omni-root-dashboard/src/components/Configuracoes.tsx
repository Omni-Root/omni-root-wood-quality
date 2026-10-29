import { useCallback, useEffect, useRef, useState } from 'react';
import { api, UnauthorizedError } from '../api';
import type { Configuracao } from '../types';

// Janela "Configurações" (só admin; link no chip da conta): as regras da
// aplicação guardadas no banco (tabela configuracoes). Cada uma é salva
// sozinha e vale em segundos, sem reiniciar o servidor. Tipo e faixa são
// conferidos no servidor (server/configuracoes.ts).

function quando(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function Linha({
  item,
  onSalvar,
  busy,
}: {
  item: Configuracao;
  onSalvar: (valor: Configuracao['valor']) => void;
  busy: boolean;
}) {
  const [rascunho, setRascunho] = useState(String(item.valor));
  useEffect(() => setRascunho(String(item.valor)), [item.valor]);
  const id = `config-${item.chave}`;
  const mudou = rascunho !== String(item.valor);

  const controle =
    item.tipo === 'booleano' ? (
      <button
        id={id}
        type="button"
        className={`contas-situacao ${item.valor ? 'ativa' : 'inativa'}`}
        aria-pressed={item.valor === true}
        disabled={busy}
        onClick={() => onSalvar(!item.valor)}
      >
        {item.valor ? 'Ligado' : 'Desligado'}
      </button>
    ) : (
      <form
        className="contas-inline config-campo"
        onSubmit={(e) => {
          e.preventDefault();
          onSalvar(item.tipo === 'inteiro' ? Number(rascunho) : rascunho);
        }}
      >
        <input
          id={id}
          type={item.tipo === 'inteiro' ? 'number' : 'text'}
          value={rascunho}
          min={item.min}
          max={item.max}
          step={item.tipo === 'inteiro' ? 1 : undefined}
          onChange={(e) => setRascunho(e.target.value)}
        />
        {item.unidade && <span className="config-unidade">{item.unidade}</span>}
        <button type="submit" className="btn btn-primario" disabled={busy || !mudou || !rascunho.trim()}>
          Salvar
        </button>
      </form>
    );

  return (
    <div className="config-item">
      <div className="config-texto">
        <label htmlFor={id} className="config-rotulo">
          {item.rotulo}
        </label>
        <p className="contas-dica">{item.descricao}</p>
        <p className="contas-dica">
          Padrão: {typeof item.padrao === 'boolean' ? (item.padrao ? 'Ligado' : 'Desligado') : String(item.padrao)}
          {item.unidade ? ` ${item.unidade}` : ''}
          {item.atualizadoPor && ` · alterado por ${item.atualizadoPor} em ${quando(item.atualizadoEm)}`}
        </p>
      </div>
      {controle}
    </div>
  );
}

export default function Configuracoes({ onFechar, onLogout }: { onFechar: () => void; onLogout: () => void }) {
  const [itens, setItens] = useState<Configuracao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fechar = useRef<HTMLButtonElement>(null);

  const falhou = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) return onLogout();
      setErro(err instanceof Error ? err.message : 'Falha ao falar com o servidor');
    },
    [onLogout],
  );

  useEffect(() => {
    api.configuracoes().then(setItens, falhou);
  }, [falhou]);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  }, [onFechar]);

  async function salvar(item: Configuracao, valor: Configuracao['valor']) {
    setBusy(true);
    setErro(null);
    setAviso(null);
    try {
      setItens(await api.mudarConfiguracao(item.chave, valor));
      setAviso(`"${item.rotulo}" salvo. Já está valendo.`);
    } catch (err) {
      falhou(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ajuda-fundo" onClick={onFechar}>
      <div
        className="ajuda-atalhos contas-janela config-janela"
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ajuda-topo">
          <h2 id="config-titulo">Configurações</h2>
          <button ref={fechar} type="button" className="btn" onClick={onFechar}>
            Fechar <kbd>Esc</kbd>
          </button>
        </div>
        {erro && (
          <div className="login-error" role="alert">
            {erro}
          </div>
        )}
        {aviso && (
          <p className="contas-ok" role="status">
            {aviso}
          </p>
        )}
        {!itens ? (
          <p className="contas-dica">{erro ? 'Não foi possível carregar as configurações.' : 'Carregando…'}</p>
        ) : (
          <div className="config-lista">
            {itens.map((item) => (
              <Linha key={item.chave} item={item} busy={busy} onSalvar={(v) => void salvar(item, v)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
