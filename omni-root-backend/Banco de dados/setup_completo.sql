-- ============================================================
-- OMNI-ROOT — SETUP DO POSTGRESQL CENTRAL (arquivo único)
-- Challenge 2026 — FIAP x John Deere / Suzano / Eldorado
-- ============================================================
-- Este é o ÚNICO script do banco central. Roda inteiro, quantas vezes
-- for preciso (idempotente): todo CREATE usa IF NOT EXISTS, todo INSERT
-- é protegido contra duplicata, o trigger é recriado. Rodar de novo num
-- banco com dados não apaga nem duplica nada.
--
-- Ordem (importa: seed depende das tabelas):
--   1. SCHEMA     — tabelas e índices que o sync_daemon.py preenche e o
--                   dashboard lê (inclui o trajeto das máquinas)
--   2. SEED       — máquina + talhão de teste (batem com o config.json)
--   3. CLONES     — tabela clones_densidade + clones da JD: densidade
--                   básica (o sync baixa para a máquina) e rendimento
--                   depurado kraft (o dashboard usa no consumo específico)
--   4. TEMPO REAL — trigger NOTIFY para o dashboard atualizar sozinho
--   5. LIMPEZA    — remove objetos de versões anteriores que nada usa
--   6. USUÁRIOS   — contas do dashboard + papel Postgres que só escreve nelas
--   7. CONFIGURAÇÕES — regras da aplicação que o admin muda sem reiniciar
--
-- O banco LOCAL da máquina (SQLite) tem schema próprio: schema_sqlite.sql.
--
-- ------------------------------------------------------------
-- COMO RODAR
-- ------------------------------------------------------------
-- Docker (primeira subida): o docker-compose.yml monta este arquivo em
-- docker-entrypoint-initdb.d e o Postgres roda sozinho.
--
-- Banco já de pé (aplicar mudanças):
--   PowerShell:
--     cmd /c 'docker compose exec -T postgres psql -U postgres -d desafio_madeira < "Banco de dados\setup_completo.sql"'
--   (NÃO use "Get-Content ... | docker ...": o PowerShell 5.1 troca os acentos
--    por "?" no pipe, e o seed criaria um "Talh?o Demo" duplicado.)
--   Git Bash / Linux / Mac:
--     docker compose exec -T postgres psql -U postgres -d desafio_madeira < "Banco de dados/setup_completo.sql"
--
-- Conferir:
--   SELECT COUNT(*) FROM maquinas;          -- 1
--   SELECT COUNT(*) FROM talhoes;           -- 1
--   SELECT COUNT(*) FROM clones_densidade;  -- 17
--   SELECT COUNT(*) FROM clones_densidade WHERE rendimento_depurado IS NOT NULL;  -- 17
--   SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_notificar_nova_tora', 'trg_notificar_rastro');  -- 2
--   SELECT to_regclass('rastro_maquinas');  -- rastro_maquinas
--   SELECT to_regclass('usuarios');         -- usuarios
--   SELECT COUNT(*) FROM configuracoes;      -- 4
--   SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_name = 'toras_inspecionadas' AND column_name LIKE 'pos\_%';  -- 7
-- ============================================================


-- ============================================================
-- PARTE 1 — SCHEMA
-- ============================================================

-- Máquinas de colheita. numero_serie é a chave que a máquina de campo
-- usa (maquina_id no config.json): o sync resolve o id por ela.
CREATE TABLE IF NOT EXISTS maquinas (
    id_maquina      SERIAL PRIMARY KEY,
    modelo          VARCHAR(100) NOT NULL,
    numero_serie    VARCHAR(100) UNIQUE NOT NULL,
    criado_em       TIMESTAMP NOT NULL DEFAULT now()
);

-- Talhões (áreas de plantio). A máquina grava o nome; o sync resolve o id.
CREATE TABLE IF NOT EXISTS talhoes (
    id_talhao       SERIAL PRIMARY KEY,
    nome            VARCHAR(100) NOT NULL,
    area_hectares   NUMERIC(10,2),
    especie         VARCHAR(100),        -- ex: "Eucalyptus grandis x urophylla"
    criado_em       TIMESTAMP NOT NULL DEFAULT now()
);

-- Uma linha por inspeção sincronizada do campo.
--
-- pos_*: posição da máquina quando a tora foi gravada (GNSS; ver
-- omniroot/posicao.py no repositório da máquina). Tudo NULL = tora sem
-- posição (sem receptor / sem fix) — permitido: ela só não aparece no mapa.
--   pos_fonte: 'gnss_serial'         = GNSS da máquina / receptor em porta serial;
--              'gnss_log'            = trilha NMEA gravada e reproduzida (demonstração;
--                                      o dashboard declara isso na tela);
--              'windows_localizacao' = Localização do Windows (notebook da maquete,
--                                      estimada por Wi-Fi);
--              'linux_geoclue'       = localização do Linux, GeoClue (notebook da
--                                      maquete, estimada por Wi-Fi ou IP).
-- A precisão não é inventada: HDOP e satélites são os que o receptor informou;
-- pos_precisao_m é o raio de incerteza que o sistema operacional informou.
CREATE TABLE IF NOT EXISTS toras_inspecionadas (
    id                    SERIAL PRIMARY KEY,
    uuid_local            UUID UNIQUE NOT NULL,          -- gerado na máquina (uuid4); garante idempotência do sync
    maquina_id            INTEGER REFERENCES maquinas(id_maquina),
    talhao_id             INTEGER REFERENCES talhoes(id_talhao),
    log_id                VARCHAR(100) NOT NULL,          -- id legível (LOG-AAAAMMDDhhmmss-xxxx), usado no export StanForD
    data_inspecao         TIMESTAMP NOT NULL,             -- hora local da máquina
    confianca_ia          NUMERIC(5,4) NOT NULL,          -- saúde da tora, 0-1 (ex: 0.9123)
    status_classificacao  VARCHAR(20) NOT NULL
                          CHECK (status_classificacao IN ('aprovado', 'quarentena', 'reprovado')),
    hash_sha256           VARCHAR(64) NOT NULL,           -- integridade do registro (calculado na máquina)
    pos_lat               DOUBLE PRECISION CHECK (pos_lat BETWEEN -90 AND 90),
    pos_lon               DOUBLE PRECISION CHECK (pos_lon BETWEEN -180 AND 180),
    pos_hdop              DOUBLE PRECISION,
    pos_satelites         SMALLINT,
    pos_fonte             VARCHAR(30),
    pos_idade_s           DOUBLE PRECISION,               -- segundos desde a última leitura de posição, ao gravar a tora
    pos_precisao_m        DOUBLE PRECISION,
    data_sincronizacao    TIMESTAMP NOT NULL DEFAULT now(),
    criado_em             TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_toras_talhao   ON toras_inspecionadas(talhao_id);
CREATE INDEX IF NOT EXISTS idx_toras_maquina  ON toras_inspecionadas(maquina_id);
CREATE INDEX IF NOT EXISTS idx_toras_data     ON toras_inspecionadas(data_inspecao);
CREATE INDEX IF NOT EXISTS idx_toras_status   ON toras_inspecionadas(status_classificacao);

-- 8 indicadores por tora (ver README, seção 5). metodo_medicao diz de onde
-- o número veio — o dashboard lê o clone de 'lookup_clone_<ID>' e a vista
-- de 'imagem_secao_*' / 'imagem_lateral_*'.
CREATE TABLE IF NOT EXISTS indicadores_qualidade (
    id                SERIAL PRIMARY KEY,
    tora_id           INTEGER NOT NULL REFERENCES toras_inspecionadas(id) ON DELETE CASCADE,
    tipo_indicador    VARCHAR(30) NOT NULL
                      CHECK (tipo_indicador IN ('densidade', 'massa_seca', 'altura', 'diametro', 'tortuosidade', 'porcentagem_casca', 'volume_util', 'apodrecimento_pragas')),
    valor             NUMERIC(10,4) NOT NULL,
    unidade           VARCHAR(20),             -- "kg/m3", "cm", "indice", "%", "m3", "kg"
    metodo_medicao    VARCHAR(50) NOT NULL,    -- ex: "lookup_clone_CLONE_A", "imagem_secao_marcador_aruco", "opencv_eixo_flecha"
    criado_em         TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_indicadores_tora ON indicadores_qualidade(tora_id);
CREATE INDEX IF NOT EXISTS idx_indicadores_tipo ON indicadores_qualidade(tipo_indicador);

-- Defeitos confirmados pelos filtros (classes do modelo: Live_Knot,
-- Dead_Knot, Knot_missing, knot_with_crack, Crack, Marrow, Quartzity,
-- resin — e "Crack" também pela visão clássica na face de corte).
CREATE TABLE IF NOT EXISTS defeitos_detectados (
    id              SERIAL PRIMARY KEY,
    tora_id         INTEGER NOT NULL REFERENCES toras_inspecionadas(id) ON DELETE CASCADE,
    tipo_defeito    VARCHAR(50) NOT NULL,
    pos_x           NUMERIC(8,2) NOT NULL,     -- bounding box em pixels do frame (x, y, largura, altura)
    pos_y           NUMERIC(8,2) NOT NULL,
    largura         NUMERIC(8,2) NOT NULL,
    altura          NUMERIC(8,2) NOT NULL,
    confianca       NUMERIC(5,4) NOT NULL,
    criado_em       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_defeitos_tora ON defeitos_detectados(tora_id);

-- Trajeto das máquinas (frota; ver omniroot/telemetria.py). A máquina grava
-- um ponto a cada poucos segundos no SQLite (rastro_local), COM OU SEM rede;
-- o sync_daemon.py traz os pendentes para cá. O trecho percorrido sem
-- internet chega quando a rede volta. A posição AO VIVO não passa por aqui:
-- vai direto da máquina ao servidor do dashboard (memória, como a câmera).
--   registrado_em: hora local da máquina na leitura (como data_inspecao);
--   fonte: os mesmos valores de toras_inspecionadas.pos_fonte.
CREATE TABLE IF NOT EXISTS rastro_maquinas (
    id              BIGSERIAL PRIMARY KEY,
    uuid_local      UUID UNIQUE NOT NULL,           -- gerado na máquina: idempotência do sync
    maquina_id      INTEGER NOT NULL REFERENCES maquinas(id_maquina),
    registrado_em   TIMESTAMP NOT NULL,
    lat             DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon             DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
    precisao_m      DOUBLE PRECISION,
    hdop            DOUBLE PRECISION,
    satelites       SMALLINT,
    fonte           VARCHAR(30) NOT NULL,
    sincronizado_em TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rastro_maquina_data ON rastro_maquinas(maquina_id, registrado_em);


-- ============================================================
-- PARTE 2 — SEED DE TESTE (bate com maquina_id / talhao_id do config.json)
-- ============================================================

INSERT INTO maquinas (modelo, numero_serie)
VALUES ('Harvester (maquete de testes)', 'RASPI-DEMO-01')
ON CONFLICT (numero_serie) DO NOTHING;

INSERT INTO talhoes (nome, area_hectares, especie)
SELECT 'Talhão Demo', 12.5, 'Eucalyptus grandis x urophylla'
WHERE NOT EXISTS (SELECT 1 FROM talhoes WHERE nome = 'Talhão Demo');


-- ============================================================
-- PARTE 3 — DENSIDADE E RENDIMENTO POR CLONE (fonte de verdade)
-- ============================================================
-- Feedback da John Deere na mentoria: densidade não é um número fixo num
-- arquivo — a mesma espécie tem dezenas de clones, cada um com a sua.
-- Numa operação de ~6.000 toras/dia, 30 kg/m3 de diferença
-- são ~26 t/dia de massa prevista. Por isso:
--   1. esta tabela é a FONTE DE VERDADE (o laboratório atualiza aqui);
--   2. o sync_daemon.py baixa e regrava data/clones_densidade.json na máquina;
--   3. o main.py recarrega o JSON sozinho quando ele muda — cadastrou
--      aqui, em segundos a máquina usa o valor novo, sem reiniciar.
--
-- tipo_dado: 'laboratorio' (laudo real), 'literatura' (valor publicado para
-- o clone) ou 'referencia_generica' (média do híbrido, aguardando laudo).
-- densidade_base NULL é permitido de propósito: o main.py avisa e usa
-- 500 kg/m3 em vez de mascarar dado faltante.
--
-- Rendimento depurado: o enunciado pede "previsibilidade para a fábrica",
-- e a fábrica de celulose planeja a madeira pelo CONSUMO ESPECÍFICO (m³ de
-- madeira por tonelada seca ao ar), que depende de duas propriedades do
-- clone (Foelkel, 2017, Eucalyptus Online Book, cap. 46):
--
--   CE = 0,9 / [densidade básica (t a.s./m³) × rendimento depurado/100]
--
-- O rendimento segue o mesmo padrão da densidade: valor de referência com
-- proveniência (rendimento_tipo_dado), que o laboratório substitui pelo
-- laudo do clone. Nenhum dos 17 clones tem rendimento publicado; todos
-- recebem a referência genérica do híbrido E. grandis × E. urophylla:
--   48,6% e 51,2% — clones de 6 anos, kraft, kappa 18
--                   (Queiroz et al., 2004, Revista Árvore 28(6):901-909);
--   52%           — clone E. urograndis do exemplo de Foelkel (2017);
--   adotado 50,0% (valor central da faixa 48,6–52,0, arredondado).
-- Só o dashboard lê o rendimento: o sync_daemon.py baixa colunas nomeadas,
-- então a máquina não muda nada.
--
-- Cadastrar um laudo (troque também a faixa, ou deixe NULL — o dashboard
-- ignora faixa que não contém o valor):
--   UPDATE clones_densidade SET rendimento_depurado = 53.1, rendimento_min = NULL,
--          rendimento_max = NULL, rendimento_tipo_dado = 'laboratorio',
--          rendimento_fonte = 'Laudo LAB-0001, cozimento kraft kappa 18'
--    WHERE clone_id = 'GG100';

CREATE TABLE IF NOT EXISTS clones_densidade (
    id              SERIAL PRIMARY KEY,
    clone_id        VARCHAR(50) UNIQUE NOT NULL,   -- ex: 'I144', 'GG100', 'AEC 0144'
    especie         VARCHAR(100),                  -- ex: 'Urograndis (E. grandis x E. urophylla)'
    densidade_base  NUMERIC(6,1),                  -- kg/m3
    densidade_min   NUMERIC(6,1),                  -- faixa, quando a fonte dá faixa em vez de valor único
    densidade_max   NUMERIC(6,1),
    tipo_dado       VARCHAR(30) NOT NULL DEFAULT 'referencia_generica',
    fonte           TEXT,
    rendimento_depurado  NUMERIC(4,1),             -- %, polpação kraft, base madeira a.s.
    rendimento_min       NUMERIC(4,1),             -- faixa, quando a fonte dá faixa
    rendimento_max       NUMERIC(4,1),
    rendimento_tipo_dado VARCHAR(30),              -- mesmos valores de tipo_dado
    rendimento_fonte     TEXT,
    atualizado_em   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clones_densidade_clone ON clones_densidade(clone_id);

-- Clones comerciais de domínio público citados na mentoria (11) + clones genéricos de demonstração (6)
INSERT INTO clones_densidade (clone_id, especie, densidade_base, densidade_min, densidade_max, tipo_dado, fonte,
                              rendimento_depurado, rendimento_min, rendimento_max, rendimento_tipo_dado, rendimento_fonte) VALUES
    ('I144', 'Urograndis (híbrido espontâneo de E. urophylla)', 485.0, 460.0, 510.0, 'literatura',
     'Faixa 460-510 kg/m3 publicada por fontes comerciais de viveiro (mfrural, Avam Flora). NOTA: I144 e AEC 0144 parecem ser o mesmo clone -- confirmar com o contato da JD.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('AEC 0144', 'Urograndis (híbrido espontâneo de E. urophylla)', 485.0, 460.0, 510.0, 'literatura',
     'Mesmo material que I144 (fontes descrevem "Clone I144 (AEC-0144)"). Clone de domínio público segundo Embrapa CT-316.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('GG100', 'Urograndis (E. urophylla)', 490.0, NULL, NULL, 'referencia_generica',
     'Sem densidade específica publicada encontrada. Clone de domínio público (Embrapa CT-316). OBS relevante para nosso indicador de tortuosidade: a Embrapa registra que o GG100 apresenta tortuosidade de fuste. Aguardando dado de laboratório.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('VM01 (VM1)', 'Urograndis', 490.0, NULL, NULL, 'referencia_generica',
     'Sem densidade específica publicada encontrada. Aguardando dado de laboratório.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('I042', 'Urograndis', 490.0, NULL, NULL, 'referencia_generica',
     'Sem densidade específica publicada encontrada. Aguardando dado de laboratório.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('58', 'Urograndis', 490.0, NULL, NULL, 'referencia_generica',
     'Sem densidade específica publicada encontrada. Aguardando dado de laboratório.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('386', 'Urograndis', 490.0, NULL, NULL, 'referencia_generica',
     'Sem densidade específica publicada encontrada. Aguardando dado de laboratório.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('H13', 'Urograndis', 490.0, NULL, NULL, 'referencia_generica',
     'Sem densidade específica publicada encontrada. Aguardando dado de laboratório.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('H15', 'Urograndis', 490.0, NULL, NULL, 'referencia_generica',
     'Sem densidade específica publicada encontrada. Aguardando dado de laboratório.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('H17', 'Urograndis', 490.0, NULL, NULL, 'referencia_generica',
     'Sem densidade específica publicada encontrada. Aguardando dado de laboratório.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),

    ('H19', 'Urograndis', 490.0, NULL, NULL, 'referencia_generica',
     'Sem densidade específica publicada encontrada. Aguardando dado de laboratório.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).')
ON CONFLICT (clone_id) DO NOTHING;

INSERT INTO clones_densidade (clone_id, especie, densidade_base, tipo_dado, fonte,
                              rendimento_depurado, rendimento_min, rendimento_max, rendimento_tipo_dado, rendimento_fonte) VALUES
    ('CLONE_A', 'Eucalyptus sp. (clone genérico)', 490.0, 'referencia_generica', 'Clone genérico de demonstração (dados fictícios). Referência de híbrido comercial E. grandis x urophylla.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),
    ('CLONE_B', 'Eucalyptus sp. (clone genérico)', 490.0, 'referencia_generica', 'Clone genérico de demonstração (dados fictícios).',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),
    ('CLONE_C', 'Eucalyptus sp. (clone genérico)', 490.0, 'referencia_generica', 'Clone genérico de demonstração (dados fictícios).',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),
    ('CLONE_D', 'Eucalyptus sp. (clone genérico)', 490.0, 'referencia_generica', 'Clone genérico de demonstração (dados fictícios).',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),
    ('CLONE_TEST_1', 'Eucalyptus sp. (clone de teste)', 490.0, 'referencia_generica', 'Clone de teste.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).'),
    ('CLONE_TEST_2', 'Eucalyptus sp. (clone de teste)', 490.0, 'referencia_generica', 'Clone de teste.',
     50.0, 48.6, 52.0, 'referencia_generica', 'Referência genérica do híbrido E. grandis x E. urophylla: Queiroz et al. (2004); Foelkel (2017).')
ON CONFLICT (clone_id) DO NOTHING;


-- ============================================================
-- PARTE 4 — TEMPO REAL (Postgres -> dashboard)
-- ============================================================
-- A cada tora inserida OU atualizada pelo sync (o evento incremental do
-- main.py refina o mesmo registro enquanto a tora está na câmera), NOTIFY
-- no canal 'omniroot_toras'. O
-- servidor do dashboard fica em LISTEN e repassa aos navegadores por SSE —
-- a "última inspeção" aparece na tela segundos depois da máquina
-- sincronizar. Sem o trigger o dashboard cai num polling de 5 s.

CREATE OR REPLACE FUNCTION notificar_nova_tora() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify(
        'omniroot_toras',
        json_build_object(
            'id',            NEW.id,
            'op',            TG_OP,            -- INSERT (tora nova) ou UPDATE (evento incremental refinou a mesma tora)
            'uuid_local',    NEW.uuid_local,
            'status',        NEW.status_classificacao,
            'maquina_id',    NEW.maquina_id,
            'talhao_id',     NEW.talhao_id,
            'data_inspecao', NEW.data_inspecao
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notificar_nova_tora ON toras_inspecionadas;
CREATE TRIGGER trg_notificar_nova_tora
    AFTER INSERT OR UPDATE OF status_classificacao, confianca_ia, hash_sha256 ON toras_inspecionadas
    FOR EACH ROW EXECUTE FUNCTION notificar_nova_tora();

-- Trajeto: UM aviso por lote que o sync insere (FOR EACH STATEMENT, não por
-- ponto) no canal 'omniroot_rastro'; o dashboard recarrega a linha do
-- trajeto — o trecho feito sem internet aparece assim que a rede volta.
CREATE OR REPLACE FUNCTION notificar_rastro() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('omniroot_rastro', '');
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notificar_rastro ON rastro_maquinas;
CREATE TRIGGER trg_notificar_rastro
    AFTER INSERT ON rastro_maquinas
    FOR EACH STATEMENT EXECUTE FUNCTION notificar_rastro();


-- ============================================================
-- PARTE 5 — LIMPEZA DE VERSÕES ANTERIORES
-- ============================================================
-- usuarios / logs_auditoria: versões antigas, previstas para um RBAC que
-- não chegou a ser implementado. Removidas APENAS se estiverem vazias — se
-- alguém tiver populado, ficam. A tabela usuarios ATUAL (PARTE 6, com a
-- coluna versao_sessao) nunca é removida aqui.
-- pgcrypto: entrou "para gen_random_uuid()", mas o UUID é gerado na
-- máquina (Python). Nada a usa.

DO $$
DECLARE
    n BIGINT;
BEGIN
    -- EXECUTE (SQL dinâmico) de propósito: num banco zerado a tabela não
    -- existe, e um SELECT direto no IF quebraria no planejamento.
    IF to_regclass('public.logs_auditoria') IS NOT NULL THEN
        EXECUTE 'SELECT COUNT(*) FROM logs_auditoria' INTO n;
        IF n = 0 THEN
            EXECUTE 'DROP TABLE logs_auditoria';
        END IF;
    END IF;
    IF to_regclass('public.usuarios') IS NOT NULL
       AND to_regclass('public.logs_auditoria') IS NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'usuarios'
                          AND column_name = 'versao_sessao') THEN
        EXECUTE 'SELECT COUNT(*) FROM usuarios' INTO n;
        IF n = 0 THEN
            EXECUTE 'DROP TABLE usuarios';
        END IF;
    END IF;
END $$;

DROP EXTENSION IF EXISTS pgcrypto;


-- ============================================================
-- PARTE 6 — USUÁRIOS DO DASHBOARD
-- ============================================================
-- Contas de quem entra no dashboard. Papéis:
--   admin      vê o painel e gerencia as contas (tela "Usuários");
--   leitor     vê o painel e exporta;
--   convidado  painel de leitura no modo econômico (visitante do QR code e
--              login social de quem não tem conta, se OAUTH_CONVIDADOS=sim).
--
-- login: e-mail (casa com o login social) ou nome de usuário; sempre
-- minúsculo. senha_hash: scrypt com sal próprio (server/senha.ts); NULL =
-- conta só de login social. versao_sessao: sobe quando a senha, o papel ou o
-- ativo mudam — o cookie leva a versão e as sessões antigas caem na hora.
--
-- O dashboard lê os DADOS numa conexão somente-leitura. As contas são a única
-- coisa que ele escreve, por uma SEGUNDA conexão (PG_CONTAS_USER no .env do
-- dashboard) cujo papel só tem permissão nesta tabela. Criar esse login uma
-- vez, como superusuário (troque a senha):
--   CREATE ROLE omniroot_dashboard_contas LOGIN PASSWORD 'troque-esta-senha'
--     IN ROLE omniroot_contas;
--
-- Primeira conta de admin (na pasta do dashboard):
--   npm run usuario -- criar voce@empresa.com --papel admin

CREATE TABLE IF NOT EXISTS usuarios (
    id             SERIAL PRIMARY KEY,
    login          VARCHAR(254) NOT NULL,
    nome           VARCHAR(120),
    senha_hash     TEXT,
    papel          VARCHAR(20) NOT NULL DEFAULT 'leitor',
    ativo          BOOLEAN NOT NULL DEFAULT true,
    versao_sessao  INTEGER NOT NULL DEFAULT 1,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_login   TIMESTAMPTZ,
    CONSTRAINT usuarios_papel_valido CHECK (papel IN ('admin', 'leitor', 'convidado')),
    CONSTRAINT usuarios_login_minusculo CHECK (login = lower(login))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_login ON usuarios (login);

-- Papel de grupo (sem login) com acesso SÓ à tabela de contas.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniroot_contas') THEN
        CREATE ROLE omniroot_contas NOLOGIN;
    END IF;
    -- current_database(): vale para qualquer PG_DBNAME, não só desafio_madeira.
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO omniroot_contas', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO omniroot_contas;
GRANT SELECT, INSERT, UPDATE, DELETE ON usuarios TO omniroot_contas;
GRANT USAGE, SELECT ON SEQUENCE usuarios_id_seq TO omniroot_contas;


-- ============================================================
-- PARTE 7 — CONFIGURAÇÕES DA APLICAÇÃO
-- ============================================================
-- O que é REGRA da aplicação mora aqui, não no .env: o admin muda na tela
-- "Configurações" do dashboard e vale em segundos, sem reiniciar nada. No
-- .env fica só o que é da INSTALAÇÃO (endereço do banco, porta, segredos,
-- túnel). Cada chave tem tipo e faixa validados no servidor
-- (omni-root-dashboard/server/configuracoes.ts) — uma chave nova entra lá
-- E aqui, com o valor padrão.
--
-- valor é JSONB: texto ("visitante"), número (4000) ou booleano (false).
-- Reaplicar o script NÃO sobrescreve um valor que o admin já mudou.

CREATE TABLE IF NOT EXISTS configuracoes (
    chave           VARCHAR(100) PRIMARY KEY,
    valor           JSONB NOT NULL,
    descricao       TEXT NOT NULL,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);

INSERT INTO configuracoes (chave, valor, descricao) VALUES
    ('acesso.visitante_login', '"visitante"',
     'Login da conta de visitante (papel convidado) usada pelo botão "Entrar como visitante" do QR code e pelo login social sem cadastro.'),
    ('acesso.oauth_convidados', 'false',
     'Login social (Google/Microsoft/GitHub) de quem NÃO tem conta entra como visitante. Desligado = só entra quem tem conta.'),
    ('camera.offline_ms', '4000',
     'Sem quadro da câmera há mais que isso (ms), o painel mostra "Sem sinal".'),
    ('frota.offline_ms', '10000',
     'Sem posição da máquina há mais que isso (ms), o mapa mostra "sem sinal". A máquina envia a cada 2 s.')
ON CONFLICT (chave) DO NOTHING;

GRANT SELECT, UPDATE ON configuracoes TO omniroot_contas;
