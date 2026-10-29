import pg from 'pg';

// Pool de leitura. `default_transaction_read_only=on` faz o Postgres rejeitar
// qualquer escrita nesta conexão, mesmo que um bug tente uma — o dashboard é
// somente leitura por contrato E por configuração.
export const pool = new pg.Pool({
  host: process.env.PG_HOST ?? 'localhost',
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DBNAME ?? 'desafio_madeira',
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c default_transaction_read_only=on',
  max: 5,
  connectionTimeoutMillis: 5_000,
});

// Quando o Postgres cai (ou é reiniciado), os clientes OCIOSOS do pool
// emitem 'error'. Sem este handler o Node encerra o processo inteiro
// ("Unhandled 'error' event") — e aí nem o login, que não usa banco,
// responde mais. Com ele, o pool descarta o cliente morto e reconecta na
// próxima consulta; o painel mostra "sem banco" e volta sozinho.
pool.on('error', (err) => {
  console.warn('[db] conexão ociosa do pool caiu (Postgres fora?):', err.message);
});

// Pool das CONTAS (tabela usuarios): a única coisa que o dashboard escreve.
// Usa um papel Postgres próprio (PG_CONTAS_USER, membro de omniroot_contas —
// ver PARTE 6 do setup_completo.sql) que só tem permissão nessa tabela: nem
// um bug aqui consegue alterar uma tora. Sem PG_CONTAS_USER, cai no PG_USER
// (prático em desenvolvimento, mas perde essa garantia — avisa no console).
const contasUser = process.env.PG_CONTAS_USER?.trim();
if (!contasUser) {
  console.warn(
    '[db] PG_CONTAS_USER não definido no .env — as contas usam o PG_USER. ' +
      'Em produção, crie o papel restrito (setup_completo.sql, PARTE 6).',
  );
}
export const poolContas = new pg.Pool({
  host: process.env.PG_HOST ?? 'localhost',
  port: Number(process.env.PG_PORT ?? 5432),
  user: contasUser || (process.env.PG_USER ?? 'postgres'),
  password: contasUser ? process.env.PG_CONTAS_PASSWORD : process.env.PG_PASSWORD,
  database: process.env.PG_DBNAME ?? 'desafio_madeira',
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 3,
  connectionTimeoutMillis: 5_000,
});

poolContas.on('error', (err) => {
  console.warn('[db] conexão ociosa do pool de contas caiu (Postgres fora?):', err.message);
});
