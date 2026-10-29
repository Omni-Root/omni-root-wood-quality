import { useEffect, useRef, useState } from 'react';
import { api, UnauthorizedError } from '../api';

// Janela "Minha senha" (botão no chip do usuário, no cabeçalho). Pede a
// senha atual — conta que só entra por Google/Microsoft/GitHub não tem, e
// define a primeira deixando o campo vazio. Trocar derruba as OUTRAS sessões
// da conta; esta continua (o servidor manda um cookie novo).
export default function MinhaSenha({ onFechar, onLogout }: { onFechar: () => void; onLogout: () => void }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const primeiro = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    primeiro.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  }, [onFechar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nova !== repetida) {
      setErro('A nova senha e a repetição não conferem.');
      return;
    }
    setBusy(true);
    try {
      await api.trocarSenha(atual, nova);
      setOk(true);
      setAtual('');
      setNova('');
      setRepetida('');
    } catch (err) {
      if (err instanceof UnauthorizedError) return onLogout();
      setErro(err instanceof Error ? err.message : 'Não foi possível trocar a senha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ajuda-fundo" onClick={onFechar}>
      <div
        className="ajuda-atalhos contas-janela contas-estreita"
        role="dialog"
        aria-modal="true"
        aria-labelledby="senha-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ajuda-topo">
          <h2 id="senha-titulo">Minha senha</h2>
          <button type="button" className="btn" onClick={onFechar}>
            Fechar <kbd>Esc</kbd>
          </button>
        </div>

        {erro && (
          <div className="login-error" role="alert">
            {erro}
          </div>
        )}
        {ok && (
          <p className="contas-ok" role="status">
            Senha trocada. As outras sessões desta conta foram encerradas.
          </p>
        )}

        <form className="contas-form" onSubmit={salvar}>
          <label>
            Senha atual
            <input
              ref={primeiro}
              type="password"
              value={atual}
              autoComplete="current-password"
              onChange={(e) => setAtual(e.target.value)}
            />
            <span className="contas-dica">Vazia se a conta só entra por Google, Microsoft ou GitHub.</span>
          </label>
          <label>
            Nova senha
            <input
              type="password"
              value={nova}
              minLength={10}
              autoComplete="new-password"
              onChange={(e) => setNova(e.target.value)}
            />
            <span className="contas-dica">Pelo menos 10 caracteres.</span>
          </label>
          <label>
            Repita a nova senha
            <input
              type="password"
              value={repetida}
              autoComplete="new-password"
              onChange={(e) => setRepetida(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primario" disabled={busy || !nova || !repetida}>
            {busy ? 'Salvando…' : 'Trocar senha'}
          </button>
        </form>
      </div>
    </div>
  );
}
