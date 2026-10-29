export type Status = 'aprovado' | 'quarentena' | 'reprovado';

// Contas do dashboard (tabela usuarios). admin = gerencia as contas;
// leitor = painel e exportações; convidado = painel no modo econômico.
export type Papel = 'admin' | 'leitor' | 'convidado';

export interface Usuario {
  id: number;
  login: string;
  nome: string | null;
  papel: Papel;
  ativo: boolean;
  versaoSessao: number;
  temSenha: boolean; // false = conta só de login social
  criadoEm: string;
  ultimoLogin: string | null;
}

// Configuração da aplicação (tabela configuracoes; tela "Configurações").
export interface Configuracao {
  chave: string;
  rotulo: string;
  descricao: string;
  tipo: 'texto' | 'booleano' | 'inteiro';
  valor: string | number | boolean;
  padrao: string | number | boolean;
  unidade?: string;
  min?: number;
  max?: number;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

export interface Maquina {
  id: number;
  modelo: string;
  numero_serie: string;
}

export interface SummaryRow {
  status: Status;
  total: number;
}

export interface TimeseriesPoint {
  bucket: string; // "YYYY-MM-DDTHH:mm:ss" (hora local do evento, sem fuso)
  aprovado: number;
  quarentena: number;
  reprovado: number;
}

export interface HeatmapCell {
  dow: number; // 0 = domingo ... 6 = sábado
  hora: number; // 0..23
  total: number;
}

export type Bucket = 'minute' | 'hour' | 'day' | 'week';

export interface Filters {
  from: string;
  to: string;
  maquinaId: string; // '' = todas
}

// Rótulos e cores de status usados em toda a UI (cores de status são fixas,
// nunca reaproveitadas como cores de série genéricas).
// `icone`: no modo daltônico a bolinha de status vira este símbolo — a cor
// nunca é a única pista (ver estilos/acessibilidade.css).
export const STATUS_META: Record<Status, { label: string; cssVar: string; icone: string }> = {
  aprovado: { label: 'Aprovada', cssVar: 'var(--status-good)', icone: '✓' },
  quarentena: { label: 'Contenção', cssVar: 'var(--status-warning)', icone: '!' },
  reprovado: { label: 'Rejeitada', cssVar: 'var(--status-critical)', icone: '✕' },
};

export const STATUS_ORDER: Status[] = ['aprovado', 'quarentena', 'reprovado'];

// ---- Indicadores de qualidade (o que o desafio pede) ----
export type TipoDado = 'laboratorio' | 'literatura' | 'referencia_generica' | null;

export interface DensidadeInfo {
  valor: number | null;
  clone: string | null;
  tipo_dado: TipoDado;
  min: number | null;
  max: number | null;
  fonte: string | null;
}

export interface UltimaInspecao {
  id: number;
  data: string;
  status: Status;
  confianca: number;
  log_id: string;
  maquina_modelo: string | null;
  maquina_serie: string | null;
  talhao_nome: string | null;
  vista: 'secao' | 'lateral' | 'desconhecida';
  diametro_cm: number | null;
  comprimento_cm: number | null;
  comprimento_medido: boolean;
  tortuosidade: number | null;
  casca_pct: number | null;
  volume_m3: number | null;
  massa_kg: number | null;
  massa_min_kg: number | null;
  massa_max_kg: number | null;
  densidade: DensidadeInfo;
  saude_pct: number | null;
  defeitos: number;
  defeitos_tipos: string[];
  posicao: PosicaoTora | null;
  luz: 'boa' | 'baixa' | 'critica';
}

// ---- Posição / mapa de qualidade ----
export interface PosicaoTora {
  lat: number;
  lon: number;
  fonte: string | null;
  hdop: number | null;
  satelites: number | null;
  precisao_m: number | null;
}

// De onde veio a posição — declarado na tela, como a proveniência da densidade.
export const FONTE_POSICAO_META: Record<string, { label: string; hint: string }> = {
  gnss_serial: {
    label: 'GNSS',
    hint: 'Receptor GNSS em porta serial (NMEA): o GNSS da máquina ou um receptor USB',
  },
  gnss_log: {
    label: 'Trilha gravada',
    hint: 'Trilha GNSS real gravada antes e reproduzida pelo mesmo código (demonstração)',
  },
  windows_localizacao: {
    label: 'Localização do Windows',
    hint: 'Notebook da maquete no papel da máquina: posição estimada pelo Windows via Wi-Fi (precisão de dezenas de metros, informada pelo próprio Windows)',
  },
  linux_geoclue: {
    label: 'Localização do Linux',
    hint: 'Notebook da maquete no papel da máquina: posição estimada pelo GeoClue via Wi-Fi ou IP (precisão informada pelo próprio GeoClue; por IP, de quilômetros)',
  },
};

/** Fontes que são o serviço de localização do sistema operacional (não GNSS). */
export const FONTES_DO_SISTEMA = ['windows_localizacao', 'linux_geoclue'];

export interface MapaCelula {
  zona: string;
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
  toras: number;
  falhas: number;
  casca_media: number | null;
  casca_n: number;
  tort_media: number | null;
  tort_n: number;
  diam_medio: number | null;
  luz_critica_n: number;
  primeira: string;
  ultima: string;
  niveis?: Record<Metrica, Nivel>;
}

export type Metrica = 'casca' | 'tort' | 'falhas';
export type Nivel = 'ok' | 'atencao' | 'critico' | 'sem';

// "Onde agir" — calculado no servidor (mesma regra do PDF).
export interface AlertaZona {
  zona: string;
  metrica: Metrica;
  nivel: 'atencao' | 'critico';
  valor: number;
  n: number;
  limite: number;
  curto: string;
  acao: string;
}

// Alerta de tendência: várias toras seguidas acima do limite na mesma máquina.
export interface AlertaTendencia {
  chave: string;
  maquina: string | null;
  metrica: Metrica;
  acima: number;
  de: number;
  media: number | null;
  limite: number;
  ultima: string;
  texto: string;
}

export interface MapaPonto {
  id: number;
  lat: number;
  lon: number;
  status: Status;
  data: string;
}

// ---- Frota: posição das máquinas em tempo real + trajeto (server/frota.ts) ----
export interface PosicaoFrota {
  maquina: string; // SN (numero_serie)
  modelo: string | null; // null = SN fora da tabela maquinas
  online: boolean; // mandou posição nos últimos segundos
  estado: string; // ok / sem_fix / sem_receptor / iniciando / offline
  lat: number | null;
  lon: number | null;
  precisao_m: number | null;
  hdop: number | null;
  satelites: number | null;
  fonte: string | null;
  em: string | null; // hora local da posição mostrada
  idadeMs: number | null;
  contatoMs: number | null; // há quanto tempo a máquina mandou o último sinal (decide "online")
  origem: 'ao_vivo' | 'trajeto' | 'tora' | null;
}

export interface TrajetoMaquina {
  maquina: string;
  segmentos: [number, number][][];
  pontos: number;
  inicio: string;
  fim: string;
}

export interface Rastro {
  disponivel: boolean;
  maquinas: TrajetoMaquina[];
}

export interface Mapa {
  disponivel: boolean;
  aviso: string | null;
  celula_m: number;
  total: number;
  com_posicao: number;
  luz_critica: number; // toras medidas em luz crítica (baixa confiança, fora dos alertas)
  fontes: { fonte: string; toras: number }[];
  celulas: MapaCelula[];
  pontos: MapaPonto[];
  pontos_truncados: boolean;
  ultima: MapaPonto | null;
  limites: Record<Metrica, [number, number]>;
  min_toras_alerta: number;
  alertas: AlertaZona[];
}

export interface QualidadeTalhao {
  talhao: string | null;
  clone: string | null;
  tipo_dado: TipoDado;
  densidade: number | null;
  densidade_min: number | null;
  densidade_max: number | null;
  toras: number;
  falhas: number;
  casca_media: number | null;
  tort_media: number | null;
  tort_n: number;
  diam_medio: number | null;
  volume_m3: number | null;
  massa_kg: number | null;
  massa_min_kg: number | null;
  massa_max_kg: number | null;
  // Previsão para a fábrica: rendimento depurado do clone e o que sai dele
  rendimento: number | null; // %
  rendimento_min: number | null;
  rendimento_max: number | null;
  rendimento_tipo_dado: TipoDado;
  rendimento_fonte: string | null;
  celulose_t: number | null; // t seca ao ar
  consumo_m3_tsa: number | null; // m³ de madeira por t seca ao ar
  consumo_min: number | null;
  consumo_max: number | null;
  consumo_tipo_dado: TipoDado; // a menos confiável entre densidade e rendimento
}

export interface Faixa {
  faixa: string;
  total: number;
}

export interface Qualidade {
  porTalhao: QualidadeTalhao[];
  tortuosidade: Faixa[];
  casca: Faixa[];
  diametro: Faixa[];
}

// Rótulo da proveniência da densidade — a "base científica" virando pixel:
// o gestor vê de onde o número veio, não só o número.
export const TIPO_DADO_META: Record<Exclude<TipoDado, null>, { label: string; hint: string }> = {
  laboratorio: { label: 'Laboratório', hint: 'Laudo de densidade básica do próprio clone' },
  literatura: { label: 'Literatura', hint: 'Valor publicado para este clone específico' },
  referencia_generica: {
    label: 'Referência genérica',
    hint: 'Média do híbrido E. grandis × urophylla; aguardando laudo do clone',
  },
};

// ---- Câmera ao vivo (quadros empurrados pelo main.py) ----
export interface CameraMaquina {
  maquina: string; // numero_serie (maquina_id do config.json da máquina)
  ultimoEm: string; // ISO
  idadeMs: number;
  online: boolean; // quadro recente o bastante para ser "ao vivo"
  status: Status | string | null;
  vista: string | null;
  ligada: boolean;
}

export interface CameraEstado {
  ligada: boolean; // STREAM_TOKEN configurado no servidor
  maquinas: CameraMaquina[];
}
