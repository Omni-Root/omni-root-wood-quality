import { useEffect, useRef, useState } from 'react';
import { api, type EstadoPlateia } from '../api';

// QR code para a plateia abrir o painel no próprio celular, pelo link
// público do túnel (server/plateia.ts). Ele leva à tela de login; não carrega
// segredo, então aparece em dois lugares: no canto da tela de login (antes de
// alguém entrar) e no canto da barra lateral do painel. Os dois ampliam em
// tela cheia — para projetar no telão (no painel, também a tecla Q).

// O túnel leva alguns segundos para subir depois do `npm run dev` (compila o
// painel, conecta), e o servidor só diz "no ar" quando o /api/health responde
// pelo endereço público. Para não assustar ninguém com um vermelho que é só a
// partida, o cartão tem três fases:
//   no_ar       confirmado (ou não dá para saber: sem alarme);
//   conectando  ainda não confirmou, há menos de CARENCIA_MS — tom neutro;
//   fora        sem confirmar há mais que isso — aí sim o aviso vermelho.
// Enquanto não confirma, pergunta a cada 3 s; confirmado, a cada 30 s.
const CARENCIA_MS = 45_000;
const RELER_NO_AR_MS = 30_000;
const RELER_ESPERANDO_MS = 3_000;

export type FaseTunel = 'no_ar' | 'conectando' | 'fora';
export type Plateia = EstadoPlateia & { fase: FaseTunel };

export function usePlateia(ativo: boolean): Plateia | null {
  const [estado, setEstado] = useState<Plateia | null>(null);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let semConfirmarDesde: number | null = null;
    const ler = async () => {
      let proxima = RELER_ESPERANDO_MS;
      try {
        const e = await api.plateia();
        if (!vivo) return;
        let fase: FaseTunel = 'no_ar';
        if (e.noAr === false) {
          semConfirmarDesde ??= Date.now();
          fase = Date.now() - semConfirmarDesde < CARENCIA_MS ? 'conectando' : 'fora';
        } else {
          semConfirmarDesde = null;
          proxima = RELER_NO_AR_MS;
        }
        setEstado({ ...e, fase });
      } catch {
        /* servidor fora: tenta de novo em 3 s */
      }
      if (vivo) timer = setTimeout(() => void ler(), proxima);
    };
    void ler();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [ativo]);
  return estado;
}

function dominio(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function situacao(fase: FaseTunel, dica: string): string {
  if (fase === 'fora') return 'Túnel fora do ar';
  if (fase === 'conectando') return 'Conectando o link…';
  return dica;
}

export function CartaoQr({ estado, onAmpliar }: { estado: Plateia; onAmpliar: () => void }) {
  return (
    <button
      type="button"
      className={`bl-qr ${estado.fase}`}
      onClick={onAmpliar}
      title={`${estado.url} — tecla Q amplia`}
    >
      <img src={api.plateiaQrUrl} alt="" width={64} height={64} />
      <span>
        <strong>Abra no seu celular</strong>
        <span>{situacao(estado.fase, 'Aperte Q para ampliar')}</span>
      </span>
    </button>
  );
}

/** Na tela de login: o QR no canto da vitrine; clique amplia em tela cheia. */
export function QrLogin() {
  const estado = usePlateia(true);
  const [aberto, setAberto] = useState(false);
  if (!estado?.configurado) return null;
  return (
    <>
      <button type="button" className={`lv-qr ${estado.fase}`} onClick={() => setAberto(true)}>
        <img src={api.plateiaQrUrl} alt="" width={72} height={72} />
        <span>
          <strong>Abra no seu celular</strong>
          <span>{situacao(estado.fase, 'Clique para ampliar')}</span>
        </span>
      </button>
      {aberto && <QrTelaCheia estado={estado} onFechar={() => setAberto(false)} teclas />}
    </>
  );
}

export function QrTelaCheia({
  estado,
  onFechar,
  teclas = false,
}: {
  estado: Plateia;
  onFechar: () => void;
  // true fora do painel (tela de login), onde não há os atalhos: Esc e Q fecham aqui.
  teclas?: boolean;
}) {
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    return () => anterior?.focus?.();
  }, []);
  useEffect(() => {
    if (!teclas) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'q') onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [teclas, onFechar]);

  return (
    <div className="qr-fundo" onClick={onFechar}>
      <div
        className="qr-cartao"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="qr-titulo">Acompanhe ao vivo no seu celular</h2>
        <div className="qr-corpo">
          <div className="qr-codigo">
            <img src={api.plateiaQrUrl} alt={`QR code do painel: ${estado.url}`} />
            <p className="qr-url">{dominio(estado.url)}</p>
            {estado.fase === 'fora' ? (
              <p className="qr-aviso">O túnel está fora do ar: o link não abre até ele voltar.</p>
            ) : estado.fase === 'conectando' ? (
              <p className="qr-dica">Conectando o link público… em alguns segundos ele abre.</p>
            ) : null}
          </div>
          {/* Orientações para a plateia: lidas de longe, no telão. */}
          <ol className="qr-passos">
            <li>
              <strong>Desligue o Wi-Fi e use o 4G/5G.</strong> Pelo Wi-Fi do evento, todos saem pelo mesmo endereço e o
              acesso trava.
            </li>
            <li>Aponte a câmera do celular para o código e abra o link.</li>
            {estado.tunel === 'zrok' && (
              <li>
                Se aparecer um aviso do <strong>zrok</strong>, toque para continuar: é o serviço que leva o painel até
                você.
              </li>
            )}
            <li>
              {estado.visitante ? (
                <>
                  Toque em <strong>Entrar como visitante</strong>. Ou use Google ou Microsoft.
                </>
              ) : (
                <>Entre com Google ou Microsoft.</>
              )}
            </li>
            <li>Mantenha a tela acesa: com ela apagada, o painel pausa para economizar dados.</li>
          </ol>
        </div>
        <button ref={fechar} type="button" className="btn" onClick={onFechar}>
          Fechar <kbd>Q</kbd>
        </button>
      </div>
    </div>
  );
}
