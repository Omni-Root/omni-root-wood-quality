import { Fragment } from 'react';
import type { HeatmapCell, Status } from '../types';
import { STATUS_META } from '../types';

// Rampa sequencial azul (uma matiz, claro→escuro); zero recede para o grid.
const RAMP = [
  'var(--seq-1)',
  'var(--seq-2)',
  'var(--seq-3)',
  'var(--seq-4)',
  'var(--seq-5)',
  'var(--seq-6)',
  'var(--seq-7)',
];

const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
// Semana exibida de segunda a domingo (leitura por turno de trabalho).
const DOW_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const TOGGLEABLE: Status[] = ['reprovado', 'quarentena'];

export default function Heatmap({
  cells,
  statuses,
  onStatusesChange,
}: {
  cells: HeatmapCell[];
  statuses: Status[];
  onStatusesChange: (s: Status[]) => void;
}) {
  const counts = new Map(cells.map((c) => [`${c.dow}:${c.hora}`, c.total]));
  const max = cells.reduce((acc, c) => Math.max(acc, c.total), 0);

  function toggle(s: Status) {
    const next = statuses.includes(s)
      ? statuses.filter((x) => x !== s)
      : [...statuses, s];
    if (next.length > 0) onStatusesChange(next); // pelo menos um status ativo
  }

  return (
    <div>
      <div className="hm-toggles">
        {TOGGLEABLE.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={statuses.includes(s)}
              onChange={() => toggle(s)}
            />
            <span className="dot" style={{ background: STATUS_META[s].cssVar, width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
            {STATUS_META[s].label}
          </label>
        ))}
      </div>

      {max === 0 ? (
        <div className="empty">Sem falhas no período selecionado.</div>
      ) : (
        <div className="heatmap-wrap">
          <div className="heatmap" role="img" aria-label="Falhas por dia da semana e hora do dia">
            <span className="hm-corner" />
            {Array.from({ length: 24 }, (_, h) => (
              <span className="hm-hour" key={h}>
                {h % 3 === 0 ? `${h}h` : ''}
              </span>
            ))}
            {DOW_DISPLAY_ORDER.map((dow) => (
              <Fragment key={dow}>
                <span className="hm-dow">{DOW_LABELS[dow]}</span>
                {Array.from({ length: 24 }, (_, h) => {
                  const n = counts.get(`${dow}:${h}`) ?? 0;
                  const color =
                    n === 0
                      ? 'var(--seq-0)'
                      : RAMP[Math.min(RAMP.length - 1, Math.floor((n / max) * RAMP.length))];
                  return (
                    <span
                      key={`${dow}-${h}`}
                      className="hm-cell"
                      style={{ background: color }}
                      title={`${DOW_LABELS[dow]} ${h}h — ${n} ${n === 1 ? 'falha' : 'falhas'}`}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
          <div className="hm-legend">
            <span>0</span>
            <span className="hm-step" style={{ background: 'var(--seq-0)' }} />
            {RAMP.map((c) => (
              <span className="hm-step" key={c} style={{ background: c }} />
            ))}
            <span>{max}</span>
          </div>
        </div>
      )}
    </div>
  );
}
