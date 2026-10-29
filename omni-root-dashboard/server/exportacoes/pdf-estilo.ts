// Identidade visual e formatação comuns do relatório PDF (texto e mapa).
import type { Status } from '../validate.js';
import type { Metrica, Nivel } from '../consultas/mapa.js';


// Identidade John Deere: verde (PMS 364) e amarelo (PMS 109).
export const JD_GREEN = '#367c2b';
export const JD_GREEN_DARK = '#2a5f22';
export const JD_YELLOW = '#ffde00';
export const INK = '#161a15';
export const MUTED = '#5f6a5c';
export const RULE = '#d9e0d5';
export const ZEBRA = '#f3f6f1';
export const STATUS_COLOR: Record<Status, string> = {
  aprovado: JD_GREEN,
  quarentena: '#c98f00',
  reprovado: '#b8322b',
};

export function pct(n: number, d: number): string {
  return d > 0 ? ((n / d) * 100).toFixed(1).replace('.', ',') + '%' : '—';
}
export function conf(v: number | null): string {
  return v == null ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%';
}
export function num(v: number | null | undefined, casas = 1, sufixo = ''): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(casas).replace('.', ',') + sufixo;
}
// Helvetica padrão do pdfkit (WinAnsi) não tem ≤ ≥ — sairiam como "'d"/"'e".
export function ascii(txt: string): string {
  return txt.replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/–/g, '-');
}
export function tipoDadoLabel(t: string | null): string {
  return t === 'laboratorio' ? 'laboratório' : t === 'literatura' ? 'literatura' : t === 'referencia_generica' ? 'ref. genérica' : '—';
}

export const NIVEL_COR: Record<Nivel, string> = {
  ok: JD_GREEN,
  atencao: '#c98f00',
  critico: '#b8322b',
  sem: '#9aa596',
};
export const METRICA_TITULO: Record<Metrica, string> = {
  casca: 'Casca residual',
  tort: 'Tortuosidade',
  falhas: 'Rejeição',
};
