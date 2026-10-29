import { isoDaysAgo } from '../datas';
import type { Filters, Maquina } from '../types';

const PRESETS = [
  { label: 'Hoje', days: 0 },
  { label: '7 dias', days: 6 },
  { label: '30 dias', days: 29 },
  { label: '90 dias', days: 89 },
];

export default function FiltersBar({
  filters,
  maquinas,
  onChange,
}: {
  filters: Filters;
  maquinas: Maquina[];
  onChange: (f: Filters) => void;
}) {
  const today = isoDaysAgo(0);

  return (
    <div className="filters">
      <div className="presets" role="group" aria-label="Períodos predefinidos">
        {PRESETS.map((p) => {
          const from = isoDaysAgo(p.days);
          const active = filters.from === from && filters.to === today;
          return (
            <button
              key={p.label}
              type="button"
              className={active ? 'active' : ''}
              onClick={() => onChange({ ...filters, from, to: today })}
            >
              {active ? '✓ ' : ''}
              {p.label}
            </button>
          );
        })}
      </div>
      <label>
        De
        <input
          type="date"
          value={filters.from}
          max={filters.to}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
        />
      </label>
      <label>
        Até
        <input
          type="date"
          value={filters.to}
          min={filters.from}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
        />
      </label>
      <label>
        Máquina
        <select
          value={filters.maquinaId}
          onChange={(e) => onChange({ ...filters, maquinaId: e.target.value })}
        >
          <option value="">Todas</option>
          {maquinas.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.modelo} — {m.numero_serie}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
