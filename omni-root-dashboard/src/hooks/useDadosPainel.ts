import { useCallback, useEffect, useRef, useState } from 'react';
import { api, UnauthorizedError } from '../api';
import { devePausar, lerEconomia, limitador, type Limitador } from '../economico';
import { useLive, type LiveInfo } from './useLive';
import type {
  AlertaTendencia,
  Bucket,
  Filters,
  HeatmapCell,
  Maquina,
  Mapa,
  Qualidade,
  Status,
  SummaryRow,
  TimeseriesPoint,
  UltimaInspecao,
} from '../types';

// Tudo o que o painel lê do servidor, e QUANDO lê de novo:
//   - na troca de filtro / granularidade / status do mapa de calor;
//   - a cada tora nova (SSE, via useLive), sem F5;
//   - quando o banco volta depois de cair (sonda /api/health a cada 5 s);
//   - o alerta de tendência, também a cada 30 s (a janela de "agora" anda).
// Sessão expirada (401) em qualquer chamada => onLogout.
//
// Modo econômico (celular pelo túnel, src/economico.ts): os avisos de tora
// não recarregam tudo na hora. A "última inspeção" é relida no máximo a cada
// `ritmo.ultimaMs` e o painel inteiro a cada `ritmo.painelMs` (avisos no meio
// viram uma recarga só); com a aba escondida, o alerta de tendência pula a vez.

export interface DadosPainel {
  live: LiveInfo;
  maquinas: Maquina[];
  summary: SummaryRow[] | null;
  timeseries: TimeseriesPoint[] | null;
  heatmap: HeatmapCell[] | null;
  ultima: UltimaInspecao | null;
  qualidade: Qualidade | null;
  mapa: Mapa | null;
  tendencia: AlertaTendencia[] | null;
  error: string | null;
  atualizadoEm: Date | null;
  tentativas: number;
  loading: boolean;
}

// Painel novo não derruba os outros: se só o mapa falhar, ele mostra o
// aviso no próprio painel e o resto do dashboard carrega normalmente.
function mapaIndisponivel(err: unknown): Mapa {
  return {
    disponivel: false,
    aviso: `Não foi possível carregar o mapa (${err instanceof Error ? err.message : 'erro'}).`,
    celula_m: 25,
    total: 0,
    com_posicao: 0,
    luz_critica: 0,
    fontes: [],
    celulas: [],
    pontos: [],
    pontos_truncados: false,
    ultima: null,
    // Não usados com disponivel=false (o painel só mostra o aviso).
    limites: { casca: [0, 0], tort: [0, 0], falhas: [0, 0] },
    min_toras_alerta: 0,
    alertas: [],
  };
}

export function useDadosPainel(
  filters: Filters,
  bucket: Bucket,
  heatStatuses: Status[],
  onLogout: () => void,
): DadosPainel {
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [summary, setSummary] = useState<SummaryRow[] | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[] | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapCell[] | null>(null);
  const [ultima, setUltima] = useState<UltimaInspecao | null>(null);
  const [qualidade, setQualidade] = useState<Qualidade | null>(null);
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [tendencia, setTendencia] = useState<AlertaTendencia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Quando os painéis foram atualizados pela última vez com sucesso: sem
  // conexão (celular no campo), os dados ficam na tela com este horário.
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  // Incrementado a cada aviso de tora nova (SSE): força o efeito de carga a
  // rodar de novo com os mesmos filtros, sem F5.
  const [versao, setVersao] = useState(0);
  // Econômico: só a "última inspeção", entre uma recarga completa e outra.
  const [versaoUltima, setVersaoUltima] = useState(0);
  const limites = useRef<{ tudo: Limitador; ultima: Limitador } | null>(null);
  limites.current ??= {
    tudo: limitador(() => lerEconomia().ritmo.painelMs, () => setVersao((v) => v + 1)),
    ultima: limitador(() => lerEconomia().ritmo.ultimaMs, () => setVersaoUltima((v) => v + 1)),
  };
  useEffect(() => () => {
    limites.current?.tudo.cancelar();
    limites.current?.ultima.cancelar();
  }, []);
  const live = useLive(
    useCallback(() => {
      if (!lerEconomia().economico) {
        setVersao((v) => v + 1);
        return;
      }
      limites.current?.ultima.pedir();
      limites.current?.tudo.pedir();
    }, []),
  );

  useEffect(() => {
    const ac = new AbortController();
    api
      .maquinas(ac.signal)
      .then(setMaquinas)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onLogout();
        /* filtro de máquina fica vazio; o erro real aparece nos painéis */
      });
    return () => ac.abort();
  }, [onLogout]);

  useEffect(() => {
    const ac = new AbortController();
    // Só mostra "Carregando…" na primeira vez; nas atualizações ao vivo os
    // painéis trocam de valor sem piscar.
    if (versao === 0) setError(null);
    // Recarga completa: conta também como a da "última inspeção".
    limites.current?.tudo.marcar();
    limites.current?.ultima.marcar();
    Promise.all([
      api.summary(filters, ac.signal),
      api.timeseries(filters, bucket, ac.signal),
      api.heatmap(filters, heatStatuses, ac.signal),
      api.ultima(filters, ac.signal),
      api.qualidade(filters, ac.signal),
      api.mapa(filters, ac.signal).catch((err: unknown): Mapa => {
        if (err instanceof UnauthorizedError || ac.signal.aborted) throw err;
        return mapaIndisponivel(err);
      }),
    ])
      .then(([s, t, h, u, q, m]) => {
        setSummary(s);
        setTimeseries(t);
        setHeatmap(h);
        setUltima(u);
        setQualidade(q);
        setMapa(m);
        setError(null);
        setAtualizadoEm(new Date());
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof UnauthorizedError) {
          onLogout();
          return;
        }
        setError(err instanceof Error ? err.message : 'Erro ao carregar dados');
      });
    return () => ac.abort();
  }, [filters, bucket, heatStatuses, onLogout, versao]);

  // Econômico: entre recargas completas, só a "última inspeção" (o cartão que
  // a plateia vê mudar quando a rodela entra na câmera).
  useEffect(() => {
    if (versaoUltima === 0) return;
    const ac = new AbortController();
    api
      .ultima(filters, ac.signal)
      .then(setUltima)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onLogout();
      });
    return () => ac.abort();
    // filters fora das dependências de propósito: troca de filtro já recarrega tudo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versaoUltima]);

  // Alerta de tendência: recarrega a cada tora nova (SSE) E a cada 30 s — a
  // janela de "agora" anda com o relógio, e um alerta antigo precisa sumir
  // sozinho mesmo sem tora nova. Falha aqui não derruba nada: fica o último.
  useEffect(() => {
    const ac = new AbortController();
    const carregar = () =>
      api
        .tendencia(filters, ac.signal)
        .then(setTendencia)
        .catch((err: unknown) => {
          if (err instanceof UnauthorizedError) onLogout();
        });
    void carregar();
    const t = setInterval(() => {
      if (!devePausar()) void carregar();
    }, lerEconomia().economico ? 60_000 : 30_000);
    return () => {
      clearInterval(t);
      ac.abort();
    };
  }, [filters, onLogout, versao]);

  // Banco caiu (500 nas rotas) ou servidor reiniciou: em vez de ficar parado
  // no erro até um F5, sonda /api/health a cada 5 s e recarrega sozinho
  // quando o banco responde de novo. `tentativas` aparece no banner.
  const [tentativas, setTentativas] = useState(0);
  useEffect(() => {
    if (!error) {
      setTentativas(0);
      return;
    }
    let ativo = true;
    const t = setInterval(async () => {
      const ok = await api.health();
      if (!ativo) return;
      if (ok) setVersao((v) => v + 1);
      else setTentativas((n) => n + 1);
    }, 5000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, [error]);

  return {
    live,
    maquinas,
    summary,
    timeseries,
    heatmap,
    ultima,
    qualidade,
    mapa,
    tendencia,
    error,
    atualizadoEm,
    tentativas,
    loading: summary === null && !error,
  };
}
