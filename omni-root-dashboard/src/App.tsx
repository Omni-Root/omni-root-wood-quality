import { useEffect, useState } from 'react';
import { api, type Conta } from './api';
import { definirEconomico } from './economico';
import Login from './components/Login';
import Painel from './paginas/Painel';

// Raiz do app: verifica a sessão e mostra o login ou o painel.
//
//   src/
//     paginas/Painel.tsx   layout do painel (grade de painéis)
//     hooks/               useDadosPainel (carga/recarga), useLive (SSE),
//                          useAnuncioInspecao (voz), useThemeTokens
//     components/          um componente por painel/controle
//     estilos/             CSS por área da tela (ordem em estilos/index.css)
//     api.ts · types.ts · voz.ts · datas.ts
export default function App() {
  // undefined = ainda verificando a sessão; null = deslogado.
  const [conta, setConta] = useState<Conta | null | undefined>(undefined);
  const [visitante, setVisitante] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        definirEconomico(r.economico === true);
        setVisitante(r.visitante === true);
        setConta(
          r.authenticated && r.user && r.papel
            ? { user: r.user, nome: r.nome ?? null, papel: r.papel, plateia: r.plateia === true }
            : null,
        );
      })
      .catch(() => setConta(null));
  }, []);

  if (conta === undefined) {
    return <div className="loading">Carregando…</div>;
  }
  if (conta === null) {
    return <Login visitante={visitante} onSuccess={setConta} />;
  }

  return <Painel conta={conta} onLogout={() => setConta(null)} />;
}
