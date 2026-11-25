#!/bin/sh
# Cria (ou atualiza a senha de) o login Postgres restrito do dashboard:
# PG_CONTAS_USER, membro de omniroot_contas (só lê/escreve as tabelas
# usuarios e configuracoes — ver PARTE 6 do setup_completo.sql).
#
# Roda sozinho na primeira subida do docker compose (depois do 01_setup.sql)
# e pode ser rodado de novo a qualquer momento (idempotente):
#   docker compose exec postgres /docker-entrypoint-initdb.d/02_papeis.sh
#
# Usuário e senha vêm do .env (repassados pelo docker-compose.yml) e
# precisam ser os mesmos do .env do dashboard.
set -eu

if [ -z "${PG_CONTAS_USER:-}" ] || [ -z "${PG_CONTAS_PASSWORD:-}" ]; then
    echo "02_papeis: PG_CONTAS_USER/PG_CONTAS_PASSWORD vazios no .env — login restrito NÃO criado" \
         "(o dashboard vai usar o PG_USER)."
else
    psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-desafio_madeira}" \
         -v usuario="$PG_CONTAS_USER" -v senha="$PG_CONTAS_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN IN ROLE omniroot_contas', :'usuario')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'usuario') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'usuario', :'senha') \gexec
SELECT format('GRANT omniroot_contas TO %I', :'usuario') \gexec
SQL
    echo "02_papeis: login restrito '$PG_CONTAS_USER' pronto."
fi
