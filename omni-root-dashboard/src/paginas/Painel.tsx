import { useCallback, useEffect, useState } from 'react';
import { alternarModo } from '../acessibilidade';
import type { Conta } from '../api';
import AjudaAtalhos from '../components/AjudaAtalhos';
import Configuracoes from '../components/Configuracoes';
import GestaoUsuarios from '../components/GestaoUsuarios';
import MinhaSenha from '../components/MinhaSenha';
import BarraLateral, { EVENTO_SECAO } from '../components/BarraLateral';
import AvisoConexao from '../components/AvisoConexao';
import { pedirExportacao, type Kind as FormatoExportacao } from '../components/ExportMenu';
import Cabecalho from '../components/Cabecalho';
import CameraAoVivo, { alternarCameraTelaCheia } from '../components/CameraAoVivo';
import FiltersBar from '../components/Filters';
import Heatmap from '../components/Heatmap';
import Histograma from '../components/Histograma';
import MapaQualidade from '../components/MapaQualidade';
import NavCelular from '../components/NavCelular';
import ProportionDonut from '../components/ProportionDonut';
import QualidadeTalhao, { PrevisaoFabrica } from '../components/QualidadeTalhao';
import Secao, { definirRecolhida, estaRecolhida, expandirTodas } from '../components/Secao';
import SummaryCards from '../components/SummaryCards';
import { EVENTO_PROXIMO_TEMA, rotuloProximoTema } from '../components/ThemeToggle';
import TimeSeriesChart from '../components/TimeSeriesChart';
import UltimaInspecao from '../components/UltimaInspecao';
import { QrTelaCheia, usePlateia } from '../components/QrPlateia';
import { useEconomia } from '../economico';
import { EVENTO_NOTIFICACOES } from '../components/Notificacoes';
import { Narrador } from '../components/VozMenu';
import { isoDaysAgo } from '../datas';
import { useAnuncioInspecao } from '../hooks/useAnuncioInspecao';
import { useAtalhos, type Atalho } from '../hooks/useAtalhos';
import { useDadosPainel } from '../hooks/useDadosPainel';
import { aumentarTexto, diminuirTexto, escalaAtual, textoPadrao } from '../tamanhoTexto';
import type { Bucket, Filters, Status } from '../types';
import { descreverInspecao, descreverResumo, useVoz } from '../voz';

// Rola até a seção, expande se estiver recolhida e acende um contorno por um instante — a
// banca vê para onde o apresentador foi.
function irPara(id: string): void {
  definirRecolhida(id, false);
  window.dispatchEvent(new CustomEvent(EVENTO_SECAO, { detail: id })); // barra lateral marca a seção escolhida
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12, behavior: suave ? 'smooth' : 'auto' });
    el.classList.remove('destaque-atalho');
    void el.offsetWidth; // reinicia a animação se a mesma tecla for usada de novo
    el.classList.add('destaque-atalho');
    window.setTimeout(() => el.classList.remove('destaque-atalho'), 1600);
  });
}

// Volta ao topo da página (teclas I e Home) — na apresentação, recomeçar o
// roteiro do início sem rolar. Avisa a barra lateral para marcar a primeira
// seção na hora (senão ela seguiria marcando a última escolhida por ~1,5 s).
function irAoTopo(): void {
  window.dispatchEvent(new CustomEvent(EVENTO_SECAO, { detail: 'resumo' }));
  const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: suave ? 'smooth' : 'auto' });
}

function alternarTelaCheia(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

// A página do painel (usuário logado): estado dos filtros, os dados
// (useDadosPainel), os atalhos de teclado e o layout em grade dos painéis.
export default function Painel({ conta, onLogout }: { conta: Conta; onLogout: () => void }) {
  const { plateia } = conta;
  const [filters, setFilters] = useState<Filters>({
    from: isoDaysAgo(29),
    to: isoDaysAgo(0),
    maquinaId: '',
  });
  const [bucket, setBucket] = useState<Bucket>('day');
  // Acumulado: cada ponto soma tudo até ali — a linha só sobe. É o modo que
  // "constrói" o gráfico ao vivo durante a demonstração.
  const [acumulado, setAcumulado] = useState(false);
  const [heatStatuses, setHeatStatuses] = useState<Status[]>(['reprovado', 'quarentena']);
  const [ajudaAberta, setAjudaAberta] = useState(false);
  // Janelas de conta (cabeçalho): "Usuários" e "Configurações" (admin) e "Minha senha".
  const [janelaConta, setJanelaConta] = useState<'usuarios' | 'configuracoes' | 'senha' | null>(null);
  const fecharJanelaConta = useCallback(() => setJanelaConta(null), []);
  // QR code da plateia (tecla Q): só no notebook da equipe — quem já está no
  // celular (convidado ou pelo túnel) não precisa, e não gasta consulta com ele.
  const { economico } = useEconomia();
  const [qrAberto, setQrAberto] = useState(false);
  const estadoQr = usePlateia(!plateia && !economico);
  // Confirmação curta de cada atalho ("Texto 130%", "Acumulado ligado"):
  // quem apresenta e a banca sabem que a tecla funcionou.
  const [aviso, setAviso] = useState<{ texto: string; n: number } | null>(null);
  const avisar = (texto: string) => setAviso((a) => ({ texto, n: (a?.n ?? 0) + 1 }));
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 1600);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const {
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
    loading,
  } = useDadosPainel(filters, bucket, heatStatuses, onLogout);
  const voz = useVoz();
  useAnuncioInspecao(ultima, live.novas, voz);

  const maquinaFiltrada = maquinas.find((m) => String(m.id) === filters.maquinaId)?.numero_serie ?? null;
  const lerResumo = () => {
    if (summary) voz.falar(descreverResumo(summary, filters.from, filters.to, maquinaFiltrada), { forcar: true });
  };
  const lerUltima = () => {
    if (ultima) voz.falar(descreverInspecao(ultima, true), { forcar: true });
  };

  const texto = (f: () => void) => () => {
    f();
    avisar(`Texto ${Math.round(escalaAtual() * 100)}%`);
  };
  // Teclas B, P e S: o download sai do período e máquina filtrados, como no menu Exportar.
  const exportarPorTecla = (formato: FormatoExportacao, nome: string) => () =>
    avisar(pedirExportacao(formato) ? `Gerando ${nome}…` : 'Aguarde: já há uma exportação em andamento');
  const atalhos: Atalho[] = [
    {
      teclas: ['i', 'Home'],
      grupo: 'Ir para',
      descricao: 'Topo da página (início)',
      acao: () => {
        irAoTopo();
        avisar('Topo da página');
      },
    },
    // Mesma ordem e números da barra lateral (Painel 1–4, Análises 5–8).
    { teclas: ['1'], grupo: 'Ir para', descricao: 'Resumo do período', acao: () => irPara('resumo') },
    { teclas: ['2'], grupo: 'Ir para', descricao: 'Agora: câmera e última inspeção', acao: () => irPara('agora') },
    { teclas: ['3'], grupo: 'Ir para', descricao: 'Onde agir: mapa de qualidade', acao: () => irPara('mapa') },
    { teclas: ['4'], grupo: 'Ir para', descricao: 'Qualidade por talhão e clone', acao: () => irPara('qualidade') },
    { teclas: ['5'], grupo: 'Ir para', descricao: 'Distribuições (diâmetro, casca, tortuosidade)', acao: () => irPara('diametro') },
    { teclas: ['6'], grupo: 'Ir para', descricao: 'Eventos ao longo do tempo', acao: () => irPara('tempo') },
    { teclas: ['7'], grupo: 'Ir para', descricao: 'Proporção por classificação', acao: () => irPara('proporcao') },
    { teclas: ['8'], grupo: 'Ir para', descricao: 'Mapa de calor de falhas', acao: () => irPara('calor') },
    { teclas: ['+', '='], grupo: 'Tela', descricao: 'Aumentar o texto', acao: texto(aumentarTexto) },
    { teclas: ['-'], grupo: 'Tela', descricao: 'Diminuir o texto', acao: texto(diminuirTexto) },
    { teclas: ['0'], grupo: 'Tela', descricao: 'Texto no tamanho padrão', acao: texto(textoPadrao) },
    {
      teclas: ['t'],
      grupo: 'Tela',
      descricao: 'Alternar tema (sistema / claro / escuro)',
      acao: () => {
        avisar(`Tema: ${rotuloProximoTema()}`);
        window.dispatchEvent(new Event(EVENTO_PROXIMO_TEMA));
      },
    },
    {
      teclas: ['c'],
      grupo: 'Tela',
      descricao: 'Cores para daltônicos (liga / desliga)',
      acao: () => avisar(alternarModo('daltonico') ? 'Cores para daltônicos: ligado' : 'Cores para daltônicos: desligado'),
    },
    {
      teclas: ['d'],
      grupo: 'Tela',
      descricao: 'Leitura para dislexia (liga / desliga)',
      acao: () => avisar(alternarModo('dislexia') ? 'Leitura para dislexia: ligado' : 'Leitura para dislexia: desligado'),
    },
    {
      teclas: ['x'],
      grupo: 'Tela',
      descricao: 'Alto contraste (liga / desliga)',
      acao: () => avisar(alternarModo('contraste') ? 'Alto contraste: ligado' : 'Alto contraste: desligado'),
    },
    { teclas: ['f'], grupo: 'Tela', descricao: 'Tela cheia (liga / desliga)', acao: alternarTelaCheia },
    {
      teclas: ['v'],
      grupo: 'Tela',
      descricao: 'Câmera ao vivo em tela cheia (liga / desliga)',
      acao: () => {
        if (alternarCameraTelaCheia()) return;
        if (estaRecolhida('camera')) {
          irPara('camera');
          avisar('Câmera aberta: tecle V de novo para a tela cheia');
        } else avisar('Nenhuma câmera transmitindo agora');
      },
    },
    {
      teclas: ['e'],
      grupo: 'Tela',
      descricao: 'Expandir todos os painéis recolhidos',
      acao: () => avisar(expandirTodas() ? 'Painéis expandidos' : 'Nenhum painel recolhido'),
    },
    {
      teclas: ['l'],
      grupo: 'Demonstração',
      descricao: 'Ler em voz alta a última inspeção',
      acao: () => {
        if (!voz.suportado) avisar('Voz indisponível neste navegador');
        else if (!ultima) avisar('Nenhuma inspeção recebida ainda');
        else lerUltima();
      },
    },
    {
      teclas: ['r'],
      grupo: 'Demonstração',
      descricao: 'Ler em voz alta o resumo do período',
      acao: () => (voz.suportado ? lerResumo() : avisar('Voz indisponível neste navegador')),
    },
    {
      teclas: ['a'],
      grupo: 'Demonstração',
      descricao: 'Gráfico no tempo: acumulado liga / desliga',
      acao: () => {
        setAcumulado(!acumulado);
        avisar(acumulado ? 'Acumulado desligado' : 'Acumulado ligado');
      },
    },
    {
      teclas: ['n'],
      grupo: 'Demonstração',
      descricao: 'Notificações (abre / fecha)',
      acao: () => window.dispatchEvent(new Event(EVENTO_NOTIFICACOES)),
    },
    { teclas: ['p'], grupo: 'Demonstração', descricao: 'Baixar o relatório PDF do período', acao: exportarPorTecla('pdf', 'PDF') },
    { teclas: ['b'], grupo: 'Demonstração', descricao: 'Baixar os dados brutos (CSV)', acao: exportarPorTecla('csv', 'CSV') },
    { teclas: ['s'], grupo: 'Demonstração', descricao: 'Baixar no padrão StanForD (.hpr em ZIP)', acao: exportarPorTecla('stanford', 'StanForD') },
    { teclas: ['?', 'h'], grupo: 'Demonstração', descricao: 'Mostrar / esconder esta ajuda', acao: () => setAjudaAberta((v) => !v) },
    ...(plateia
      ? []
      : [
          {
            teclas: ['q'],
            grupo: 'Demonstração' as const,
            descricao: 'QR code para a plateia abrir o painel no celular (tela cheia)',
            acao: () => {
              if (estadoQr?.configurado) setQrAberto((v) => !v);
              else avisar('QR code desligado: túnel não configurado (TUNEL no .env)');
            },
          },
        ]),
    {
      teclas: ['Escape'],
      grupo: 'Demonstração',
      descricao: 'Fechar a ajuda ou o QR code',
      acao: () => {
        setAjudaAberta(false);
        setQrAberto(false);
      },
    },
  ];
  // Com uma janela de conta aberta, as teclas do painel ficam desligadas (um
  // "p" com o foco num botão da janela não pode baixar o PDF); ela fecha no Esc.
  useAtalhos(janelaConta ? [] : atalhos);

  return (
    <div className="app">
      <BarraLateral
        onIr={irPara}
        onAtalhos={() => setAjudaAberta(true)}
        qr={estadoQr?.configurado ? estadoQr : null}
        onQr={() => setQrAberto(true)}
      />
      <div className="layout">
        <Cabecalho
          live={live}
          voz={voz}
          filters={filters}
          conta={conta}
          onUsuarios={() => setJanelaConta('usuarios')}
          onConfiguracoes={() => setJanelaConta('configuracoes')}
          onSenha={() => setJanelaConta('senha')}
          onLogout={onLogout}
          onAtalhos={() => setAjudaAberta(true)}
          alertas={tendencia}
        />

        <FiltersBar filters={filters} maquinas={maquinas} onChange={setFilters} />
        <Narrador texto={voz.ultimoTexto} />

        <AvisoConexao error={error} temDados={summary !== null} atualizadoEm={atualizadoEm} tentativas={tentativas} />

        {loading && !error && <div className="loading">Carregando…</div>}


        {summary && (
          <div className="grid">
            <div className="cards-wrap" id="resumo">
              <div className="cards-head">
                <span className="cards-titulo">Resumo do período</span>
                <button
                  type="button"
                  className="btn btn-ler"
                  onClick={lerResumo}
                  disabled={!voz.suportado}
                  title="Ler em voz alta o resumo do período filtrado (tecla R)"
                >
                  <span aria-hidden="true">🔊</span> Ler resumo
                </button>
              </div>
              <SummaryCards rows={summary} />
            </div>
            <Secao
              id="camera"
              className="panel-camera third"
              titulo="Câmera ao vivo"
              sub="O que a garra está vendo agora — só enquanto a máquina tem rede"
            >
              <CameraAoVivo maquinas={maquinas} filtroMaquinaId={filters.maquinaId} />
            </Secao>

            <Secao
              id="agora"
              // O painel inteiro veste a cor do resultado da última tora
              // (aprovada / contenção / rejeitada) — lida do outro lado da sala.
              className={`panel-ultima two-thirds${ultima ? ` ultima-${ultima.status}` : ''}`}
              titulo="Última inspeção recebida do campo"
              sub="Indicadores da tora mais recente — atualiza sozinho quando a máquina sincroniza"
              acoes={
                <button
                  type="button"
                  className="btn btn-ler"
                  onClick={lerUltima}
                  disabled={!ultima || !voz.suportado}
                  title="Ler em voz alta os indicadores desta tora (tecla L)"
                >
                  <span aria-hidden="true">🔊</span> Ler
                </button>
              }
            >
              <UltimaInspecao u={ultima} />
            </Secao>


            <Secao
              id="mapa"
              className="panel-mapa"
              titulo="Mapa de qualidade"
              sub="Onde está a casca alta, a madeira torta e a rejeição — cada tora na posição da máquina no corte (GNSS), agrupada por zona. Funciona sem internet; o mapa de ruas é opcional."
            >
              <MapaQualidade mapa={mapa} filters={filters} />
            </Secao>

            <Secao
              id="qualidade"
              titulo="Qualidade da madeira por talhão e clone"
              sub="Casca residual, tortuosidade, volume, massa seca e celulose prevista — com a proveniência de cada referência por clone"
            >
              <QualidadeTalhao rows={qualidade?.porTalhao ?? []} />
              <PrevisaoFabrica rows={qualidade?.porTalhao ?? []} />
            </Secao>


            <Secao
              id="diametro"
              className="third"
              titulo="Distribuição diamétrica"
              sub="Toras por classe de diâmetro — 100% das toras, não amostra"
            >
              <Histograma data={qualidade?.diametro ?? []} unidade="diâmetro" />
            </Secao>

            <Secao
              id="casca"
              className="third"
              titulo="Distribuição de casca residual"
              sub="% da superfície da tora ainda coberta por casca"
            >
              <Histograma data={qualidade?.casca ?? []} unidade="casca residual" />
            </Secao>

            <Secao
              id="tortuosidade"
              className="third"
              titulo="Distribuição de tortuosidade"
              sub="Flecha do eixo / comprimento, só toras vistas de lado"
            >
              <Histograma data={qualidade?.tortuosidade ?? []} unidade="tortuosidade" />
            </Secao>

            <Secao
              id="tempo"
              className="two-thirds"
              titulo="Eventos ao longo do tempo"
              sub="Contagem por classificação em cada intervalo"
              acoes={
                <>
                  <label className="chk" title="Tecla A">
                    <input type="checkbox" checked={acumulado} onChange={(e) => setAcumulado(e.target.checked)} />
                    Acumulado
                  </label>
                  <select
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value as Bucket)}
                    aria-label="Granularidade da série temporal"
                  >
                    <option value="minute">Por minuto</option>
                    <option value="hour">Por hora</option>
                    <option value="day">Por dia</option>
                    <option value="week">Por semana</option>
                  </select>
                </>
              }
            >
              <TimeSeriesChart data={timeseries ?? []} bucket={bucket} acumulado={acumulado} />
            </Secao>

            <Secao
              id="proporcao"
              className="third"
              titulo="Proporção por classificação"
              sub="Participação de cada resultado no período"
            >
              <ProportionDonut rows={summary} />
            </Secao>

            <Secao
              id="calor"
              titulo="Mapa de calor de falhas"
              sub="Concentração por dia da semana × hora do dia (horário local da máquina)"
            >
              <Heatmap cells={heatmap ?? []} statuses={heatStatuses} onStatusesChange={setHeatStatuses} />
            </Secao>
          </div>
        )}

        {summary && <NavCelular />}

        <div className={`aviso-atalho${aviso ? ' visivel' : ''}`} role="status" aria-live="polite">
          {aviso?.texto}
        </div>
        {ajudaAberta && <AjudaAtalhos atalhos={atalhos} onFechar={() => setAjudaAberta(false)} />}
        {qrAberto && estadoQr?.configurado && <QrTelaCheia estado={estadoQr} onFechar={() => setQrAberto(false)} />}
        {janelaConta === 'usuarios' && (
          <GestaoUsuarios euLogin={conta.user} onFechar={fecharJanelaConta} onLogout={onLogout} />
        )}
        {janelaConta === 'configuracoes' && <Configuracoes onFechar={fecharJanelaConta} onLogout={onLogout} />}
        {janelaConta === 'senha' && <MinhaSenha onFechar={fecharJanelaConta} onLogout={onLogout} />}
      </div>
    </div>
  );
}
