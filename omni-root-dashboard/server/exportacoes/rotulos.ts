// Rótulos e mapeamentos de status compartilhados pelas exportações.
import type { Status } from '../validate.js';

// Rótulos exibidos ao usuário (iguais aos do cliente).
export const STATUS_LABEL: Record<Status, string> = {
  aprovado: 'Aprovada',
  quarentena: 'Contenção',
  reprovado: 'Rejeitada',
};

// Mapeamento para o "grade" (classificação) usado no StanForD.
export const STATUS_STANFORD: Record<Status, { code: number; text: string }> = {
  aprovado: { code: 1, text: 'OK' },
  quarentena: { code: 2, text: 'REVISAO_MANUAL' },
  reprovado: { code: 3, text: 'REJEITADO' },
};

// De onde veio a posição da tora (pos_fonte) — mesma proveniência do cliente.
export const FONTE_POSICAO_LABEL: Record<string, string> = {
  gnss_serial: 'GNSS (receptor / GNSS da máquina)',
  gnss_log: 'trilha GNSS gravada e reproduzida (demonstração)',
  windows_localizacao: 'Localização do Windows (notebook da maquete, via Wi-Fi)',
  linux_geoclue: 'Localização do Linux, GeoClue (notebook da maquete, via Wi-Fi ou IP)',
};

// 0 = domingo ... 6 = sábado (convenção do EXTRACT(DOW) do Postgres).
export const DOW_LABEL = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

// "2026-09-01T13:45:00" -> "01/09/2026 13:45:00"
export function fmtDateBR(iso: string | null): string {
  if (!iso) return '—';
  const [d, t] = iso.split('T');
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}${t ? ' ' + t : ''}`;
}
