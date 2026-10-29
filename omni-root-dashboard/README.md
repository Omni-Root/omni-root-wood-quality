# Omni-Root — Wood Quality Dashboard

**Read-only** web interface that shows, analyses and exports the log
inspections produced by the computer vision pipeline in
[`../Omni-Root_challenge_2026`](../Omni-Root_challenge_2026)
(FIAP × John Deere Innovation Challenge 2026, with Suzano and Eldorado Brasil —
**2nd place out of 9 finalist teams** at FIAP NEXT 2026).

This project does **not** capture images, does **not** run AI and does **not**
write inspection data. It is the end of the chain: it reads the central
PostgreSQL and turns the data into panels and reports for the forestry engineer
and for operations. The only things it writes are its own **user accounts** and
**application settings** (section 4), through a separate, restricted
database role.

For a step-by-step installation guide, see [SETUP.md](SETUP.md).

---

## 1. How it fits into the whole system

The system has **two parts** that communicate through a single shared
PostgreSQL — there are no direct code calls between them:

```
  Omni-Root_challenge_2026 (field machine)           THIS FOLDER
 ┌──────────────────────────────────────────┐      ┌──────────────────────┐
 │ main.py                                   │      │ Dashboard            │
 │  camera → YOLO → indicators               │      │  Express + React     │
 │             ↓                             │      │                      │
 │        local SQLite (offline)             │      │  • panels            │
 │             ↓  sync_daemon.py             │      │  • login             │
 └─────────────┼─────────────────────────────┘      │  • CSV / PDF /       │
               ↓                                    │    StanForD          │
        ┌──────────────────────┐   read             └──────────┬───────────┘
        │ central PostgreSQL   │ ──────────────────────────────┘
        │   desafio_madeira    │
        └──────────────────────┘
```

**The integration point is the database.** The `.env` here points to the same
PostgreSQL that `sync_daemon.py` feeds. When an inspection is synced from the
field, it shows up here with no extra copy. The only exceptions are the **live
camera** and **live machine position**, which the field machine pushes directly
to this server over HTTP (authenticated by `STREAM_TOKEN`) and which are kept
in memory only.

"Read-only" is guaranteed twice: besides the scope of the code, the data
connection opens with `default_transaction_read_only=on`, so PostgreSQL itself
rejects any write on it (an `INSERT` fails with error `25006`). Accounts use a
second connection whose role (`omniroot_contas`) can only touch the `usuarios`
and `configuracoes` tables — not even a bug in that code can change an
inspection.

---

## 2. Stack

- **Server**: Express + `pg` in TypeScript, run with `tsx` — a thin read API,
  no ORM. In development, `scripts/servidor.mjs` supervises it (restarts on code
  changes **and** on crashes, logging crashes to `logs/servidor-erros.log`).
- **Client**: Vite + React + Recharts. The heatmap is plain CSS grid.
- **Map**: Leaflet (bundled, no CDN) with OpenStreetMap tiles as an optional
  base layer — the quality layer is drawn by the app and works offline.
- **PDF**: `pdfkit`, with a street map rendered server-side.
- **Real time**: PostgreSQL `LISTEN/NOTIFY` → Server-Sent Events.
- In development, server, client and (optional) public tunnel start together
  with `concurrently`, and Vite proxies `/api` to Express.

---

## 3. What the interface shows

Every panel respects the filters at the top (**period** and **machine**):

| Panel | What it answers |
|---|---|
| **Latest inspection from the field** | The most recent log with the indicators the challenge asks for: diameter, length, residual bark, crookedness, basic density (with its **provenance**: lab / literature / generic reference), dry mass (with a min–max range when the clone has one) and defects. **Updates by itself** when the machine syncs (SSE) and flashes once when a new log arrives. Measured values have a solid border, estimated ones a dashed border. |
| **Summary cards** | How many pieces were inspected and the split between Approved / Contained / Rejected, with percentages |
| **Quality by stand and clone** | Average bark, crookedness (side views only), diameter, volume and **predicted dry mass** — with the reference density, its provenance and the uncertainty range. Also pulp yield, predicted pulp output and **specific wood consumption** (m³ of wood per tonne of pulp). This is the "predictability for the mill" from the challenge statement, in numbers |
| **Crookedness / residual bark distribution** | Histograms by band (crookedness: straight < 2%, slight 2–5%, visible 5–10%, crooked ≥ 10%; bark: ≤ 5%, 5–15%, 15–30%, > 30%) |
| **Quality map — "Where to act"** | ~25 m cells coloured by bark, crookedness or rejection rate, with thresholds and recommended actions computed on the server; machine positions (live or last known) and tracks on top, including stretches driven offline |
| **Live camera** | Annotated video pushed by the field machine (MJPEG); "Sem sinal" (no signal) with the last frame dimmed when the machine goes offline |
| **Events over time** | Volume and quality over time (hour, day or week buckets) |
| **Proportion by classification** | Share of each result in the period (donut) |
| **Failure heatmap** | Failures by **weekday × hour** — reveals operational patterns (shift, fatigue, stand change) |
| **Notifications** | Trend alerts: a machine with 3+ of its last 5 logs above the limit (last 2 h). The bell counter goes up, the phone vibrates and, if narration is on, the alert is spoken |

Indicators come from `indicadores_qualidade` (8 rows per log, written by
`main.py`). The clone of each log comes from the density `metodo_medicao`
(`lookup_clone_<ID>`), and the density's provenance and range come from the
`clones_densidade` table. If that table does not exist, the panels still work —
just without provenance and range.

Database statuses (`aprovado` / `quarentena` / `reprovado`) appear in the
interface as **Aprovada / Contenção / Rejeitada** (Approved / Contained /
Rejected). "Failure" is `reprovado` + `quarentena` by default, adjustable on the
heatmap.

> The user interface is in Brazilian Portuguese, for the operators and managers
> it was designed for.

---

## 4. Accounts and authentication

Accounts live in the `usuarios` table of the central database (part 6 of
`setup_completo.sql`), with three roles:

| Role | Can |
|---|---|
| `admin` | See the panel and manage accounts (the **Usuários** window in the header) |
| `leitor` (reader) | See the panel and export |
| `convidado` (guest) | See the panel in economy mode — used by the audience visitor account |

- **Passwords** are hashed with **scrypt** (`node:crypto`, per-user salt,
  self-describing format so parameters can be raised later —
  `server/senha.ts`). Minimum 10 characters.
- **Login** by username or e-mail (case-insensitive). Unknown login, inactive
  account, passwordless account and wrong password all get the same answer
  **and the same response time** (a dummy scrypt runs for unknown logins), so
  attackers cannot discover which logins exist.
- **Brute-force limit**: 8 failures per login or 30 per IP in 15 min → `429`
  with `Retry-After`, without even running scrypt (`server/limite.ts`).
- **Sessions** last **12 h** in an **HttpOnly** cookie signed with
  HMAC-SHA256, carrying the account id, role and `versao_sessao`. Every
  protected request checks in the database (cached for 5 s) that the account is
  still active and on the same version. **Changing a password, changing the
  role, deactivating or deleting an account bumps the version and kills its
  open sessions immediately** — including live SSE connections.
- **Changing your own password** (`Senha` in the header) requires the current
  one, kills your other sessions and keeps the current one.
- **Safety rules**: there is always at least one active admin (demoting,
  deactivating or deleting the last one is refused, with row locks so two
  concurrent changes cannot bypass it); an admin cannot demote, deactivate or
  delete themselves.
- **Cross-site protection**: every state-changing route checks
  `Sec-Fetch-Site` (or `Origin`) and refuses requests from other sites.
- **Social login (optional)**: Google, Microsoft and GitHub via OAuth 2.0
  authorization code, entirely server-side (client secrets never reach the
  browser). A random `state` in a signed cookie prevents login CSRF. A
  **verified** e-mail enters only if an active account has that e-mail as its
  login (the account may have no password at all). With the setting
  *"Login social sem cadastro entra como visitante"* on, any other account
  enters as the visitor.
- **Audience visitor**: through the public tunnel only, the login screen shows
  **Entrar como visitante**, which signs in to the visitor account (role
  `convidado`; which login is a setting, default `visitante`) without a
  password. Deactivating that account turns off visitor access — including
  social-login guests — at once.
- `SESSION_SECRET` makes sessions survive server restarts. Without it, a random
  secret is generated on every boot.

### Managing accounts from the command line

The first admin has to be created from the command line (the Usuários window
needs an admin). The same commands rescue a locked-out admin:

```bash
npm run usuario -- criar you@company.com --papel admin --nome "Your Name"
npm run usuario -- criar visitante --papel convidado --sem-senha   # audience visitor
npm run usuario -- senha you@company.com          # set a new password
npm run usuario -- papel someone@company.com leitor
npm run usuario -- desativar someone@company.com  # or: ativar
npm run usuario -- listar
```

Passwords are typed without echo (or read from standard input when piped). The
script applies the same rules as the interface (`server/usuarios.ts`).

### Diagnostics

On startup the server checks that it can reach the account tables and prints
the exact cause otherwise — e.g. *the Postgres login in `PG_CONTAS_USER` was
refused*, *table missing: apply `setup_completo.sql`*, *role lacks permission*,
*database unreachable* — plus a warning when there is no active admin. The
browser only gets a generic message (database details never leak to clients).

### Application settings (database, not `.env`)

`.env` holds only what belongs to the **installation**: database address,
ports, secrets (session, OAuth apps, machine token) and the tunnel. **Rules of
the application** live in the `configuracoes` table (part 7 of
`setup_completo.sql`) and are edited by admins in the **Configurações** window;
changes apply within seconds, without restarting:

| Setting | Default | Meaning |
|---|---|---|
| `acesso.visitante_login` | `visitante` | Account used by "Entrar como visitante" and by social-login guests |
| `acesso.oauth_convidados` | off | Social-login accounts without a registered e-mail enter as the visitor |
| `camera.offline_ms` | 4000 | Live camera shows "no signal" after this long without a frame |
| `frota.offline_ms` | 10000 | Machine shows "no signal" on the map after this long without a position |

Each key is declared in `server/configuracoes.ts` with its type and allowed
range (validated on every change); the database stores the value plus who
changed it and when. The server caches values in memory and re-reads them
every 15 s, so a change made directly in the database is picked up too.

---

## 5. Theme, text size and accessibility

- **Theme**: System → Light → Dark → System. Applied **before** React renders,
  so the page never flashes the wrong theme. Recharts receives colours as SVG
  attributes (where `var(--token)` does not resolve), so `useThemeTokens.ts`
  watches `data-theme` with a `MutationObserver` and re-renders the charts.
- **Text size**: six steps (0.9× to 1.75×) through the `--escala-texto` CSS
  variable — designed for projectors, so people at the back of the room can
  read the map and the numbers.
- **Accessibility modes** (independent toggles):
  - *Colour-blind*: status in blue / orange / wine with symbols (✓ ! ✕). The
    original approved × rejected pair had ΔE 3.8 under deuteranopia; the new
    palette reaches 19 (light) and 13.6 (dark).
  - *Dyslexia*: OpenDyslexic font (bundled, works offline), extra letter, word
    and line spacing, no italics or ALL CAPS — following the British Dyslexia
    Association style guide.
  - *High contrast*: every text and status colour ≥ 7:1 (WCAG AAA), 2 px
    borders, no shadows or transparency.
- **Keyboard shortcuts** (presentation mode): one key per part of the panel,
  without Ctrl/Alt/Cmd so browser shortcuts stay intact. Press **?** for the
  list — it is generated from the same table, so it never goes stale.
- **Narration (text-to-speech)** with the browser's Web Speech API:
  - **Spoken live alert**: when a new inspection syncs, the panel says, e.g.,
    *"New inspection. Log rejected at 15:42 on machine X, stand Y. 1 defect:
    dead knot. Diameter 18 cm, residual bark 8 percent."* A sync burst says how
    many arrived and describes only the last one.
  - **Read buttons** on the "Summary" and "Latest inspection" panels.
  - **Screen readers**: everything spoken also goes to an `aria-live` region,
    so NVDA/JAWS receive the same alert with or without voice.

  The UX criterion of the challenge asked for *cognitive ergonomics and
  alerts*: a manager does not stare at the panel, and a spoken rejection is an
  alert that needs no visual attention.

Preferences are stored in `localStorage`.

---

## 6. Audience access (QR code)

For live presentations, `npm run dev` can open a **public tunnel** (zrok,
Tailscale Funnel or ngrok, chosen by `TUNEL`) and shows a **QR code** on the
login screen and sidebar (key **Q** for full screen). Visitors who come through
the tunnel use an **economy mode**: the refresh rate adapts to how many phones
are connected (up to 10: near real time; up to 40: latest inspection every
10 s; more: every 15 s), the live camera comes in a smaller version and only
while visible, and a hidden tab stops polling. Responses come from a shared
5 s cache, so the database is queried once, not once per phone. The local
screen never enters this mode.

---

## 7. Exports

The **Exportar ▾** menu offers three formats, all respecting the selected period
and machine.

### CSV
**Raw** inspection data — one row per log: date/time, classification, AI
confidence, machine, serial number, stand and `log_id`. Generated by streaming
in batches (**keyset pagination**), so the server never loads the whole table
into memory. Excel-friendly for Brazilian locale: UTF-8 BOM, `;` separator and
decimal comma.

### PDF report
Generated on the server with `pdfkit` — a real report, not a browser printout:

- KPIs: total inspections, failures and failure rate, approval rate and average
  AI confidence;
- table by classification with average confidence;
- breakdown by machine and by stand, with each failure rate;
- temporal failure pattern: by weekday and top-5 hours;
- quality map with streets and the "Where to act" list.

### StanForD export
Exports in the **StanForD 2010** standard (`.hpr` — *Harvested Production
Report*), the XML format used by the forestry industry and by harvester
manufacturers. One file per machine (`<serial_number>.hpr`), packed in a ZIP.

Each inspected log becomes a `<Stem>` with:
- `<Log>` / `<LogMeasurement>` with diameter, length and volume;
- `<StemGrade>` derived from the status (1 = OK, 2 = manual review,
  3 = rejected);
- the AI indicators, YOLO defects and position in `<UserDefinedData>`, using the
  official `DataTableGroup / DataTable / Row / ColumnData` mechanism.

> ⚠️ The structure follows the **public Skogforsk documentation** but **has not
> been validated against the official XSD**. Do not call it "StanForD
> certified".

> ℹ️ StanForD expresses diameter and length in **millimetres**. Indicators
> arrive in centimetres, so the conversion uses the **unit stored with each
> value** instead of assuming one.

The ZIP is built by a minimal in-house writer (`server/exportacoes/zip.ts`,
`zlib` + CRC32), with no zip library.

---

## 8. Environment variables

Copy `.env.example` to `.env` and fill it in. The real `.env` **never** goes to
Git (it is in `.gitignore`). `.env.example` documents every variable in detail.

| Variable | Default | Description |
|---|---|---|
| `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DBNAME` | `localhost` / `5432` / `postgres` / — / `desafio_madeira` | Central PostgreSQL (ideally a read-only user) |
| `PG_SSL` | `false` | `true` if the server requires TLS (e.g. managed cloud) |
| `API_PORT` | `3001` | API port (Vite proxies to it) |
| `PG_CONTAS_USER` / `PG_CONTAS_PASSWORD` | `PG_USER` / `PG_PASSWORD` | Login role for the `usuarios` table only (member of `omniroot_contas`). Falls back to `PG_USER` with a warning — fine for development, create it for production |
| `SESSION_SECRET` | random | Signs the session cookie |
| `STREAM_TOKEN` | — | Shared secret for the field machine to push camera frames and position (same value in the field `.env`) |
| `GOOGLE_*`, `MICROSOFT_*`, `GITHUB_*`, `OAUTH_URL_BASE` | — | OAuth apps for social login |
| `TUNEL`, `ZROK_*`, `NGROK_*` | — | Public tunnel for the audience QR code |
| `PLATEIA_URL` | — | Optional fixed public URL for the tunnel |

The `PG_*` names are **the same** as in `sync_daemon.py`, on purpose, so both
point to the same database without translating configuration.

---

## 9. Running

### Development

```bash
npm install
npm run dev
```

- UI: http://localhost:5173 (hot reload)
- API: http://localhost:3001/api/health
- `npm run dev:celular` exposes the UI on the local network for phones.

### Local production

```bash
npm run build
npm start
```

Express serves the compiled UI **and** the API on the same port (`API_PORT`).

### Type checking

```bash
npm run typecheck
```

> The database must be running. In the field folder: `docker compose up -d`.

---

## 10. No access to the central database? Local database

`docker compose up -d` in `../Omni-Root_challenge_2026` starts PostgreSQL and
applies `Banco de dados/setup_completo.sql` (the **only** database script:
schema, seed, density per clone, position columns and real-time trigger;
idempotent). To get data, run `main.py` (or `tests/simular_cenario.py`, no
camera needed) and `sync_daemon.py` there.

> To test without touching real data, create a separate database in the same
> container, apply `setup_completo.sql` to it and point the dashboard there with
> `PG_DBNAME=<test_database>`.

---

## 11. API endpoints

| Route | Session | Parameters | Returns |
|---|---|---|---|
| `GET /api/health` | public | — | `{ok: true}` if the database answers |
| `POST /api/login` | public | `{username, password}` | Opens a session (HttpOnly cookie); `429` after too many failures |
| `POST /api/login/visitante` | public (tunnel only) | — | Signs in to the visitor account |
| `POST /api/logout` | public | — | Closes the session |
| `GET /api/me` | public | — | `{authenticated, user?, nome?, papel?, plateia?, visitante?}` |
| `POST /api/me/senha` | required | `{atual, nova}` | Changes your own password (other sessions are closed) |
| `GET /api/configuracoes` | admin | — | Application settings (definition, value, who changed it) |
| `PATCH /api/configuracoes/:chave` | admin | `{valor}` | Changes a setting (type and range validated) |
| `GET /api/usuarios` | admin | — | Account list |
| `POST /api/usuarios` | admin | `{login, nome?, papel, senha?}` | Creates an account (no password = social login only) |
| `PATCH /api/usuarios/:id` | admin | `{nome?, papel?, ativo?, senha?, semSenha?}` | Changes an account (role/active/password changes close its sessions) |
| `DELETE /api/usuarios/:id` | admin | — | Deletes an account |
| `GET /api/auth/provedores` · `GET /api/auth/:provider/entrar` · `GET /api/auth/:provider/retorno` | public | — | Configured social login providers / OAuth redirect / OAuth callback |
| `GET /api/plateia` · `GET /api/plateia/qr.svg` | public | — | Public link (tunnel) and whether it is up / QR code leading to it |
| `GET /api/maquinas` | required | — | Machine list for the filter |
| `GET /api/summary` | required | `from`, `to`, `maquinaId?` | Count by classification |
| `GET /api/timeseries` | required | + `bucket` (`hour`/`day`/`week`) | Time series by classification |
| `GET /api/heatmap` | required | + `statuses` (e.g. `reprovado,quarentena`) | Count by weekday × hour |
| `GET /api/ultima` | required | `maquinaId?` | Latest log, with the 8 indicators, density provenance and mass range |
| `GET /api/qualidade` | required | `from`, `to`, `maquinaId?` | Quality by stand/clone (with yield, predicted pulp and specific consumption) + crookedness and bark histograms |
| `GET /api/mapa` | required | `from`, `to`, `maquinaId?` | Quality map: 25 m cells, logs with position, thresholds and "Where to act" |
| `GET /api/tendencia` | required | `maquinaId?` | Trend alert: machine with 3+ of the last 5 logs above the limit (last 2 h) |
| `GET /api/events` | required | — | Real time (SSE): new/updated log notifications |
| `POST /api/camera/frame` | `STREAM_TOKEN` | JPEG body | Live camera frame pushed by the machine |
| `GET /api/camera/maquinas` · `GET /api/camera/stream` | required | `maquina` | Machines streaming / MJPEG video |
| `POST /api/maquinas/posicao` | `STREAM_TOKEN` | JSON: `maquina` (serial), `lat`, `lon`, accuracy… | Current machine position, pushed every 2 s (memory only; relayed to browsers via SSE) |
| `GET /api/frota` | required | — | Each machine by serial: live or last known position, online/no signal |
| `GET /api/frota/rastro` | required | `from`, `to`, `maquinaId?` | Track of each machine in the period (including offline stretches) |
| `GET /api/export/csv` | required | `from`, `to`, `maquinaId?` | Inspections as CSV (streaming) |
| `GET /api/export/pdf` | required | `from`, `to`, `maquinaId?` | PDF report (with street map and "Where to act") |
| `GET /api/export/stanford` | required | `from`, `to`, `maquinaId?` | ZIP with StanForD 2010 `.hpr` files |

Dates are `YYYY-MM-DD`, inclusive range. Everything is validated on the server
(dates by regex, `maquinaId` integer, `bucket`/`statuses` by whitelist), queries
are parameterised and **aggregate in the database** — the event table is never
sent whole to the client.

---

## 12. File structure

```
server/
  index.ts              # Entry: starts the app and real time
  app.ts                # Builds Express (middlewares, routes, client in production)
  http.ts               # Query-string filters and error envelopes (400/500)
  rotas/                # One per topic: sessao · oauth · usuarios · configuracoes · painel · camera · frota · plateia · exportacoes
  consultas/            # SQL per topic (everything aggregated in the database)
    filtros.ts            period/machine and the SQL fragments that apply them
    operacao.ts           summary, time series, heatmap, machines
    qualidade.ts          latest inspection, quality by stand, histograms
    mapa.ts               25 m cells, thresholds and "Where to act" (single source of thresholds)
    tendencia.ts          trend alert per machine
    consumo.ts            pulp yield and specific wood consumption
    exportacao.ts         rows for CSV, PDF and StanForD
  exportacoes/          # Generated files
    csv.ts  pdf.ts  pdf-mapa.ts (street map)  pdf-estilo.ts  stanford.ts
    tiles.ts (OpenStreetMap)  zip.ts  rotulos.ts
  auth.ts               # Session cookie, database check, admin and same-origin guards
  usuarios.ts           # Accounts: validation, rules, reads and writes (restricted pool), boot diagnostics
  configuracoes.ts      # Application settings: typed definitions, validation, in-memory cache
  senha.ts · limite.ts  # scrypt password hashing · login attempt limit
  db.ts · live.ts · camera.ts · frota.ts · economia.ts · plateia.ts · validate.ts
src/
  App.tsx               # Session: login or panel
  paginas/Painel.tsx    # Panel layout (grid)
  hooks/                # useDadosPainel (load/reload), useLive (SSE), useFrota,
                        # useAnuncioInspecao (voice), useAtalhos, useThemeTokens
  components/           # One component per panel/control (Cabecalho, MapaQualidade,
                        # UltimaInspecao, Notificacoes, GestaoUsuarios, Configuracoes, MinhaSenha, ...)
  estilos/              # CSS per screen area; cascade order in estilos/index.css
  api.ts · types.ts · voz.ts · datas.ts · acessibilidade.ts · tamanhoTexto.ts · economico.ts
scripts/
  servidor.mjs          # Dev supervisor (restart on change and on crash)
  tunel.mjs             # Public tunnel for the audience QR code
  usuario.ts            # Account management from the command line (npm run usuario)
```

---

## 13. Technical decisions

- **Schema**: the real one from the field folder
  (`Banco de dados/setup_completo.sql`). Table `toras_inspecionadas`, with
  `status_classificacao` ∈ `aprovado` / `quarentena` / `reprovado`.
- **Weekday × hour heatmap**: `data_inspecao` is a `TIMESTAMP` without time zone
  (machine local time), so day and hour are extracted directly in SQL, with no
  time-zone conversion in the browser.
- **Colours**: fixed status palette and **always with a label** — colour is
  never the only carrier of information. The heatmap uses a single-hue
  sequential ramp.
- **Aggregation in the database**: every panel receives pre-aggregated data;
  the client never pages through the event table.
- **Streaming CSV (keyset)** to avoid loading everything into memory; **PDF
  generated on the server**, not printed by the browser.
- **Offline-first map**: the quality layer is drawn by the app; the street layer
  is an optional enhancement that disappears with a warning when offline.
- **Accounts in the database, data still read-only**: two connection pools —
  a read-only one for data and a restricted one (`omniroot_contas` role) that
  can only write the `usuarios` table.
- **Stateless cookie + version check**: no sessions table; revocation works
  through `versao_sessao`, checked against the database on every request
  (5 s cache).
- **No zip dependency**: the StanForD ZIP is built by hand with `zlib`.
