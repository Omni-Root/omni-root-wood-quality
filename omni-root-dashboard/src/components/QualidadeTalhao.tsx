import type { QualidadeTalhao as Linha } from '../types';
import { TIPO_DADO_META } from '../types';

// Tabela "qualidade por talhão / clone": é a frase do enunciado ("maior
// previsibilidade para a fábrica") em números — casca média, tortuosidade,
// volume e massa seca prevista por talhão, com a proveniência da densidade
// que gerou a massa e, quando o clone tem faixa cadastrada, o intervalo.
// Embaixo (PrevisaoFabrica), a mesma madeira na unidade da fábrica de
// celulose: celulose prevista e consumo específico (m³ por t seca ao ar).

const num = (v: number | null, casas = 1) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : '—');

export default function QualidadeTalhao({ rows }: { rows: Linha[] }) {
  if (rows.length === 0) {
    return <div className="empty">Sem indicadores de qualidade no período selecionado.</div>;
  }
  return (
    <div className="tabela-wrap">
      <table className="tabela">
        <thead>
          <tr>
            <th>Talhão</th>
            <th>Clone</th>
            <th className="num">Toras</th>
            <th className="num">Falhas</th>
            <th className="num" title="Diâmetro médio medido pela câmera">Diâm. médio</th>
            <th className="num" title="% média da superfície ainda com casca">Casca média</th>
            <th className="num" title="Média só das toras vistas de lado (flecha/comprimento)">Tortuosidade</th>
            <th className="num" title="Soma do volume útil medido">Volume</th>
            <th className="num" title="Densidade básica de referência do clone e sua proveniência">Densidade</th>
            <th className="num" title="Volume × densidade de referência; faixa = volume × densidade mín./máx.">Massa seca prevista</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const tipo = r.tipo_dado ? TIPO_DADO_META[r.tipo_dado] : null;
            const temFaixa = r.massa_min_kg != null && r.massa_max_kg != null;
            return (
              <tr key={`${r.talhao ?? ''}|${r.clone ?? ''}|${i}`}>
                <td>{r.talhao ?? '—'}</td>
                <td>{r.clone ?? '—'}</td>
                <td className="num">{r.toras}</td>
                <td className="num">
                  {r.falhas} <span className="muted">({pct(r.falhas, r.toras)})</span>
                </td>
                <td className="num">{num(r.diam_medio)} cm</td>
                <td className="num">{num(r.casca_media)}%</td>
                <td className="num">
                  {r.tort_n > 0 ? (
                    <>
                      {num(r.tort_media)}% <span className="muted">({r.tort_n})</span>
                    </>
                  ) : (
                    <span className="muted" title="Nenhuma tora vista de lado no período">n/a</span>
                  )}
                </td>
                <td className="num">{num(r.volume_m3, 3)} m³</td>
                <td className="num">
                  {num(r.densidade, 0)} kg/m³
                  {tipo && (
                    <span className="tile-tag" title={tipo.hint}>
                      {tipo.label}
                    </span>
                  )}
                </td>
                <td className="num">
                  <strong>{num(r.massa_kg)} kg</strong>
                  {temFaixa && (
                    <div className="muted" title="Incerteza herdada da faixa de densidade do clone">
                      {num(r.massa_min_kg)}–{num(r.massa_max_kg)} kg
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// A conta fica à vista, coluna a coluna: volume medido × densidade do clone ×
// rendimento do clone = celulose; consumo = 0,9 / (densidade × rendimento).
// Cada referência leva a sua proveniência, e o consumo herda a menos
// confiável das duas (laudo × referência genérica = referência genérica).
export function PrevisaoFabrica({ rows }: { rows: Linha[] }) {
  if (rows.length === 0) return null; // a tabela de cima já diz que não há dados
  const comConsumo = rows.filter((r) => r.consumo_m3_tsa != null);
  return (
    <div className="previsao-fabrica">
      <h3 className="previsao-titulo">Previsão para a fábrica de celulose</h3>
      {comConsumo.length === 0 ? (
        <div className="empty">
          Sem rendimento depurado cadastrado para os clones do período — cadastre na tabela clones_densidade do banco
          central.
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Talhão</th>
                <th>Clone</th>
                <th className="num" title="Soma do volume útil medido pela câmera">
                  Volume
                </th>
                <th className="num" title="Densidade básica de referência do clone">
                  Densidade
                </th>
                <th className="num" title="Rendimento depurado da polpação kraft do clone (base madeira seca)">
                  Rendimento
                </th>
                <th
                  className="num"
                  title="Massa seca prevista × rendimento ÷ 0,9 (tonelada seca ao ar, 10% de umidade)"
                >
                  Celulose prevista
                </th>
                <th className="num" title="0,9 ÷ (densidade em t/m³ × rendimento) — Foelkel (2017)">
                  Consumo específico
                </th>
              </tr>
            </thead>
            <tbody>
              {comConsumo.map((r, i) => {
                const tipoDens = r.tipo_dado ? TIPO_DADO_META[r.tipo_dado] : null;
                const tipoRend = r.rendimento_tipo_dado ? TIPO_DADO_META[r.rendimento_tipo_dado] : null;
                const tipoCons = r.consumo_tipo_dado ? TIPO_DADO_META[r.consumo_tipo_dado] : null;
                const temFaixa = r.consumo_min != null && r.consumo_max != null;
                return (
                  <tr key={`${r.talhao ?? ''}|${r.clone ?? ''}|${i}`}>
                    <td>{r.talhao ?? '—'}</td>
                    <td>{r.clone ?? '—'}</td>
                    <td className="num">{num(r.volume_m3, 3)} m³</td>
                    <td className="num">
                      {num(r.densidade, 0)} kg/m³
                      {tipoDens && (
                        <span className="tile-tag" title={tipoDens.hint}>
                          {tipoDens.label}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {num(r.rendimento)}%
                      {tipoRend && (
                        <span className="tile-tag" title={r.rendimento_fonte ?? tipoRend.label}>
                          {tipoRend.label}
                        </span>
                      )}
                    </td>
                    <td className="num">{num(r.celulose_t, 2)} tsa</td>
                    <td className="num">
                      <strong>{num(r.consumo_m3_tsa, 2)} m³/tsa</strong>
                      {tipoCons && (
                        <span className="tile-tag" title="Herda a origem menos confiável entre densidade e rendimento">
                          {tipoCons.label}
                        </span>
                      )}
                      {temFaixa && (
                        <div className="muted" title="Incerteza herdada das faixas de densidade e rendimento do clone">
                          {num(r.consumo_min, 2)}–{num(r.consumo_max, 2)} m³/tsa
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="previsao-nota">
        Consumo específico teórico = 0,9 ÷ (densidade básica × rendimento depurado), em m³ de madeira sem casca por
        tonelada seca ao ar (Foelkel, 2017). Não inclui perdas de descascamento, picagem e fibras: o consumo industrial
        das fábricas de eucalipto fica em 3,4–3,9 m³/tsa (benchmark ABTCP).
      </p>
    </div>
  );
}
