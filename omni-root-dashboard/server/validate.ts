// Validação dos parâmetros de query string. Tudo que chega do cliente passa
// por aqui antes de virar parâmetro SQL ($1, $2, ...).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const STATUSES = ['aprovado', 'quarentena', 'reprovado'] as const;
export type Status = (typeof STATUSES)[number];

export const BUCKETS = ['minute', 'hour', 'day', 'week'] as const;
export type Bucket = (typeof BUCKETS)[number];

export class ValidationError extends Error {}
// Pedido válido que esbarra numa regra (ex.: remover o último admin) -> 409.
export class ConflictError extends Error {}
export class NotFoundError extends Error {}

export function parseDate(value: unknown, name: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new ValidationError(`Parâmetro "${name}" deve ser uma data YYYY-MM-DD`);
  }
  return value;
}

export function parseMaquinaId(value: unknown): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError('Parâmetro "maquinaId" deve ser um inteiro positivo');
  }
  return n;
}

export function parseBucket(value: unknown): Bucket {
  if (value === undefined) return 'day';
  if (typeof value === 'string' && (BUCKETS as readonly string[]).includes(value)) {
    return value as Bucket;
  }
  throw new ValidationError(`Parâmetro "bucket" deve ser um de: ${BUCKETS.join(', ')}`);
}

export function parseStatuses(value: unknown): Status[] {
  // padrão do mapa de calor: falhas = reprovado + quarentena
  if (value === undefined || value === '') return ['reprovado', 'quarentena'];
  if (typeof value !== 'string') throw new ValidationError('Parâmetro "statuses" inválido');
  const parts = value.split(',').map((s) => s.trim());
  for (const p of parts) {
    if (!(STATUSES as readonly string[]).includes(p)) {
      throw new ValidationError(`Status desconhecido: "${p}"`);
    }
  }
  return parts as Status[];
}
