// CONSUMO ESPECÍFICO DE MADEIRA — o número com que a fábrica de celulose
// planeja a madeira: m³ de madeira sólida por tonelada seca ao ar (tsa) de
// celulose. Fórmula do consumo específico TEÓRICO (Foelkel, 2017, Eucalyptus
// Online Book, cap. 46, "Entendendo a construção do indicador de consumo
// específico de madeira para produção de celulose kraft"):
//
//   CE (m³/tsa) = 0,9 / [densidade básica (t a.s./m³) × rendimento depurado/100]
//
// 0,9 = 1 tsa tem 90% de celulose absolutamente seca (10% de umidade).
// Exemplo do próprio Foelkel: 0,5 t/m³ e 52% → 3,4615 m³/tsa.
//
// É teórico de propósito, como nos laboratórios: não inclui perdas de
// descascamento, picagem, classificação de cavacos e de fibras, nem a casca
// que segue com os cavacos. O consumo industrial é maior (benchmark ABTCP
// citado por Foelkel: 3,4–3,9 m³/tsa, média 3,7, toras descascadas).
//
// Funções puras (sem banco) para poderem ser testadas sozinhas.

export type TipoDado = 'laboratorio' | 'literatura' | 'referencia_generica';

/** t de celulose absolutamente seca por t seca ao ar (10% de umidade). */
export const FATOR_SECA_AO_AR = 0.9;

/** Consumo específico teórico, m³ de madeira por tsa. null se faltar dado. */
export function consumoEspecifico(densidadeKgM3: number | null, rendimentoPct: number | null): number | null {
  if (densidadeKgM3 == null || rendimentoPct == null || densidadeKgM3 <= 0 || rendimentoPct <= 0) return null;
  return FATOR_SECA_AO_AR / ((densidadeKgM3 / 1000) * (rendimentoPct / 100));
}

/** Celulose prevista (t seca ao ar) a partir da massa seca de madeira (kg). */
export function celulosePrevistaT(massaSecaKg: number | null, rendimentoPct: number | null): number | null {
  if (massaSecaKg == null || rendimentoPct == null || rendimentoPct <= 0) return null;
  return ((massaSecaKg / 1000) * (rendimentoPct / 100)) / FATOR_SECA_AO_AR;
}

/**
 * Faixa do consumo herdada das faixas de densidade e de rendimento do clone:
 * o menor consumo vem da maior densidade com o maior rendimento, e o maior
 * do contrário. Lado sem faixa usa o valor pontual. null se nenhum dos dois
 * tem faixa (não há incerteza cadastrada para mostrar).
 *
 * Faixa que não contém o próprio valor é ignorada: acontece quando o
 * laboratório cadastra o laudo e deixa a faixa da referência genérica (ex.:
 * laudo 54,3% com faixa 48,6–52) — a faixa antiga não descreve o laudo.
 */
export function faixaConsumo(
  densidade: number | null,
  densMin: number | null,
  densMax: number | null,
  rendimento: number | null,
  rendMin: number | null,
  rendMax: number | null,
): { min: number; max: number } | null {
  const contem = (v: number | null, lo: number | null, hi: number | null) =>
    v != null && lo != null && hi != null && lo <= v && v <= hi;
  const temFaixaDens = contem(densidade, densMin, densMax);
  const temFaixaRend = contem(rendimento, rendMin, rendMax);
  if (!temFaixaDens && !temFaixaRend) return null;
  const dLo = temFaixaDens ? densMin : densidade;
  const dHi = temFaixaDens ? densMax : densidade;
  const rLo = temFaixaRend ? rendMin : rendimento;
  const rHi = temFaixaRend ? rendMax : rendimento;
  const min = consumoEspecifico(dHi, rHi);
  const max = consumoEspecifico(dLo, rLo);
  return min != null && max != null ? { min, max } : null;
}

const CONFIANCA: Record<TipoDado, number> = { laboratorio: 3, literatura: 2, referencia_generica: 1 };

/**
 * Proveniência de um número calculado a partir de outros: vale a MENOS
 * confiável das entradas (laudo × referência genérica = referência
 * genérica). Entrada sem proveniência → resultado sem proveniência.
 */
export function origemCombinada(...tipos: (TipoDado | null)[]): TipoDado | null {
  let pior: TipoDado | null = null;
  for (const t of tipos) {
    if (t == null || !(t in CONFIANCA)) return null;
    if (pior == null || CONFIANCA[t] < CONFIANCA[pior]) pior = t;
  }
  return pior;
}
