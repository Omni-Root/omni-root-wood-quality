// Filtros comuns a todas as consultas: período [from, to] (inclusivo, em
// dias) e máquina opcional — e os fragmentos SQL que os aplicam.

// Todas as consultas são parametrizadas e agregam NO BANCO — nunca trazem a
// tabela de eventos inteira. O intervalo é [from, to] inclusivo em dias:
// data_inspecao >= from::date AND data_inspecao < to::date + 1 dia.
export const RANGE_WHERE = `
  data_inspecao >= $1::date
  AND data_inspecao < $2::date + INTERVAL '1 day'
  AND ($3::int IS NULL OR maquina_id = $3::int)
`;

// Mesma janela de RANGE_WHERE, mas com as tabelas apelidadas ("t." etc.)
// porque as exportações fazem JOIN com máquinas/talhões.
export const RANGE_WHERE_T = `
  t.data_inspecao >= $1::date
  AND t.data_inspecao < $2::date + INTERVAL '1 day'
  AND ($3::int IS NULL OR t.maquina_id = $3::int)
`;

export interface Filters {
  from: string;
  to: string;
  maquinaId: number | null;
}
