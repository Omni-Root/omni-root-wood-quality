import { useEffect, useState } from 'react';
import { useEconomia } from '../economico';
import type { LiveInfo } from '../hooks/useLive';

function haQuanto(d: Date, agora: number): string {
  const s = Math.max(0, Math.round((agora - d.getTime()) / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)} h`;
}

// Chip "Ao vivo" no cabeçalho: estado da conexão de eventos e quando chegou a
// última inspeção do campo. Cor nunca é o único portador da informação — o
// texto diz o estado.
export default function LiveBadge({ info }: { info: LiveInfo }) {
  const { economico, ritmo } = useEconomia();
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rotulo =
    info.estado === 'ao-vivo' ? 'Ao vivo' : info.estado === 'conectando' ? 'Conectando…' : 'Reconectando…';
  const detalhe = info.ultimaEm
    ? `última inspeção ${haQuanto(info.ultimaEm, agora)}`
    : info.estado === 'ao-vivo'
      ? 'aguardando inspeções'
      : '';
  const titulo = economico
    ? `Pelo link público: com ${ritmo.conectados} celular(es) conectado(s), a última inspeção atualiza a cada ${Math.round(ritmo.ultimaMs / 1000)} s e o resto do painel a cada ${Math.round(ritmo.painelMs / 1000)} s`
    : info.push
      ? 'Avisos empurrados pelo PostgreSQL (LISTEN/NOTIFY) via Server-Sent Events'
      : 'Verificando o banco a cada poucos segundos (trigger de NOTIFY não instalado)';

  return (
    <span className={`live-badge live-${info.estado}`} title={titulo} aria-live="polite">
      <span className="live-dot" aria-hidden="true" />
      <span className="live-label">{rotulo}</span>
      {detalhe && <span className="live-detail">· {detalhe}</span>}
      {economico && info.estado === 'ao-vivo' && (
        <span className="live-detail">· atualiza a cada {Math.round(ritmo.ultimaMs / 1000)} s</span>
      )}
      {info.novas > 0 && (
        <span className="live-count" title="Inspeções recebidas desde que a página abriu">
          +{info.novas}
        </span>
      )}
    </span>
  );
}
