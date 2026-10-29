import type { Status, SummaryRow } from '../types';
import { STATUS_META, STATUS_ORDER } from '../types';
import Icone, { type NomeIcone } from './Icone';

const fmt = new Intl.NumberFormat('pt-BR');
const fmtPct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

const ICONE: Record<Status, NomeIcone> = { aprovado: 'aprovado', quarentena: 'contencao', reprovado: 'rejeitado' };

// Indicadores do período em cartões de fundo tingido (cor do status, que no
// modo daltônico vira azul / laranja / vinho sozinha) com ícone — a cor
// nunca é a única pista: ícone, nome e número sempre juntos.
export default function SummaryCards({ rows }: { rows: SummaryRow[] }) {
  const byStatus = new Map(rows.map((r) => [r.status, r.total]));
  const total = rows.reduce((acc, r) => acc + r.total, 0);

  return (
    <div className="cards">
      <div className="card card-total">
        <span className="card-icone">
          <Icone nome="tora" tamanho={24} />
        </span>
        <div className="card-value">{fmt.format(total)}</div>
        <div className="card-label">Peças inspecionadas</div>
        <div className="card-share">no período selecionado</div>
      </div>
      {STATUS_ORDER.map((s) => {
        const n = byStatus.get(s) ?? 0;
        return (
          <div className={`card card-${s}`} key={s}>
            <span className="card-icone">
              <Icone nome={ICONE[s]} tamanho={24} />
            </span>
            <div className="card-value">{fmt.format(n)}</div>
            <div className="card-label">{STATUS_META[s].label}</div>
            <div className="card-share">{total > 0 ? `${fmtPct.format(n / total)} do total` : '—'}</div>
          </div>
        );
      })}
    </div>
  );
}
