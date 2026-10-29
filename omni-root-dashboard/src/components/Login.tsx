import { useEffect, useState } from 'react';
import { api, type Conta, type ProvedoresLogin } from '../api';
import logo from '../assets/logo-omniroot.png';
import { useEconomia } from '../economico';
import { QrLogin } from './QrPlateia';
import ThemeToggle from './ThemeToggle';

// Tela de login: à esquerda a vitrine (marca + curvas de nível de talhão), à
// direita o formulário. As contas vêm da tabela usuarios. Formas de entrar:
//   - Google / Microsoft / GitHub (OAuth, ver server/rotas/oauth.ts): o
//     e-mail precisa ter conta ativa; com OAUTH_CONVIDADOS=sim, quem não tem
//     entra como visitante (a plateia que escaneou o QR); precisa de internet;
//   - usuário (ou e-mail) e senha: funciona sem internet;
//   - "Entrar como visitante": só pelo link público do QR code, enquanto a
//     conta de visitante estiver ativa.
// No pé da vitrine, o QR code do link público (só no computador: no celular
// a vitrine some — quem está no celular já chegou).

type Provedor = 'google' | 'microsoft' | 'github';

const PROVEDORES: { id: Provedor; nome: string; variavel: string }[] = [
  { id: 'google', nome: 'Google', variavel: 'GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET' },
  { id: 'microsoft', nome: 'Microsoft', variavel: 'MICROSOFT_CLIENT_ID e MICROSOFT_CLIENT_SECRET' },
  { id: 'github', nome: 'GitHub', variavel: 'GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET' },
];

// O servidor volta para "/?erro_login=<código>" quando o login social falha.
const ERROS_SOCIAIS: Record<string, string> = {
  nao_configurado: 'Esse login ainda não foi configurado no servidor.',
  estado_invalido: 'A tentativa de login expirou ou não pôde ser confirmada. Tente de novo.',
  cancelado: 'Login cancelado.',
  sem_email:
    'Essa conta não tem um e-mail verificado para conferirmos o acesso. Na Microsoft, use uma conta pessoal ou a da organização liberada.',
  nao_autorizado: 'Esse e-mail não tem conta ativa neste painel. Peça o acesso ao administrador.',
  falha_provedor: 'Não foi possível falar com o provedor (sem internet?). Entre com usuário e senha.',
  provedor_desconhecido: 'Forma de login desconhecida.',
};

// Só LÊ (sem efeito colateral): em desenvolvimento o React chama o valor
// inicial do useState duas vezes, e limpar a URL aqui fazia a 2ª chamada não
// achar o erro — a mensagem sumia. A limpeza fica num useEffect.
function erroDaUrl(): string | null {
  const codigo = new URLSearchParams(window.location.search).get('erro_login');
  if (!codigo) return null;
  return ERROS_SOCIAIS[codigo] ?? 'Não foi possível entrar com essa conta.';
}

export default function Login({
  onSuccess,
  visitante,
}: {
  onSuccess: (conta: Conta) => void;
  // Quem chega pelo QR code com a conta de visitante ativa: botão "Entrar
  // como visitante" — quem preferir, entra com a própria conta.
  visitante: boolean;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [error, setError] = useState<string | null>(erroDaUrl);
  const [busy, setBusy] = useState(false);
  const [provedores, setProvedores] = useState<ProvedoresLogin | null>(null);
  // null = ainda não sondou; false = servidor da API não responde (fetch falhou)
  const [servidorOk, setServidorOk] = useState<boolean | null>(null);

  // Limpa o ?erro_login= da URL: recarregar a página não repete a mensagem.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('erro_login')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Sonda o servidor ao abrir e, enquanto ele estiver fora, a cada 5 s — o
  // aviso some sozinho quando ele voltar, sem F5. (Banco fora com o servidor
  // de pé aparece na hora de entrar: o login confere a conta no Postgres.)
  useEffect(() => {
    let ativo = true;
    const sondar = async () => {
      try {
        const res = await fetch('/api/me', { cache: 'no-store' });
        if (ativo) setServidorOk(res.ok || res.status === 401);
      } catch {
        if (ativo) setServidorOk(false);
      }
    };
    void sondar();
    const t = setInterval(() => {
      if (servidorOk === false) void sondar();
    }, 5000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, [servidorOk]);

  useEffect(() => {
    if (servidorOk !== true) return;
    api
      .provedores()
      .then(setProvedores)
      .catch(() => setProvedores(null));
  }, [servidorOk]);

  async function entrar(tentar: () => Promise<Conta>) {
    setBusy(true);
    setError(null);
    try {
      onSuccess(await tentar());
    } catch (err) {
      // fetch que nem chegou ao servidor vira TypeError: é "servidor fora", não "senha errada"
      if (err instanceof TypeError) {
        setServidorOk(false);
        setError('Servidor do dashboard não respondeu. Vou tentar de novo sozinho — confira se o `npm run dev` está rodando.');
      } else {
        setError(err instanceof Error ? err.message : 'Falha no login');
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void entrar(() => api.login(username, password));
  }

  // Navegação de página inteira: o provedor precisa da tela toda (e volta
  // para cá pelo endereço de retorno).
  function entrarCom(p: Provedor) {
    setError(null);
    window.location.assign(`/api/auth/${p}/entrar`);
  }

  // Pelo link público (QR code) o GitHub fica de fora: o app do GitHub aceita
  // um único endereço de retorno, e ele é o do localhost (o notebook).
  const { economico } = useEconomia();
  const provedoresDaTela = economico ? PROVEDORES.filter((p) => p.id !== 'github') : PROVEDORES;
  const algumSocial = provedores ? provedoresDaTela.some((p) => provedores[p.id]) : false;

  return (
    <div className="login-tela">
      <div className="login-cartao">
        <aside className="login-vitrine">
          <div className="lv-marca">
            <img src={logo} alt="" width={52} height={52} />
            <span>
              Omni<b>Root</b>
            </span>
          </div>
          <div className="lv-mensagem">
            <h2>Qualidade da madeira, tora a tora.</h2>
            <p>Visão computacional na garra do harvester: densidade, casca e tortuosidade medidas na colheita, não semanas depois.</p>
            <ul className="lv-selos">
              <li>100% das toras, não amostra</li>
              <li>Coleta funciona sem internet</li>
              <li>Mapa de onde agir</li>
            </ul>
          </div>
          <div className="lv-pe">
            <p className="lv-rodape">Challenge FIAP × John Deere · 2026</p>
            <QrLogin />
          </div>
        </aside>

        <main className="login-lado">
          <div className="login-theme">
            <ThemeToggle />
          </div>

          <div className="login-conteudo">
            <img className="login-logo-movel" src={logo} alt="" width={56} height={56} />
            <h1>Bem-vindo de volta</h1>
            <p className="login-sub">Entre para acompanhar a qualidade da madeira colhida.</p>

            {servidorOk === false && !error && (
              <div className="login-error" role="status">
                Servidor do dashboard fora do ar — tentando reconectar a cada 5 s…
              </div>
            )}
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}

            <div className={`login-sociais${provedoresDaTela.length === 2 ? ' dois' : ''}`}>
              {provedoresDaTela.map((p) => {
                const pronto = Boolean(provedores?.[p.id]);
                const motivo = pronto
                  ? `Entrar com ${p.nome}`
                  : `Login com ${p.nome} não configurado: preencha ${p.variavel} no .env do dashboard`;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`btn-social social-${p.id}`}
                    onClick={() => entrarCom(p.id)}
                    disabled={!pronto}
                    title={motivo}
                    aria-label={motivo}
                  >
                    <MarcaProvedor id={p.id} />
                    <span>{p.nome}</span>
                  </button>
                );
              })}
            </div>
            {provedores && !algumSocial && (
              <p className="login-dica">Login social ainda não configurado neste servidor — use usuário e senha.</p>
            )}

            <div className="login-divisor">
              <span>ou com usuário e senha</span>
            </div>

            {visitante && (
              <div className="login-visitante">
                <p>Veio pelo QR code? Entre direto, só para ver o painel.</p>
                <button
                  type="button"
                  className="login-entrar"
                  disabled={busy}
                  onClick={() => void entrar(api.loginVisitante)}
                >
                  Entrar como visitante
                </button>
              </div>
            )}

            <form className="login-form" onSubmit={submit}>
              <label>
                Usuário ou e-mail
                <input
                  type="text"
                  value={username}
                  autoFocus={!visitante}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="seu usuário ou e-mail"
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label>
                Senha
                <span className="login-senha">
                  <input
                    type={verSenha ? 'text' : 'password'}
                    value={password}
                    autoComplete="current-password"
                    placeholder="sua senha"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="login-olho"
                    onClick={() => setVerSenha((v) => !v)}
                    aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    aria-pressed={verSenha}
                    title={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <Olho aberto={verSenha} />
                  </button>
                </span>
              </label>

              <button type="submit" className="login-entrar" disabled={busy || !username || !password}>
                {busy ? 'Entrando…' : 'Entrar'}
              </button>
            </form>

            <p className="login-restrito">Acesso restrito a pessoas autorizadas.</p>
          </div>
        </main>
      </div>
    </div>
  );
}

// Logotipos oficiais (cores das marcas), desenhados em SVG: sem imagem externa.
function MarcaProvedor({ id }: { id: Provedor }) {
  if (id === 'google') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
        <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
      </svg>
    );
  }
  if (id === 'microsoft') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
        <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
        <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
        <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}

function Olho({ aberto }: { aberto: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0" />
      <path d="M21 12c-2.4 4-5.4 6-9 6c-3.6 0-6.6-2-9-6c2.4-4 5.4-6 9-6c3.6 0 6.6 2 9 6" />
      {!aberto && <path d="M3 3l18 18" />}
    </svg>
  );
}
