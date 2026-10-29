import type { UltimaInspecao as Ultima } from '../types';
import { FONTE_POSICAO_META, STATUS_META, TIPO_DADO_META } from '../types';

// Cartão "última inspeção": a tora mais recente que chegou do campo, com os
// indicadores que o desafio pede (diâmetro, casca, tortuosidade, densidade,
// massa seca). Atualiza sozinho via SSE — quando uma peça é inspecionada na
// máquina, o número aparece aqui em segundos, sem F5. É o momento da demo.
//
// Regras de apresentação:
//   - o que é MEDIDO (câmera) e o que é ESTIMADO (densidade de referência)
//     ficam explícitos — massa seca herda a incerteza da densidade;
//   - tortuosidade e comprimento só existem na vista lateral; na seção o
//     cartão diz "n/a" em vez de mostrar 0;
//   - a proveniência da densidade (laboratório / literatura / referência)
//     aparece ao lado do valor.

const num = (v: number | null, casas = 1) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function fmtHora(iso: string): string {
  // "2026-09-15T19:50:09" -> "15/09 19:50:09" (hora local da máquina, sem fuso)
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 19)}`;
}

export default function UltimaInspecao({ u }: { u: Ultima | null }) {
  if (!u) {
    return <div className="empty">Nenhuma inspeção recebida do campo ainda.</div>;
  }
  const meta = STATUS_META[u.status];
  const tipo = u.densidade.tipo_dado ? TIPO_DADO_META[u.densidade.tipo_dado] : null;
  const temFaixa = u.massa_min_kg != null && u.massa_max_kg != null;
  // Tortuosidade: decide pelo próprio indicador (null = não foi medida), não
  // pela vista predominante — no modo evento uma tora pode ter vista
  // predominante "seção" e ainda assim frames laterais com medida.
  const tortMedida = u.tortuosidade != null;

  return (
    // `key={u.id}` remonta o bloco a cada tora nova: é o que dispara a
    // animação de destaque (ver .ultima-flash no CSS).
    <div className="ultima" key={u.id}>
      <div className="ultima-head">
        <span className="ultima-status" style={{ color: meta.cssVar }}>
          <span className="dot" data-icone={meta.icone} style={{ background: meta.cssVar }} />
          {meta.label}
        </span>
        <span className="ultima-meta">
          {fmtHora(u.data)}
          {u.maquina_serie && ` · ${u.maquina_serie}`}
          {u.talhao_nome && ` · ${u.talhao_nome}`}
          {u.densidade.clone && ` · clone ${u.densidade.clone}`}
          {` · vista ${u.vista === 'secao' ? 'seção' : u.vista === 'lateral' ? 'lateral' : '—'}`}
          {u.luz !== 'boa' && (
            <span
              className={`tile-tag${u.luz === 'critica' ? ' tag-luz-critica' : ''}`}
              title={
                u.luz === 'critica'
                  ? 'Medida em luz crítica: baixa confiança (não entra nos alertas). Ilumine a tora.'
                  : 'Medida em luz baixa, com realce de imagem (empilhamento de quadros + ganho).'
              }
            >
              {u.luz === 'critica' ? 'luz crítica · baixa confiança' : 'luz baixa'}
            </span>
          )}
        </span>
      </div>

      <div className="tiles">
        <Tile label="Diâmetro" value={num(u.diametro_cm)} unit="cm" hint="medido pela câmera (escala ArUco / calibração)" />
        <Tile
          label="Comprimento"
          value={num(u.comprimento_cm, 0)}
          unit="cm"
          hint={u.comprimento_medido ? 'medido na vista lateral' : 'comprimento de traçamento do talhão (não visível na seção)'}
          estimado={!u.comprimento_medido}
        />
        <Tile
          label="Casca residual"
          value={num(u.casca_pct)}
          unit="%"
          hint="% da superfície ainda com casca (Otsu dentro do contorno)"
        />
        <Tile
          label="Tortuosidade"
          value={tortMedida ? num(u.tortuosidade) : 'n/a'}
          unit={tortMedida ? '%' : ''}
          hint={tortMedida ? 'flecha do eixo / comprimento (vista lateral)' : 'só mensurável na vista lateral'}
        />
        <Tile
          label="Densidade básica"
          value={num(u.densidade.valor, 0)}
          unit="kg/m³"
          hint={tipo ? tipo.hint : 'referência por clone'}
          tag={tipo?.label}
          estimado
        />
        <Tile
          label="Massa seca"
          value={num(u.massa_kg)}
          unit="kg"
          sub={temFaixa ? `faixa ${num(u.massa_min_kg)}–${num(u.massa_max_kg)} kg` : `volume ${num(u.volume_m3, 3)} m³ × densidade`}
          hint={
            temFaixa
              ? 'faixa = volume medido × densidade mín./máx. do clone'
              : 'estimativa: volume medido × densidade de referência (sem faixa cadastrada para o clone)'
          }
          estimado
        />
        <Tile
          label="Defeitos"
          value={String(u.defeitos)}
          unit=""
          sub={u.defeitos_tipos.length ? u.defeitos_tipos.join(', ') : 'nenhum confirmado'}
          hint="detecções do modelo confirmadas pelos filtros"
        />
      </div>

      <div className="ultima-foot">
        <span title="Medido pela câmera">■ medido</span>
        <span title="Estimado a partir de referência de densidade do clone" className="estimado-legenda">
          ▨ estimado
        </span>
        <Posicao u={u} />
        <span className="ultima-log">{u.log_id}</span>
      </div>
    </div>
  );
}

// Posição da máquina no corte, com a proveniência (GNSS x trilha gravada) —
// sem posição, diz isso em vez de esconder.
function Posicao({ u }: { u: Ultima }) {
  const p = u.posicao;
  if (!p) {
    return (
      <span className="ultima-pos muted" title="A máquina gravou esta tora sem posição (sem GNSS ou sem sinal)">
        sem posição
      </span>
    );
  }
  const meta = p.fonte ? FONTE_POSICAO_META[p.fonte] : undefined;
  const precisao = [
    p.precisao_m != null ? `±${Math.round(p.precisao_m)} m` : null,
    p.hdop != null ? `HDOP ${p.hdop.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}` : null,
    p.satelites != null ? `${p.satelites} satélites` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <span
      className="ultima-pos"
      title={`${meta?.hint ?? 'Posição da máquina no corte'}${precisao ? ` — ${precisao}` : ''}`}
    >
      {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
      {p.precisao_m != null && ` ±${Math.round(p.precisao_m)} m`}
      <span className={`tile-tag${p.fonte === 'gnss_log' ? ' tag-demo' : ''}`}>{meta?.label ?? p.fonte ?? 'GNSS'}</span>
    </span>
  );
}

function Tile({
  label,
  value,
  unit,
  hint,
  sub,
  tag,
  estimado = false,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  sub?: string;
  tag?: string;
  estimado?: boolean;
}) {
  return (
    <div className={`tile${estimado ? ' tile-estimado' : ''}`} title={hint}>
      <div className="tile-label">
        {label}
        {tag && <span className="tile-tag">{tag}</span>}
      </div>
      <div className="tile-value">
        {value}
        {unit && <span className="tile-unit"> {unit}</span>}
      </div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}
