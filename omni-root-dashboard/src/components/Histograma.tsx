import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Faixa } from '../types';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { useEscalaTexto } from '../tamanhoTexto';

// Histograma de UMA série (contagem de toras por faixa). Uma matiz só — é
// magnitude, não identidade — e a matiz é a mesma rampa azul do mapa de
// calor. Sem legenda: o título do painel nomeia a série.
//
// A cor vai como valor computado porque o Recharts a recebe como atributo
// SVG (var(--x) não resolve lá): é o token --accent (verde JD), lido pelo
// useThemeTokens, que muda junto com o tema.

export default function Histograma({ data, unidade }: { data: Faixa[]; unidade: string }) {
  const tokens = useThemeTokens();
  const fonteEixo = 11 * useEscalaTexto(); // acompanha o A− / A+ do cabeçalho
  const total = data.reduce((a, d) => a + d.total, 0);

  if (total === 0) {
    return <div className="empty">Sem toras com essa medida no período.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barCategoryGap="22%">
        <CartesianGrid stroke={tokens.grid} vertical={false} />
        <XAxis
          dataKey="faixa"
          tick={{ fill: tokens.muted, fontSize: fonteEixo }}
          stroke={tokens.axis}
          tickLine={false}
          interval={0}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: tokens.muted, fontSize: fonteEixo }}
          stroke="transparent"
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: tokens.grid, opacity: 0.5 }}
          formatter={(value: number) => [
            `${value} ${value === 1 ? 'tora' : 'toras'} (${((value / total) * 100).toFixed(0)}%)`,
            unidade,
          ]}
          contentStyle={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            color: tokens.textSecondary,
          }}
        />
        <Bar dataKey="total" fill={tokens.accent} radius={[4, 4, 0, 0]} maxBarSize={56} />
      </BarChart>
    </ResponsiveContainer>
  );
}
