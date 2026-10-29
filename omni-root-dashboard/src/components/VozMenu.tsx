import { useEffect, useRef, useState } from 'react';
import type { Anunciar, Voz } from '../voz';

// Botão 🔊 no cabeçalho com o painel de preferências da narração. Mesma
// mecânica do menu Exportar (clique fora / Esc fecham). O botão em si é o
// liga/desliga rápido; o ▾ abre as opções.
const ANUNCIAR: { valor: Anunciar; rotulo: string; dica: string }[] = [
  { valor: 'falhas', rotulo: 'Só contenção e rejeitadas', dica: 'Recomendado: fala só o que exige ação' },
  { valor: 'todas', rotulo: 'Todas as inspeções', dica: 'Útil na demonstração' },
  { valor: 'nenhuma', rotulo: 'Nenhuma', dica: 'Só os botões "Ler"' },
];

export default function VozMenu({ voz }: { voz: Voz }) {
  const [open, setOpen] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setOpen(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [open]);

  if (!voz.suportado) {
    return (
      <button type="button" className="btn voz-btn" disabled title="Este navegador não tem síntese de voz">
        <span aria-hidden="true">🔇</span>
        <span className="sr-only">Narração indisponível</span>
      </button>
    );
  }

  const { prefs } = voz;

  return (
    <div className="voz-menu" ref={raiz}>
      <div className="voz-split">
        <button
          type="button"
          className={`btn voz-btn${prefs.ativo ? ' voz-on' : ''}${voz.falando ? ' voz-falando' : ''}`}
          aria-pressed={prefs.ativo}
          onClick={() => {
            const ativo = !prefs.ativo;
            voz.setPrefs({ ativo });
            if (ativo) voz.falar('Narração ligada.', { forcar: true });
            else voz.parar();
          }}
          title={prefs.ativo ? 'Narração ligada — clique para desligar' : 'Narração desligada — clique para ligar'}
        >
          <span aria-hidden="true">{prefs.ativo ? '🔊' : '🔇'}</span>
          <span className="sr-only">{prefs.ativo ? 'Desligar narração' : 'Ligar narração'}</span>
        </button>
        <button
          type="button"
          className="btn voz-caret"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          title="Opções de narração"
        >
          <span aria-hidden="true">▾</span>
          <span className="sr-only">Opções de narração</span>
        </button>
      </div>

      {open && (
        <div className="voz-dropdown" role="dialog" aria-label="Opções de narração">
          <div className="voz-titulo">Narração (texto para voz)</div>
          <p className="voz-sub">
            Anuncia em voz alta as inspeções que chegam do campo e lê os painéis sob demanda. Tudo o que é
            falado também vai para o leitor de tela.
          </p>

          <fieldset className="voz-grupo">
            <legend>Anunciar automaticamente</legend>
            {ANUNCIAR.map((o) => (
              <label key={o.valor} className="voz-opcao">
                <input
                  type="radio"
                  name="anunciar"
                  value={o.valor}
                  checked={prefs.anunciar === o.valor}
                  onChange={() => voz.setPrefs({ anunciar: o.valor })}
                />
                <span>
                  {o.rotulo}
                  <small>{o.dica}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="voz-campo">
            <span>Voz</span>
            <select
              value={prefs.vozURI ?? ''}
              onChange={(e) => voz.setPrefs({ vozURI: e.target.value || null })}
              disabled={voz.vozes.length === 0}
            >
              <option value="">Automática (melhor pt-BR)</option>
              {voz.vozes.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </label>

          <label className="voz-campo">
            <span>
              Velocidade <output>{prefs.taxa.toFixed(1)}×</output>
            </span>
            <input
              type="range"
              min={0.7}
              max={1.4}
              step={0.1}
              value={prefs.taxa}
              onChange={(e) => voz.setPrefs({ taxa: Number(e.target.value) })}
            />
          </label>

          <div className="voz-acoes">
            <button
              type="button"
              className="btn"
              onClick={() =>
                voz.falar('Tora rejeitada às 15 e 42 na máquina de teste. 1 defeito: nó morto. Diâmetro 17,8 centímetros e casca residual 11,6 por cento.', { forcar: true })
              }
            >
              Testar voz
            </button>
            {voz.falando && (
              <button type="button" className="btn" onClick={voz.parar}>
                Parar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Região aria-live: leitores de tela anunciam o texto assim que ele muda, com
 * ou sem síntese de voz. Fica fora do fluxo visual (sr-only).
 */
export function Narrador({ texto }: { texto: string }) {
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {texto}
    </div>
  );
}
