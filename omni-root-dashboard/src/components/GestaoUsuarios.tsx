import { useCallback, useEffect, useRef, useState } from 'react';
import { api, UnauthorizedError, type MudancaConta } from '../api';
import type { Papel, Usuario } from '../types';

// Janela "Usuários" (só admin; botão no cabeçalho): cria contas, muda papel,
// ativa/desativa, define ou tira a senha, renomeia e remove. Toda regra vale
// no servidor (server/rotas/usuarios.ts); aqui só se evita oferecer o que ele
// recusaria — a própria conta não muda de papel, não se desativa nem se
// remove. Mudar papel, senha ou ativo derruba as sessões abertas da conta.

const PAPEIS: { valor: Papel; rotulo: string; descricao: string }[] = [
  { valor: 'admin', rotulo: 'Administrador', descricao: 'painel + gestão das contas' },
  { valor: 'leitor', rotulo: 'Leitor', descricao: 'painel e exportações' },
  { valor: 'convidado', rotulo: 'Convidado', descricao: 'painel no modo econômico (visitante)' },
];

const ROTULO_PAPEL = Object.fromEntries(PAPEIS.map((p) => [p.valor, p.rotulo])) as Record<Papel, string>;

function quando(iso: string | null): string {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

type Edicao = { id: number; tipo: 'nome' | 'senha'; valor: string } | { id: number; tipo: 'remover' };

export default function GestaoUsuarios({
  euLogin,
  onFechar,
  onLogout,
}: {
  euLogin: string;
  onFechar: () => void;
  onLogout: () => void;
}) {
  const [contas, setContas] = useState<Usuario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [nova, setNova] = useState({ login: '', nome: '', papel: 'leitor' as Papel, senha: '' });
  const fechar = useRef<HTMLButtonElement>(null);

  const falhou = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) return onLogout();
      setErro(err instanceof Error ? err.message : 'Falha ao falar com o servidor');
    },
    [onLogout],
  );

  const carregar = useCallback(() => {
    api.usuarios().then(setContas, falhou);
  }, [falhou]);

  useEffect(() => {
    carregar();
  }, [carregar]);

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

  // Roda uma mudança, mostra o resultado e recarrega a lista.
  async function executar(acao: () => Promise<unknown>, mensagem: string) {
    setBusy(true);
    setErro(null);
    setAviso(null);
    try {
      await acao();
      setAviso(mensagem);
      setEdicao(null);
      carregar();
    } catch (err) {
      falhou(err);
    } finally {
      setBusy(false);
    }
  }

  function mudar(c: Usuario, m: MudancaConta, mensagem: string) {
    void executar(() => api.mudarUsuario(c.id, m), mensagem);
  }

  function criar(e: React.FormEvent) {
    e.preventDefault();
    void executar(async () => {
      const criada = await api.criarUsuario(nova);
      setNova({ login: '', nome: '', papel: 'leitor', senha: '' });
      return criada;
    }, `Conta ${nova.login.trim().toLowerCase()} criada.`);
  }

  function salvarEdicao(c: Usuario) {
    if (!edicao || edicao.id !== c.id) return;
    if (edicao.tipo === 'nome') mudar(c, { nome: edicao.valor }, `Nome de ${c.login} atualizado.`);
    else if (edicao.tipo === 'senha') mudar(c, { senha: edicao.valor }, `Senha de ${c.login} definida. As sessões abertas dela caíram.`);
    else void executar(() => api.removerUsuario(c.id), `Conta ${c.login} removida.`);
  }

  return (
    <div className="ajuda-fundo" onClick={onFechar}>
      <div
        className="ajuda-atalhos contas-janela"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contas-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ajuda-topo">
          <h2 id="contas-titulo">Usuários</h2>
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

        <section aria-labelledby="contas-nova">
          <h3 id="contas-nova" className="contas-subtitulo">
            Nova conta
          </h3>
          <form className="contas-form contas-nova" onSubmit={criar}>
            <label>
              Login (e-mail ou usuário)
              <input
                type="text"
                value={nova.login}
                required
                autoCapitalize="none"
                spellCheck={false}
                placeholder="nome@empresa.com"
                onChange={(e) => setNova({ ...nova, login: e.target.value })}
              />
            </label>
            <label>
              Nome
              <input type="text" value={nova.nome} placeholder="opcional" onChange={(e) => setNova({ ...nova, nome: e.target.value })} />
            </label>
            <label>
              Papel
              <select value={nova.papel} onChange={(e) => setNova({ ...nova, papel: e.target.value as Papel })}>
                {PAPEIS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo} — {p.descricao}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Senha
              <input
                type="password"
                value={nova.senha}
                autoComplete="new-password"
                placeholder="vazia = só login social"
                onChange={(e) => setNova({ ...nova, senha: e.target.value })}
              />
            </label>
            <button type="submit" className="btn btn-primario" disabled={busy || !nova.login.trim()}>
              Criar conta
            </button>
          </form>
          <p className="contas-dica">
            Com e-mail como login, a pessoa também entra com Google, Microsoft ou GitHub — sem senha, se preferir.
          </p>
        </section>

        <section aria-labelledby="contas-lista">
          <h3 id="contas-lista" className="contas-subtitulo">
            Contas {contas && <span className="contas-total">({contas.length})</span>}
          </h3>
          {!contas ? (
            <p className="contas-dica">{erro ? 'Não foi possível carregar as contas.' : 'Carregando…'}</p>
          ) : (
            <div className="contas-tabela-rolagem">
              <table className="contas-tabela">
                <thead>
                  <tr>
                    <th scope="col">Conta</th>
                    <th scope="col">Papel</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Senha</th>
                    <th scope="col">Último acesso</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contas.map((c) => {
                    const eu = c.login === euLogin;
                    const editando = edicao?.id === c.id ? edicao : null;
                    return (
                      <tr key={c.id} className={c.ativo ? undefined : 'contas-inativa'}>
                        <td>
                          <strong className="contas-login">{c.login}</strong>
                          {eu && <span className="contas-voce"> (você)</span>}
                          <span className="contas-nome">{c.nome ?? 'sem nome'}</span>
                          {editando && editando.tipo !== 'remover' && (
                            <form
                              className="contas-inline"
                              onSubmit={(e) => {
                                e.preventDefault();
                                salvarEdicao(c);
                              }}
                            >
                              <input
                                type={editando.tipo === 'senha' ? 'password' : 'text'}
                                value={editando.valor}
                                autoFocus
                                autoComplete={editando.tipo === 'senha' ? 'new-password' : 'off'}
                                aria-label={editando.tipo === 'senha' ? `Nova senha de ${c.login}` : `Nome de ${c.login}`}
                                placeholder={editando.tipo === 'senha' ? 'nova senha (10+ caracteres)' : 'nome'}
                                onChange={(e) => setEdicao({ ...editando, valor: e.target.value })}
                              />
                              <button type="submit" className="btn btn-primario" disabled={busy}>
                                Salvar
                              </button>
                              <button type="button" className="btn" onClick={() => setEdicao(null)}>
                                Cancelar
                              </button>
                            </form>
                          )}
                        </td>
                        <td>
                          <select
                            value={c.papel}
                            disabled={eu || busy}
                            aria-label={`Papel de ${c.login}`}
                            title={eu ? 'Você não muda o próprio papel' : undefined}
                            onChange={(e) =>
                              mudar(c, { papel: e.target.value as Papel }, `${c.login} agora é ${ROTULO_PAPEL[e.target.value as Papel].toLowerCase()}.`)
                            }
                          >
                            {PAPEIS.map((p) => (
                              <option key={p.valor} value={p.valor}>
                                {p.rotulo}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`contas-situacao ${c.ativo ? 'ativa' : 'inativa'}`}
                            disabled={eu || busy}
                            aria-pressed={c.ativo}
                            title={eu ? 'Você não desativa a própria conta' : c.ativo ? 'Desativar' : 'Ativar'}
                            onClick={() => mudar(c, { ativo: !c.ativo }, `${c.login} ${c.ativo ? 'desativada' : 'ativada'}.`)}
                          >
                            {c.ativo ? 'Ativa' : 'Inativa'}
                          </button>
                        </td>
                        <td>{c.temSenha ? 'Sim' : 'Só social'}</td>
                        <td>{quando(c.ultimoLogin)}</td>
                        <td className="contas-acoes">
                          {editando?.tipo === 'remover' ? (
                            <>
                              <button type="button" className="btn btn-perigo" disabled={busy} onClick={() => salvarEdicao(c)}>
                                Confirmar remoção
                              </button>
                              <button type="button" className="btn" onClick={() => setEdicao(null)}>
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="btn" onClick={() => setEdicao({ id: c.id, tipo: 'nome', valor: c.nome ?? '' })}>
                                Nome
                              </button>
                              {!eu && (
                                <button type="button" className="btn" onClick={() => setEdicao({ id: c.id, tipo: 'senha', valor: '' })}>
                                  Senha
                                </button>
                              )}
                              {!eu && c.temSenha && (
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={busy}
                                  title="A conta passa a entrar só por Google, Microsoft ou GitHub"
                                  onClick={() => mudar(c, { semSenha: true }, `${c.login} agora entra só pelo login social.`)}
                                >
                                  Tirar senha
                                </button>
                              )}
                              {!eu && (
                                <button type="button" className="btn btn-perigo" onClick={() => setEdicao({ id: c.id, tipo: 'remover' })}>
                                  Remover
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
