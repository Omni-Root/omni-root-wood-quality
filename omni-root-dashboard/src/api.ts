import type {
  AlertaTendencia,
  Bucket,
  CameraEstado,
  Configuracao,
  Filters,
  HeatmapCell,
  Maquina,
  Mapa,
  Papel,
  PosicaoFrota,
  Qualidade,
  Rastro,
  SummaryRow,
  TimeseriesPoint,
  UltimaInspecao,
  Usuario,
} from './types';

// Erro específico para 401: deixa o App voltar para a tela de login quando a
// sessão expira no meio do uso.
export class UnauthorizedError extends Error {
  constructor() {
    super('Sessão expirada');
    this.name = 'UnauthorizedError';
  }
}

function qsFrom(params: Record<string, string>): string {
  return new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
}

async function fetchJson<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const qs = qsFrom(params);
  const res = await fetch(qs ? `${path}?${qs}` : path, { signal });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Falha na requisição (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// Dispara o download de um arquivo servido por uma rota GET (usa o cookie de
// sessão automaticamente por ser same-origin).
async function download(path: string, params: Record<string, string>): Promise<void> {
  const qs = qsFrom(params);
  const res = await fetch(qs ? `${path}?${qs}` : path);
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Falha na exportação (${res.status})`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const name = match?.[1] ?? 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Pedido que MUDA algo (contas, senha): corpo JSON, erro do servidor vira
// Error com a mensagem dele; 401 = sessão caiu (volta ao login).
async function enviar<T>(metodo: 'POST' | 'PATCH' | 'DELETE', path: string, corpo?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Falha na requisição (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function filterParams(f: Filters): Record<string, string> {
  return { from: f.from, to: f.to, maquinaId: f.maquinaId };
}

/** A conta que entrou (resposta do login e de /api/me). */
export interface Conta {
  user: string; // login
  nome: string | null;
  papel: Papel;
  plateia: boolean; // convidado: painel no modo econômico
}

export interface MeResponse extends Partial<Conta> {
  authenticated: boolean;
  economico?: boolean; // acesso pelo túnel público (celular da plateia): src/economico.ts
  // Quem chega pelo link público e ainda não entrou: a conta de visitante está
  // ativa, então a tela de login mostra "Entrar como visitante".
  visitante?: boolean;
}

export interface NovaConta {
  login: string;
  nome: string;
  papel: Papel;
  senha: string; // '' = conta só de login social
}

export interface MudancaConta {
  nome?: string;
  papel?: Papel;
  ativo?: boolean;
  senha?: string;
  semSenha?: boolean;
}

/** Link público da plateia (QR code). noAr: null = não deu para saber (CLI do túnel não respondeu). */
export interface EstadoPlateia {
  configurado: boolean;
  url: string;
  noAr: boolean | null;
  tunel?: string | null; // zrok / tailscale / ngrok (o zrok grátis mostra um aviso na 1ª visita)
  visitante?: boolean; // há login de visitante (vem preenchido no celular)
}

export interface ProvedoresLogin {
  google: boolean;
  microsoft: boolean;
  github: boolean;
  /** OAUTH_CONVIDADOS: conta sem cadastro entra como visitante. */
  convidados: boolean;
}

export const api = {
  // ---- saúde do servidor/banco (pública) ----
  health: async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  },

  // ---- sessão ----
  me: async (): Promise<MeResponse> => {
    const res = await fetch('/api/me');
    if (!res.ok) return { authenticated: false };
    return res.json() as Promise<MeResponse>;
  },
  login: async (username: string, password: string): Promise<Conta> => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Falha no login (${res.status})`);
    }
    return res.json() as Promise<Conta>;
  },
  /** Botão "Entrar como visitante" (só pelo link público do QR code). */
  loginVisitante: () => enviar<Conta>('POST', '/api/login/visitante'),
  logout: async (): Promise<void> => {
    await fetch('/api/logout', { method: 'POST' });
  },
  /** Quais logins sociais o servidor tem configurados (sem segredo nenhum: só sim/não). */
  provedores: async (): Promise<ProvedoresLogin> => {
    const res = await fetch('/api/auth/provedores', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Falha ao consultar provedores (${res.status})`);
    return res.json() as Promise<ProvedoresLogin>;
  },

  /** Troca a própria senha (a atual é exigida, salvo conta só de login social). */
  trocarSenha: (atual: string, nova: string) => enviar<{ ok: true }>('POST', '/api/me/senha', { atual, nova }),

  // ---- contas (só admin) ----
  usuarios: (signal?: AbortSignal) => fetchJson<Usuario[]>('/api/usuarios', {}, signal),
  criarUsuario: (c: NovaConta) => enviar<Usuario>('POST', '/api/usuarios', c),
  mudarUsuario: (id: number, m: MudancaConta) => enviar<Usuario>('PATCH', `/api/usuarios/${id}`, m),
  removerUsuario: (id: number) => enviar<{ ok: true }>('DELETE', `/api/usuarios/${id}`),

  // ---- configurações da aplicação (só admin) ----
  configuracoes: (signal?: AbortSignal) => fetchJson<Configuracao[]>('/api/configuracoes', {}, signal),
  mudarConfiguracao: (chave: string, valor: Configuracao['valor']) =>
    enviar<Configuracao[]>('PATCH', `/api/configuracoes/${encodeURIComponent(chave)}`, { valor }),

  // ---- dados ----
  maquinas: (signal?: AbortSignal) => fetchJson<Maquina[]>('/api/maquinas', {}, signal),
  summary: (f: Filters, signal?: AbortSignal) =>
    fetchJson<SummaryRow[]>('/api/summary', filterParams(f), signal),
  timeseries: (f: Filters, bucket: Bucket, signal?: AbortSignal) =>
    fetchJson<TimeseriesPoint[]>('/api/timeseries', { ...filterParams(f), bucket }, signal),
  heatmap: (f: Filters, statuses: string[], signal?: AbortSignal) =>
    fetchJson<HeatmapCell[]>(
      '/api/heatmap',
      { ...filterParams(f), statuses: statuses.join(',') },
      signal,
    ),

  // ---- indicadores de qualidade ----
  ultima: (f: Filters, signal?: AbortSignal) =>
    fetchJson<UltimaInspecao | null>('/api/ultima', { maquinaId: f.maquinaId }, signal),
  qualidade: (f: Filters, signal?: AbortSignal) =>
    fetchJson<Qualidade>('/api/qualidade', filterParams(f), signal),
  mapa: (f: Filters, signal?: AbortSignal) => fetchJson<Mapa>('/api/mapa', filterParams(f), signal),
  tendencia: (f: Filters, signal?: AbortSignal) =>
    fetchJson<AlertaTendencia[]>('/api/tendencia', { maquinaId: f.maquinaId }, signal),

  // ---- frota: posição em tempo real + trajeto ----
  frota: (signal?: AbortSignal) => fetchJson<PosicaoFrota[]>('/api/frota', {}, signal),
  rastro: (f: Filters, signal?: AbortSignal) => fetchJson<Rastro>('/api/frota/rastro', filterParams(f), signal),

  // ---- câmera ao vivo ----
  camera: (signal?: AbortSignal) => fetchJson<CameraEstado>('/api/camera/maquinas', {}, signal),
  // URL do stream MJPEG (vai direto num <img>; o cookie de sessão vai junto por
  // ser same-origin). `v` muda para forçar reconexão quando o stream cai.
  cameraStreamUrl: (maquina: string, v: number) =>
    `/api/camera/stream?maquina=${encodeURIComponent(maquina)}&v=${v}`,

  // ---- plateia (QR code) ----
  plateia: () => fetchJson<EstadoPlateia>('/api/plateia', {}),
  plateiaQrUrl: '/api/plateia/qr.svg',

  // ---- exportações ----
  exportCsv: (f: Filters) => download('/api/export/csv', filterParams(f)),
  exportPdf: (f: Filters) => download('/api/export/pdf', filterParams(f)),
  exportStanford: (f: Filters) => download('/api/export/stanford', filterParams(f)),
};
