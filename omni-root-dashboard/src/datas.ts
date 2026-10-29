// Datas do filtro de período (usadas pelo painel e pela barra de filtros).

// "YYYY-MM-DD" de `days` dias atrás, no RELÓGIO LOCAL. O banco grava
// data_inspecao na hora local da máquina, então o filtro também tem de ser
// local — com toISOString (UTC), depois das 21h em Brasília "Hoje" já seria
// amanhã e o painel ficaria vazio.
export function isoDaysAgo(days: number, agora: Date = new Date()): string {
  const d = new Date(agora);
  d.setDate(d.getDate() - days);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}
