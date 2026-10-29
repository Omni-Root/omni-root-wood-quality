import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { SummaryRow } from '../types';
import { STATUS_META, STATUS_ORDER } from '../types';
import { useThemeTokens } from '../hooks/useThemeTokens';

const fmt = new Intl.NumberFormat('pt-BR');

export default function ProportionDonut({ rows }: { rows: SummaryRow[] }) {
  const tokens = useThemeTokens();
  const byStatus = new Map(rows.map((r) => [r.status, r.total]));
  const data = STATUS_ORDER.map((s) => ({
    status: s,
    name: STATUS_META[s].label,
    value: byStatus.get(s) ?? 0,
  })).filter((d) => d.value > 0);

  if (data.length === 0) {
    return <div className="empty">Sem dados no período selecionado.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
          stroke={tokens.surface}
          strokeWidth={2}
        >
          {data.map((d) => (
            <Cell key={d.status} fill={tokens.status[d.status]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => fmt.format(value)}
          contentStyle={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
          }}
          // No PieChart o Recharts pinta o texto do item com a cor padrão
          // (preta), ignorando `color` do contentStyle — no tema escuro o
          // "Contenção : 24" sumia. itemStyle é o que vale para o item.
          itemStyle={{ color: tokens.textPrimary, fontWeight: 600 }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => (
            <span style={{ color: tokens.textSecondary }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
