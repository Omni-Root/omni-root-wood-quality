import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Bucket, TimeseriesPoint } from '../types';
import { STATUS_META, STATUS_ORDER } from '../types';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { useEscalaTexto } from '../tamanhoTexto';

// buckets chegam como "YYYY-MM-DDTHH:mm:ss" (hora local do evento) — formata
// por fatia de string para não envolver fuso horário do navegador.
function formatBucket(b: string, bucket: Bucket): string {
  const dayPart = `${b.slice(8, 10)}/${b.slice(5, 7)}`;
  if (bucket === 'minute') return b.slice(11, 16); // só HH:MM: o dia é o mesmo na prática
  return bucket === 'hour' ? `${dayPart} ${b.slice(11, 16)}` : dayPart;
}

// Soma corrente por classificação: a linha só sobe.
function acumular(data: TimeseriesPoint[]): TimeseriesPoint[] {
  let a = 0, q = 0, r = 0;
  return data.map((p) => {
    a += p.aprovado; q += p.quarentena; r += p.reprovado;
    return { bucket: p.bucket, aprovado: a, quarentena: q, reprovado: r };
  });
}

export default function TimeSeriesChart({
  data: bruto,
  bucket,
  acumulado = false,
}: {
  data: TimeseriesPoint[];
  bucket: Bucket;
  acumulado?: boolean;
}) {
  const tokens = useThemeTokens();
  const fonteEixo = 11 * useEscalaTexto(); // acompanha o A− / A+ do cabeçalho
  const data = acumulado ? acumular(bruto) : bruto;

  if (data.length === 0) {
    return <div className="empty">Sem dados no período selecionado.</div>;
  }

  // Linha precisa de >= 2 pontos para aparecer: com um único bucket (todo o
  // período num mesmo dia, por exemplo) o gráfico parecia vazio. Poucos
  // buckets => desenha os pontos; um só => sugere a granularidade menor.
  const poucos = data.length <= 3;
  const dica =
    data.length === 1 && bucket !== 'minute'
      ? `Todas as inspeções do período caem num único intervalo — troque para "${bucket === 'hour' ? 'Por minuto' : 'Por hora'}" para ver a evolução.`
      : null;

  return (
    <>
    {dica && <p className="chart-hint">{dica}</p>}
    <ResponsiveContainer width="100%" height={dica ? 236 : 260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={tokens.grid} vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={(b: string) => formatBucket(b, bucket)}
          tick={{ fill: tokens.muted, fontSize: fonteEixo }}
          stroke={tokens.axis}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: tokens.muted, fontSize: fonteEixo }}
          stroke="transparent"
          tickLine={false}
        />
        <Tooltip
          labelFormatter={(b: string) => formatBucket(b, bucket)}
          contentStyle={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            color: tokens.textSecondary,
          }}
        />
        <Legend
          iconType="plainline"
          formatter={(value: string) => (
            <span style={{ color: tokens.textSecondary }}>{value}</span>
          )}
        />
        {STATUS_ORDER.map((s) => (
          <Line
            key={s}
            type="monotone"
            dataKey={s}
            name={STATUS_META[s].label}
            stroke={tokens.status[s]}
            strokeWidth={2}
            dot={poucos ? { r: 4, strokeWidth: 0, fill: tokens.status[s] } : false}
            activeDot={{ r: 4, stroke: tokens.surface, strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
    </>
  );
}
