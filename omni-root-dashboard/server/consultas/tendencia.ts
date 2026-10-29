// ALERTA DE TENDÊNCIA — o "supervisor no bolso".
//
// Uma tora ruim é ruído; várias seguidas na MESMA máquina são um problema
// que alguém precisa resolver agora (faca do descascador gasta, cabeçote
// desregulado, trecho de madeira torta). Aqui, para cada máquina, olhamos as
// últimas N toras recentes e acusamos quando a maioria passa do limite
// crítico — os mesmos limites do mapa (LIMITES em mapa.ts).
//
// "Recente" é medido pelo relógio DESTE servidor, não pelo now() do Postgres:
// data_inspecao é hora local da máquina (timestamp sem fuso) e o banco pode
// estar em UTC (Docker) — comparar com now() deslocaria a janela em 3 h.
import { pool } from '../db.js';
import { LIMITES, SEM_LUZ_CRITICA, type Metrica } from './mapa.js';

const ULTIMAS = 5; // toras avaliadas por máquina
const MINIMO_ACIMA = 3; // quantas delas precisam passar do limite
const JANELA_MIN = 120; // só toras dos últimos 120 min contam como "agora"

export interface AlertaTendencia {
  chave: string; // estável enquanto o problema durar: maquina + indicador
  maquina: string | null;
  metrica: Metrica;
  acima: number; // quantas das avaliadas passaram do limite
  de: number; // quantas foram avaliadas
  media: number | null; // média do indicador nas avaliadas (%)
  limite: number;
  ultima: string; // data da tora mais recente da máquina
  texto: string; // frase pronta (tela e voz)
}

function horaLocalIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const fmt = (v: number) => Math.round(v).toString();

export async function getTendencia(maquinaId: number | null): Promise<AlertaTendencia[]> {
  const desde = horaLocalIso(new Date(Date.now() - JANELA_MIN * 60_000));
  const { rows } = await pool.query(
    `WITH ult AS (
       SELECT t.id, t.maquina_id, t.data_inspecao, t.status_classificacao,
              ROW_NUMBER() OVER (PARTITION BY t.maquina_id ORDER BY t.data_inspecao DESC, t.id DESC) AS rn
       FROM toras_inspecionadas t
       WHERE t.data_inspecao >= $1::timestamp
         AND ($2::int IS NULL OR t.maquina_id = $2::int)
     ),
     p AS (
       SELECT u.id, u.maquina_id, u.data_inspecao, u.status_classificacao,
              -- Medida em luz crítica não conta para tendência de casca/tortuosidade
              -- (baixa confiança): ruído noturno não pode mandar o supervisor
              -- regular uma faca que está boa. A rejeição (status) conta sempre.
              MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'porcentagem_casca'
                                     AND ${SEM_LUZ_CRITICA})::float AS casca,
              MAX(i.valor) FILTER (WHERE i.tipo_indicador = 'tortuosidade'
                                     AND i.metodo_medicao LIKE 'opencv%'
                                     AND ${SEM_LUZ_CRITICA})::float AS tort
       FROM ult u
       LEFT JOIN indicadores_qualidade i ON i.tora_id = u.id
       WHERE u.rn <= $3
       GROUP BY u.id, u.maquina_id, u.data_inspecao, u.status_classificacao
     )
     SELECT m.numero_serie AS maquina, p.maquina_id,
            COUNT(*)::int AS n,
            COUNT(casca)::int AS casca_n,
            COUNT(*) FILTER (WHERE casca > $4)::int AS casca_acima,
            AVG(casca) AS casca_media,
            COUNT(tort)::int AS tort_n,
            COUNT(*) FILTER (WHERE tort >= $5)::int AS tort_acima,
            AVG(tort) AS tort_media,
            COUNT(*) FILTER (WHERE status_classificacao IN ('reprovado','quarentena'))::int AS falhas,
            to_char(MAX(data_inspecao), 'YYYY-MM-DD"T"HH24:MI:SS') AS ultima
     FROM p LEFT JOIN maquinas m ON m.id_maquina = p.maquina_id
     GROUP BY m.numero_serie, p.maquina_id`,
    [desde, maquinaId, ULTIMAS, LIMITES.casca[1], LIMITES.tort[1]],
  );

  const out: AlertaTendencia[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const maquina = (r.maquina as string | null) ?? null;
    const nome = maquina ?? `máquina ${r.maquina_id as number}`;
    const ultima = r.ultima as string;
    const num = (x: unknown) => (x == null ? null : Number(x));

    const cascaN = r.casca_n as number;
    const cascaAcima = r.casca_acima as number;
    if (cascaN >= MINIMO_ACIMA && cascaAcima >= MINIMO_ACIMA) {
      const media = num(r.casca_media);
      out.push({
        chave: `${nome}|casca`,
        maquina,
        metrica: 'casca',
        acima: cascaAcima,
        de: cascaN,
        media,
        limite: LIMITES.casca[1],
        ultima,
        texto:
          `${nome}: casca acima de ${LIMITES.casca[1]}% em ${cascaAcima} das últimas ${cascaN} toras` +
          (media != null ? ` (média ${fmt(media)}%)` : '') +
          '. Verificar as facas e os rolos do descascador.',
      });
    }

    const tortN = r.tort_n as number;
    const tortAcima = r.tort_acima as number;
    if (tortN >= MINIMO_ACIMA && tortAcima >= MINIMO_ACIMA) {
      const media = num(r.tort_media);
      out.push({
        chave: `${nome}|tort`,
        maquina,
        metrica: 'tort',
        acima: tortAcima,
        de: tortN,
        media,
        limite: LIMITES.tort[1],
        ultima,
        texto:
          `${nome}: tortuosidade de ${LIMITES.tort[1]}% ou mais em ${tortAcima} das últimas ${tortN} toras vistas de lado` +
          (media != null ? ` (média ${fmt(media)}%)` : '') +
          '. Madeira torta neste trecho: separar o destino e avisar o pátio.',
      });
    }

    const n = r.n as number;
    const falhas = r.falhas as number;
    if (n >= MINIMO_ACIMA && falhas >= MINIMO_ACIMA) {
      out.push({
        chave: `${nome}|falhas`,
        maquina,
        metrica: 'falhas',
        acima: falhas,
        de: n,
        media: (100 * falhas) / n,
        limite: LIMITES.falhas[1],
        ultima,
        texto: `${nome}: ${falhas} das últimas ${n} toras rejeitadas ou em contenção. Inspecionar a máquina e o trecho.`,
      });
    }
  }
  return out;
}
