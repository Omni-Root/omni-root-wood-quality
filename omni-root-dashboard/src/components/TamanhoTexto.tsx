import {
  ESCALAS,
  ESCALA_PADRAO,
  aumentarTexto,
  diminuirTexto,
  textoPadrao,
  useEscalaTexto,
} from '../tamanhoTexto';

// A− / 100% / A+ no cabeçalho. O número do meio volta ao padrão.
export default function TamanhoTexto() {
  const escala = useEscalaTexto();
  const pct = Math.round(escala * 100);
  return (
    <div className="tamanho-texto" role="group" aria-label="Tamanho do texto">
      <button
        type="button"
        className="btn"
        onClick={diminuirTexto}
        disabled={escala <= ESCALAS[0]}
        title="Diminuir o texto (tecla −)"
        aria-label="Diminuir o texto"
      >
        A−
      </button>
      <button
        type="button"
        className="btn tamanho-pct"
        onClick={textoPadrao}
        disabled={escala === ESCALA_PADRAO}
        title="Voltar ao tamanho padrão (tecla 0)"
        aria-label={`Tamanho do texto ${pct}%. Voltar ao padrão`}
      >
        {pct}%
      </button>
      <button
        type="button"
        className="btn"
        onClick={aumentarTexto}
        disabled={escala >= ESCALAS[ESCALAS.length - 1]}
        title="Aumentar o texto (tecla +)"
        aria-label="Aumentar o texto"
      >
        A+
      </button>
    </div>
  );
}
