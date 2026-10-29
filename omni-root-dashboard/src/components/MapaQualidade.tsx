import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AlertaZona, Filters, Mapa, MapaCelula, MapaPonto, Metrica, Nivel, PosicaoFrota, Rastro } from '../types';
import { FONTE_POSICAO_META, FONTES_DO_SISTEMA } from '../types';
import { useThemeTokens, type ThemeTokens } from '../hooks/useThemeTokens';
import { useFrota } from '../hooks/useFrota';

// MAPA DE QUALIDADE — onde está a madeira ruim, e o que fazer a respeito.
//
// Cada célula (~25 m) junta as toras colhidas ali e é colorida pelo
// indicador escolhido (casca, tortuosidade ou rejeição). Os LIMITES, a cor
// de cada zona e o "Onde agir" vêm prontos do servidor (server/mapa.ts) —
// a mesma regra que o relatório PDF usa; aqui só se desenha.
//
// Offline por construção: a camada de qualidade é vetor desenhado por nós
// (Leaflet vai empacotado no app, sem CDN). O mapa de ruas por baixo é só um
// enriquecimento — sem internet ele some com um aviso e o resto continua.
//
// Por cima, a FROTA (useFrota): cada máquina pelo SN, na posição ao vivo
// enquanto tem rede (ou na última conhecida, em cinza), e a linha do trajeto
// no período — inclusive o trecho feito sem internet, que chega com o sync.

const METRICAS: Record<Metrica, { label: string; valor: (c: MapaCelula) => number | null }> = {
  casca: { label: 'Casca residual', valor: (c) => c.casca_media },
  tort: { label: 'Tortuosidade', valor: (c) => c.tort_media },
  falhas: { label: 'Rejeição', valor: (c) => (c.toras > 0 ? (100 * c.falhas) / c.toras : null) },
};

// Texto das três faixas da legenda, a partir dos limites do servidor.
function faixas(m: Metrica, [ok, at]: [number, number]): [string, string, string] {
  return m === 'tort' ? [`< ${ok}%`, `${ok}–${at}%`, `≥ ${at}%`] : [`≤ ${ok}%`, `${ok}–${at}%`, `> ${at}%`];
}

function nRotulo(a: AlertaZona): string {
  if (a.metrica === 'tort') return `${a.n} ${a.n === 1 ? 'tora vista' : 'toras vistas'} de lado`;
  return `${a.n} ${a.n === 1 ? 'tora' : 'toras'}`;
}

function corNivel(t: ThemeTokens, n: Nivel): string {
  if (n === 'ok') return t.status.aprovado;
  if (n === 'atencao') return t.status.quarentena;
  if (n === 'critico') return t.status.reprovado;
  return t.muted;
}

const fmt = (v: number | null, casas = 1) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function fmtHora(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

// Botão "Rota": a escolha fica guardada neste navegador (ligada por padrão).
const CHAVE_ROTA = 'omniroot-mapa-rota';
function lerPreferenciaRota(): boolean {
  try {
    return localStorage.getItem(CHAVE_ROTA) !== '0';
  } catch {
    return true;
  }
}
function gravarPreferenciaRota(ligada: boolean): void {
  try {
    localStorage.setItem(CHAVE_ROTA, ligada ? '1' : '0');
  } catch {
    /* sem storage: vale nesta sessão */
  }
}

function haQuanto(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.floor(h / 24)} dias`;
}

const escapar = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

// "ao vivo · ±35 m" / "sem fix" / "sem sinal · há 12 min" — o mesmo texto no
// chip da lista e no balão do mapa.
function situacao(p: PosicaoFrota): string {
  if (p.online) {
    if (p.estado === 'sem_fix' || p.estado === 'iniciando') return 'online · sem fix agora';
    if (p.estado === 'sem_receptor') return 'online · sem receptor de posição';
    return 'ao vivo';
  }
  return `sem sinal · posição ${haQuanto(p.idadeMs)}`;
}

function precisao(p: PosicaoFrota): string {
  if (p.precisao_m != null) return `±${Math.round(p.precisao_m)} m`;
  const partes: string[] = [];
  if (p.hdop != null) partes.push(`HDOP ${fmt(p.hdop)}`);
  if (p.satelites != null) partes.push(`${p.satelites} satélites`);
  return partes.join(' · ');
}

// Um cartão por zona (uma zona pode estourar mais de um indicador), na ordem
// de gravidade em que o servidor já mandou.
function agruparPorZona(alertas: AlertaZona[]): { zona: string; nivel: 'atencao' | 'critico'; itens: AlertaZona[] }[] {
  const grupos = new Map<string, { zona: string; nivel: 'atencao' | 'critico'; itens: AlertaZona[] }>();
  for (const a of alertas) {
    const g = grupos.get(a.zona);
    if (g) {
      g.itens.push(a);
      if (a.nivel === 'critico') g.nivel = 'critico';
    } else {
      grupos.set(a.zona, { zona: a.zona, nivel: a.nivel, itens: [a] });
    }
  }
  return [...grupos.values()];
}

type StatusFundo = 'carregando' | 'ok' | 'falhou';
type GrupoZona = ReturnType<typeof agruparPorZona>[number];

// "Onde agir" em PÁGINAS, da altura do mapa ao lado: a lista nunca estica o
// painel. Cada página leva quantos cartões couberem inteiros — recalculado
// quando muda a janela, o tamanho do texto (A−/A+) ou os dados. Os cartões
// ficam todos montados (para medir) e a lista sobe até o início da página;
// os de fora da página ficam invisíveis (e fora do Tab).
function OndeAgir({
  zonas,
  minToras,
  onFocar,
}: {
  zonas: GrupoZona[];
  minToras: number;
  onFocar: (g: GrupoZona) => void;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const [inicios, setInicios] = useState<number[]>([0]); // índice do 1º cartão de cada página
  const [pagina, setPagina] = useState(0);

  useLayoutEffect(() => {
    const caixa = caixaRef.current;
    const lista = listaRef.current;
    if (!caixa || !lista) return;
    const paginar = () => {
      const altura = caixa.clientHeight;
      const itens = Array.from(lista.children) as HTMLElement[];
      const novos = [0];
      let topo = itens[0]?.offsetTop ?? 0;
      itens.forEach((li, i) => {
        if (i > 0 && li.offsetTop + li.offsetHeight - topo > altura) {
          novos.push(i);
          topo = li.offsetTop;
        }
      });
      setInicios((v) => (v.length === novos.length && v.every((x, i) => x === novos[i]) ? v : novos));
    };
    paginar();
    const obs = new ResizeObserver(paginar);
    obs.observe(caixa);
    obs.observe(lista);
    return () => obs.disconnect();
  }, [zonas]);

  // Dados novos (sync ao vivo) não jogam o apresentador de volta à página 1;
  // só não deixam a página atual passar do fim.
  const pag = Math.min(pagina, inicios.length - 1);
  const de = inicios[pag];
  const ate = inicios[pag + 1] ?? zonas.length;

  // Desloca a LISTA (não rola a caixa): rolar não passa do fim do conteúdo,
  // e a última página, com poucos cartões, ficava grudada embaixo.
  useLayoutEffect(() => {
    const lista = listaRef.current;
    const li = lista?.children[de] as HTMLElement | undefined;
    if (lista) lista.style.transform = li && li.offsetTop > 0 ? `translateY(-${li.offsetTop}px)` : '';
  }, [de, inicios]);

  const paginas = inicios.length;
  return (
    <aside className="mapa-alertas">
      <div className="mapa-alertas-topo">
        <h3>Onde agir</h3>
        {paginas > 1 && (
          <div className="paginador" role="group" aria-label="Páginas de zonas">
            <button
              type="button"
              className="btn"
              onClick={() => setPagina(pag - 1)}
              disabled={pag === 0}
              aria-label="Página anterior"
            >
              ‹
            </button>
            <span aria-live="polite">
              {pag + 1}/{paginas}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => setPagina(pag + 1)}
              disabled={pag === paginas - 1}
              aria-label="Próxima página"
            >
              ›
            </button>
          </div>
        )}
      </div>
      {zonas.length === 0 ? (
        <p className="muted">Nenhuma zona acima dos limites no período (mín. {minToras} toras por zona).</p>
      ) : (
        <>
          <div className="mapa-alertas-caixa" ref={caixaRef}>
            <ul ref={listaRef}>
              {zonas.map((g, i) => {
                const visivel = i >= de && i < ate;
                return (
                  <li key={g.zona} className={visivel ? undefined : 'fora-da-pagina'} aria-hidden={!visivel}>
                    <button
                      type="button"
                      className={`alerta alerta-${g.nivel}`}
                      onClick={() => onFocar(g)}
                      title="Mostrar no mapa"
                    >
                      <span className="alerta-zona">Zona {g.zona}</span>
                      {g.itens.map((a) => (
                        <span className="alerta-texto" key={a.metrica}>
                          {a.curto} <strong>{fmt(a.valor, a.metrica === 'falhas' ? 0 : 1)}%</strong> em {nRotulo(a)}{' '}
                          (limite {a.limite}%): {a.acao}.
                        </span>
                      ))}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {paginas > 1 && (
            <p className="muted mapa-alertas-conta">
              Zonas {de + 1}–{ate} de {zonas.length}
            </p>
          )}
        </>
      )}
    </aside>
  );
}

export default function MapaQualidade({ mapa, filters }: { mapa: Mapa | null; filters: Filters }) {
  const [metrica, setMetrica] = useState<Metrica>('casca');
  const [fundo, setFundo] = useState<'ruas' | 'nenhum'>('ruas');
  const [statusFundo, setStatusFundo] = useState<StatusFundo>('carregando');
  const [foco, setFoco] = useState<{ zona: string; nonce: number } | null>(null);
  const [focoMaquina, setFocoMaquina] = useState<{ maquina: string; nonce: number } | null>(null);
  const [enquadrar, setEnquadrar] = useState(0);
  const [mostrarRota, setMostrarRota] = useState(lerPreferenciaRota);
  const { frota, rastro } = useFrota(filters);

  const zonasAlerta = useMemo(() => agruparPorZona(mapa?.alertas ?? []), [mapa]);
  const frotaNoMapa = frota.filter((p) => p.lat !== null && p.lon !== null);

  if (!mapa) return <div className="loading">Carregando…</div>;
  if (!mapa.disponivel) {
    return <div className="empty">{mapa.aviso ?? 'Mapa indisponível.'}</div>;
  }
  // Sem tora com posição no período, mas com máquina no mapa: mostra o mapa
  // (a frota e o trajeto) — só some se não houver nada para desenhar.
  if (mapa.com_posicao === 0 && frotaNoMapa.length === 0) {
    return (
      <div className="empty">
        <div>
          Nenhuma tora com posição no período ({mapa.total} {mapa.total === 1 ? 'tora' : 'toras'} sem posição).
          <br />
          <span className="muted">
            Na máquina: <code>--gnss COM5</code> (GNSS / receptor), <code>--gnss trilha.nmea</code> ou, no notebook
            da maquete, <code>--gnss windows</code> (Localização do Windows).
          </span>
        </div>
      </div>
    );
  }

  const def = METRICAS[metrica];
  const semPosicao = mapa.total - mapa.com_posicao;
  const temLog = mapa.fontes.some((f) => f.fonte === 'gnss_log');

  return (
    <div className="mapa">
      <div className="mapa-controles">
        <div className="mapa-metricas" role="radiogroup" aria-label="Indicador do mapa">
          {(Object.keys(METRICAS) as Metrica[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={metrica === k}
              className={`seg${metrica === k ? ' seg-ativo' : ''}`}
              onClick={() => setMetrica(k)}
            >
              {METRICAS[k].label}
            </button>
          ))}
        </div>
        <div className="mapa-opcoes">
          <select
            value={fundo}
            onChange={(e) => {
              setFundo(e.target.value as 'ruas' | 'nenhum');
              setStatusFundo('carregando');
            }}
            aria-label="Mapa de fundo"
          >
            <option value="ruas">Fundo: ruas (OpenStreetMap)</option>
            <option value="nenhum">Fundo: nenhum (offline)</option>
          </select>
          {frotaNoMapa.length > 0 && (
            <button
              type="button"
              className="btn btn-rota"
              aria-pressed={mostrarRota}
              onClick={() => {
                setMostrarRota(!mostrarRota);
                gravarPreferenciaRota(!mostrarRota);
              }}
              title={mostrarRota ? 'Esconder a rota: só a posição atual das máquinas' : 'Mostrar a rota percorrida pelas máquinas no período'}
            >
              {mostrarRota ? '✓ Rota' : 'Rota'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setEnquadrar((n) => n + 1)}>
            Enquadrar
          </button>
        </div>
      </div>

      {frota.length > 0 && (
        <div className="frota-lista" role="group" aria-label="Frota: máquinas no mapa">
          <span className="frota-titulo">Frota</span>
          {frota.map((p) => {
            const meta = p.fonte ? FONTE_POSICAO_META[p.fonte] : undefined;
            // Precisão só da posição ATUAL (sem fix agora, a do fix antigo enganaria).
            const prec = p.online && p.estado === 'ok' && p.lat !== null ? precisao(p) : '';
            return (
              <button
                key={p.maquina}
                type="button"
                className={`frota-chip${p.online ? ' frota-online' : ' frota-offline'}`}
                disabled={p.lat === null}
                onClick={() => setFocoMaquina({ maquina: p.maquina, nonce: Date.now() })}
                title={
                  `${p.modelo ?? 'Máquina não cadastrada no banco central'} · SN ${p.maquina}` +
                  (meta ? ` · posição: ${meta.label}` : '') +
                  (p.lat === null ? ' · ainda sem posição' : ' · clique para ver no mapa')
                }
              >
                <span className="frota-ponto" aria-hidden="true" />
                <strong>{p.maquina}</strong>
                <span className="frota-situacao">
                  {situacao(p)}
                  {prec && ` · ${prec}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mapa-layout">
        <div className="mapa-area">
          <MapaLeaflet
            celulas={mapa.celulas}
            pontos={mapa.pontos}
            ultima={mapa.ultima}
            metrica={metrica}
            fundo={fundo}
            onStatusFundo={setStatusFundo}
            foco={foco}
            enquadrar={enquadrar}
            frota={frotaNoMapa}
            mostrarRota={mostrarRota}
            rastro={rastro}
            focoMaquina={focoMaquina}
          />
          {fundo === 'ruas' && statusFundo === 'falhou' && (
            <div className="mapa-aviso-fundo" role="status">
              Sem internet para o mapa de fundo — a camada de qualidade continua funcionando.
            </div>
          )}
          <div className="mapa-legenda">
            <strong>{def.label}:</strong>
            {(['ok', 'atencao', 'critico'] as Nivel[]).map((n, i) => (
              <span key={n}>
                <i className={`sw sw-${n}`} />
                {faixas(metrica, mapa.limites[metrica])[i]}
              </span>
            ))}
            <span>
              <i className="sw sw-sem" />
              sem medida
            </span>
            <span className="muted">· célula de {mapa.celula_m} m · ponto = tora</span>
            {frotaNoMapa.length > 0 && (
              <span className="muted">
                · <i className="sw-maquina" aria-hidden="true" /> máquina (SN)
                {mostrarRota && rastro?.maquinas.length ? ' · linha = rota' : ''}
              </span>
            )}
          </div>
        </div>

        <OndeAgir
          zonas={zonasAlerta}
          minToras={mapa.min_toras_alerta}
          onFocar={(g) => {
            setMetrica(g.itens[0].metrica);
            setFoco({ zona: g.zona, nonce: Date.now() });
          }}
        />
      </div>

      <div className="mapa-rodape">
        <span>
          <strong>{mapa.com_posicao}</strong> de {mapa.total} toras do período com posição
          {semPosicao > 0 && ` · ${semPosicao} sem posição (fora do mapa)`}
          {mapa.luz_critica > 0 && (
            <span title="Medidas em luz crítica (baixa confiança): aparecem no mapa, mas a casca e a tortuosidade delas não entram nas médias nem nos alertas">
              {` · ${mapa.luz_critica} medidas em luz crítica (fora dos alertas)`}
            </span>
          )}
          {mapa.pontos_truncados && ` · mostrando as ${mapa.pontos.length} mais recentes como ponto`}
        </span>
        {mapa.fontes.length > 0 && (
          <span>
            Posição:{' '}
            {mapa.fontes.map((f, i) => {
              const meta = FONTE_POSICAO_META[f.fonte];
              return (
                <span key={f.fonte} title={meta?.hint}>
                  {i > 0 && ', '}
                  <span className={`tile-tag${f.fonte === 'gnss_log' ? ' tag-demo' : ''}`}>{meta?.label ?? f.fonte}</span>{' '}
                  ({f.toras})
                </span>
              );
            })}
            {temLog && <span className="muted"> — trilha GNSS real gravada e reproduzida</span>}
            {mapa.fontes.some((f) => FONTES_DO_SISTEMA.includes(f.fonte)) && (
              <span className="muted"> — notebook no papel da máquina; posição estimada pelo sistema (Wi-Fi ou IP), não por satélite</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// O mapa em si (Leaflet imperativo, ciclo de vida preso ao componente)
// ------------------------------------------------------------
function MapaLeaflet({
  celulas,
  pontos,
  ultima,
  metrica,
  fundo,
  onStatusFundo,
  foco,
  enquadrar,
  frota,
  mostrarRota,
  rastro,
  focoMaquina,
}: {
  celulas: MapaCelula[];
  pontos: MapaPonto[];
  ultima: MapaPonto | null;
  metrica: Metrica;
  fundo: 'ruas' | 'nenhum';
  onStatusFundo: (s: StatusFundo) => void;
  foco: { zona: string; nonce: number } | null;
  enquadrar: number;
  frota: PosicaoFrota[];
  mostrarRota: boolean;
  rastro: Rastro | null;
  focoMaquina: { maquina: string; nonce: number } | null;
}) {
  const tokens = useThemeTokens();
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const grupoRef = useRef<L.LayerGroup | null>(null);
  const rastroRef = useRef<L.LayerGroup | null>(null);
  const frotaRef = useRef<L.LayerGroup | null>(null);
  const marcadoresRef = useRef<Map<string, { pino: L.Marker; raio: L.Circle | null; online: boolean }>>(new Map());
  const retangulosRef = useRef<Map<string, L.Rectangle>>(new Map());
  const enquadradoRef = useRef(false);
  // O que entra no "Enquadrar": zonas + máquinas + rota (se estiver à mostra).
  const extrasRef = useRef<[number, number][]>([]);
  extrasRef.current = [
    ...frota.map((p) => [p.lat as number, p.lon as number] as [number, number]),
    ...(mostrarRota ? (rastro?.maquinas.flatMap((m) => m.segmentos.flat()) ?? []) : []),
  ];
  // Posição ao vivo de cada máquina, para a rota chegar até ela (o trajeto no
  // banco sempre está alguns segundos atrás). Texto: só muda quando ela anda.
  const frotaAtualRef = useRef(frota);
  frotaAtualRef.current = frota;
  const pontasVivas = frota
    .filter((p) => p.online && p.origem === 'ao_vivo')
    .map((p) => `${p.maquina}:${p.lat}:${p.lon}`)
    .join('|');

  // Cria e destrói o mapa junto com o componente.
  useEffect(() => {
    if (!divRef.current) return;
    // Zoom só inteiro: com zoom fracionado os blocos do mapa de fundo são
    // esticados e aparecem emendas (linhas) entre eles.
    const mapa = L.map(divRef.current, { maxZoom: 20 }).setView([-15.8, -47.9], 4);
    L.control.scale({ imperial: false }).addTo(mapa);
    grupoRef.current = L.layerGroup().addTo(mapa);
    // Ordem de desenho: qualidade, trajeto por cima, máquinas no topo.
    rastroRef.current = L.layerGroup().addTo(mapa);
    frotaRef.current = L.layerGroup().addTo(mapa);
    mapRef.current = mapa;
    // O Leaflet mede o container só ao nascer: janela redimensionada, coluna
    // que muda de largura ou painel que aparece depois precisam de um aviso,
    // senão o mapa fica cortado/deslocado.
    const observador = new ResizeObserver(() => mapa.invalidateSize());
    observador.observe(divRef.current);
    return () => {
      observador.disconnect();
      mapa.remove();
      mapRef.current = null;
      grupoRef.current = null;
      rastroRef.current = null;
      frotaRef.current = null;
      marcadoresRef.current.clear();
      enquadradoRef.current = false;
    };
  }, []);

  // Mapa de fundo: só um enriquecimento. Falhou (sem internet)? Avisa e segue.
  useEffect(() => {
    const mapa = mapRef.current;
    if (!mapa || fundo !== 'ruas') return;
    let carregou = false;
    const camada = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution: '&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    camada.on('tileload', () => {
      carregou = true;
      onStatusFundo('ok');
    });
    camada.on('tileerror', () => {
      if (!carregou) onStatusFundo('falhou');
    });
    camada.addTo(mapa);
    camada.bringToBack();
    if (!navigator.onLine) onStatusFundo('falhou');
    return () => {
      camada.remove();
    };
  }, [fundo, onStatusFundo]);

  // Camada de qualidade (células + toras + a última tora).
  useEffect(() => {
    const mapa = mapRef.current;
    const grupo = grupoRef.current;
    if (!mapa || !grupo) return;
    grupo.clearLayers();
    retangulosRef.current.clear();
    const m = METRICAS[metrica];

    for (const c of celulas) {
      const nv: Nivel = c.niveis?.[metrica] ?? 'sem';
      const cor = corNivel(tokens, nv);
      const v = m.valor(c);
      const ret = L.rectangle(
        [
          [c.lat_min, c.lon_min],
          [c.lat_max, c.lon_max],
        ],
        {
          color: cor,
          weight: 1,
          fillColor: cor,
          fillOpacity: nv === 'sem' ? 0.12 : 0.42,
          dashArray: nv === 'sem' ? '3 3' : undefined,
        },
      );
      ret.bindTooltip(
        `<strong>Zona ${c.zona}</strong> · ${c.toras} ${c.toras === 1 ? 'tora' : 'toras'}<br>` +
          `${m.label}: <strong>${v == null ? 'sem medida' : `${fmt(v, metrica === 'falhas' ? 0 : 1)}%`}</strong><br>` +
          `Casca média ${fmt(c.casca_media)}% · Tortuosidade ${c.tort_n > 0 ? `${fmt(c.tort_media)}% (${c.tort_n})` : 'n/a'}<br>` +
          `Rejeitadas/contenção: ${c.falhas} · Diâm. médio ${fmt(c.diam_medio)} cm<br>` +
          `<span style="opacity:.75">${fmtHora(c.primeira)} → ${fmtHora(c.ultima)}</span>`,
        { sticky: true },
      );
      ret.addTo(grupo);
      retangulosRef.current.set(c.zona, ret);
    }

    // Pontos em SVG (renderizador padrão), como as células. Com canvas, o
    // Leaflet deixava um redesenho agendado num canvas já destruído a cada
    // atualização ao vivo (erro "clearRect" no console). Até MAX_PONTOS
    // (3000, no servidor) o SVG dá conta.
    for (const p of pontos) {
      L.circleMarker([p.lat, p.lon], {
        radius: 2.5,
        weight: 0,
        fillColor: tokens.textPrimary,
        fillOpacity: 0.55,
        interactive: false,
      }).addTo(grupo);
    }
    if (ultima) {
      L.circleMarker([ultima.lat, ultima.lon], {
        radius: 7,
        weight: 3,
        color: tokens.accent,
        fillColor: tokens.surface,
        fillOpacity: 1,
        className: 'mapa-ultima',
      })
        .bindTooltip(`Última tora · ${fmtHora(ultima.data)}`)
        .addTo(grupo);
    }

    // Enquadra só na primeira carga com dados — atualização ao vivo não
    // deve arrancar o zoom que o usuário escolheu.
    if (!enquadradoRef.current && celulas.length > 0) {
      enquadrarTudo(mapa, celulas, extrasRef.current);
      enquadradoRef.current = true;
    }
  }, [celulas, pontos, ultima, metrica, tokens]);

  // Rota (botão "Rota"), como no Maps: azul com contorno branco.
  //   - CONTÍNUA: o caminho registrado (o servidor já tirou a oscilação da
  //     máquina parada — parada é um ponto só);
  //   - TRACEJADA: liga uma posição à seguinte quando não há registro do
  //     caminho entre elas (máquina desligada/outro dia) — da posição
  //     anterior até a atual. Nunca uma linha cheia fingindo um percurso;
  //   - a ponta vai até a posição AO VIVO (o trajeto do banco chega com
  //     segundos de atraso pelo sync): contínua se o registro é recente,
  //     tracejada se a última posição registrada é antiga;
  //   - bolinha branca = de onde a máquina saiu no período.
  useEffect(() => {
    const grupo = rastroRef.current;
    if (!grupo) return;
    grupo.clearLayers();
    if (!mostrarRota) return;
    const vivas = new Map(
      frotaAtualRef.current
        .filter((p) => p.online && p.origem === 'ao_vivo' && p.lat !== null && p.lon !== null)
        .map((p) => [p.maquina, [p.lat, p.lon] as [number, number]]),
    );
    const continua = (seg: [number, number][], titulo: string) => {
      L.polyline(seg, { color: '#ffffff', weight: 9, opacity: 0.95, interactive: false }).addTo(grupo);
      L.polyline(seg, { color: COR_ROTA, weight: 5, opacity: 1 }).bindTooltip(titulo, { sticky: true }).addTo(grupo);
    };
    const tracejada = (de: [number, number], ate: [number, number], titulo: string) => {
      L.polyline([de, ate], { color: '#ffffff', weight: 7, opacity: 0.9, dashArray: '2 12', lineCap: 'round', interactive: false }).addTo(grupo);
      L.polyline([de, ate], { color: COR_ROTA, weight: 4, opacity: 1, dashArray: '2 12', lineCap: 'round' })
        .bindTooltip(titulo, { sticky: true })
        .addTo(grupo);
    };
    const SEM_REGISTRO = 'Sem registro do caminho entre estas posições (máquina desligada ou sem posição)';
    for (const m of rastro?.maquinas ?? []) {
      const segs = m.segmentos.filter((s) => s.length > 0);
      if (segs.length === 0) continue;
      const titulo =
        `<strong>Rota · SN ${escapar(m.maquina)}</strong><br>${fmtHora(m.inicio)} → ${fmtHora(m.fim)} · ` +
        `${m.pontos.toLocaleString('pt-BR')} pontos registrados`;
      segs.forEach((seg, i) => {
        if (i > 0) tracejada(segs[i - 1][segs[i - 1].length - 1], seg[0], `<strong>SN ${escapar(m.maquina)}</strong><br>${SEM_REGISTRO}`);
        if (seg.length >= 2) continua(seg, titulo);
      });
      // Até a posição ao vivo (se ela já se afastou da última registrada).
      const ponta = vivas.get(m.maquina);
      const ult = segs[segs.length - 1][segs[segs.length - 1].length - 1];
      if (ponta && distanciaM(ult, ponta) >= 20) {
        const recente = Date.now() - new Date(m.fim).getTime() < 10 * 60_000;
        if (recente) continua([ult, ponta], titulo);
        else tracejada(ult, ponta, `<strong>SN ${escapar(m.maquina)}</strong><br>Posição anterior → atual. ${SEM_REGISTRO}`);
      }
      // Início da rota no período.
      L.circleMarker(segs[0][0], { radius: 5, weight: 3, color: COR_ROTA, fillColor: '#ffffff', fillOpacity: 1 })
        .bindTooltip(`<strong>SN ${escapar(m.maquina)}</strong> · início da rota no período (${fmtHora(m.inicio)})`)
        .addTo(grupo);
    }
  }, [rastro, mostrarRota, pontasVivas]);

  // Máquinas: um marcador por SN, MOVIDO a cada posição ao vivo (não recriado)
  // — anda suave e não pisca. Círculo de incerteza quando a fonte informa a
  // precisão em metros (Localização do Windows).
  useEffect(() => {
    const mapa = mapRef.current;
    const grupo = frotaRef.current;
    if (!mapa || !grupo) return;
    const vistos = new Set<string>();
    for (const p of frota) {
      if (p.lat === null || p.lon === null) continue;
      vistos.add(p.maquina);
      const latlng: L.LatLngTuple = [p.lat, p.lon];
      const meta = p.fonte ? FONTE_POSICAO_META[p.fonte] : undefined;
      const prec = precisao(p);
      const balao =
        `<strong>SN ${escapar(p.maquina)}</strong>${p.modelo ? ` · ${escapar(p.modelo)}` : ' · não cadastrada'}<br>` +
        `${escapar(situacao(p))}${p.em ? ` · ${fmtHora(p.em)}` : ''}<br>` +
        `${meta ? escapar(meta.label) : 'posição'}${prec ? ` · ${escapar(prec)}` : ''}` +
        (p.origem === 'trajeto' ? '<br><span style="opacity:.75">última posição do trajeto sincronizado</span>' : '') +
        (p.origem === 'tora' ? '<br><span style="opacity:.75">posição da última tora inspecionada</span>' : '');
      // Pino vermelho e branco (como o do Maps), com a ponta na posição.
      const icone = L.divIcon({
        className: 'frota-marcador',
        html:
          `<span class="frota-pino${p.online ? ' frota-online' : ' frota-offline'}">` +
          `<span class="frota-pulso"></span>${PINO_SVG}</span>` +
          `<span class="frota-rotulo">${escapar(p.maquina)}${p.online ? '' : ' · sem sinal'}</span>`,
        iconSize: [30, 42],
        iconAnchor: [15, 41],
      });
      const raioM = p.precisao_m != null && p.precisao_m > 0 ? p.precisao_m : null;
      const existente = marcadoresRef.current.get(p.maquina);
      if (existente) {
        existente.pino.setLatLng(latlng).setTooltipContent(balao);
        // Ícone só muda com o estado: trocar a cada posição reiniciaria o pulso.
        if (existente.online !== p.online) {
          existente.pino.setIcon(icone);
          existente.online = p.online;
        }
        if (raioM !== null && existente.raio) existente.raio.setLatLng(latlng).setRadius(raioM);
        else if (raioM !== null) existente.raio = L.circle(latlng, { radius: raioM, ...estiloRaio(tokens) }).addTo(grupo);
        else if (existente.raio) {
          existente.raio.remove();
          existente.raio = null;
        }
      } else {
        const raio = raioM !== null ? L.circle(latlng, { radius: raioM, ...estiloRaio(tokens) }).addTo(grupo) : null;
        const pino = L.marker(latlng, { icon: icone, zIndexOffset: 1000, keyboard: false })
          .bindTooltip(balao, { direction: 'top', offset: [0, -40] })
          .addTo(grupo);
        marcadoresRef.current.set(p.maquina, { pino, raio, online: p.online });
      }
    }
    // Máquina que saiu da lista (filtro/limpeza): tira do mapa.
    for (const [sn, m] of marcadoresRef.current) {
      if (vistos.has(sn)) continue;
      m.pino.remove();
      m.raio?.remove();
      marcadoresRef.current.delete(sn);
    }
    // Primeira carga sem toras com posição, mas com máquina: enquadra nelas.
    if (!enquadradoRef.current && celulas.length === 0 && extrasRef.current.length > 0) {
      enquadrarTudo(mapa, [], extrasRef.current);
      enquadradoRef.current = true;
    }
  }, [frota, tokens, celulas.length]);

  useEffect(() => {
    if (!focoMaquina || !mapRef.current) return;
    const m = marcadoresRef.current.get(focoMaquina.maquina);
    if (!m) return;
    mapRef.current.flyTo(m.pino.getLatLng(), Math.max(mapRef.current.getZoom(), 17), { duration: 0.6 });
    m.pino.openTooltip();
  }, [focoMaquina]);

  useEffect(() => {
    if (enquadrar > 0 && mapRef.current) enquadrarTudo(mapRef.current, celulas, extrasRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enquadrar]);

  useEffect(() => {
    if (!foco || !mapRef.current) return;
    const ret = retangulosRef.current.get(foco.zona);
    if (!ret) return;
    mapRef.current.flyToBounds(ret.getBounds(), { maxZoom: 19, padding: [60, 60], duration: 0.6 });
    ret.openTooltip();
  }, [foco]);

  return <div ref={divRef} className="mapa-leaflet" aria-label="Mapa de qualidade por zona" />;
}

function enquadrarTudo(mapa: L.Map, celulas: MapaCelula[], extras: [number, number][] = []) {
  if (celulas.length === 0 && extras.length === 0) return;
  const b = L.latLngBounds([]);
  for (const c of celulas) {
    b.extend([c.lat_min, c.lon_min]);
    b.extend([c.lat_max, c.lon_max]);
  }
  for (const p of extras) b.extend(p);
  mapa.fitBounds(b, { padding: [24, 24], maxZoom: 19 });
}

// Rota em azul (como a do Maps): se distingue do verde/amarelo/vermelho das zonas.
const COR_ROTA = '#1a73e8';

// Pino da máquina: gota vermelha com contorno escuro e o miolo branco.
const PINO_SVG =
  '<svg viewBox="0 0 30 42" width="30" height="42" aria-hidden="true">' +
  '<path d="M15 1.5C7.5 1.5 1.5 7.4 1.5 14.8c0 10 12 24.2 12.5 24.8a1.3 1.3 0 0 0 2 0c.5-.6 12.5-14.8 12.5-24.8C28.5 7.4 22.5 1.5 15 1.5z" ' +
  'fill="#e3191c" stroke="#161a15" stroke-width="2.5"/>' +
  '<circle cx="15" cy="14.8" r="5.6" fill="#ffffff" stroke="#161a15" stroke-width="2.2"/></svg>';

function distanciaM(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function estiloRaio(t: ThemeTokens): L.CircleMarkerOptions {
  return { color: t.textPrimary, weight: 1, opacity: 0.5, fillColor: t.textPrimary, fillOpacity: 0.06, dashArray: '4 4', interactive: false };
}
