# Setup — install and run the dashboard

From zero to the dashboard open in the browser. Works on Windows, macOS and
Linux.

---

## 1. Prerequisite: Node.js (once)

The project needs **Node.js 20 or newer**.

1. Check whether you have it: run `node --version` in a terminal.
2. If it fails or the version is below 20, install the LTS from
   https://nodejs.org (on Windows, `winget install OpenJS.NodeJS.LTS` also works).
3. Close and reopen the terminal after installing.

## 2. Install dependencies (once)

From the `omni-root-dashboard` folder:

```bash
npm install
```

Avoid folders synced by OneDrive or similar — `node_modules` makes syncing slow.

## 3. Configure `.env`

```bash
cp .env.example .env
```

Fill in at least:

- `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DBNAME` — the central
  PostgreSQL (or the local one from step 6);
- `SESSION_SECRET` — any long random string, so sessions survive restarts.

Accounts live in the database, not in `.env`. Make sure the database has the
latest `setup_completo.sql` applied (it creates the `usuarios` table), then
create the first admin:

```bash
npm run usuario -- criar you@company.com --papel admin
```

Everyone else can then be created in the **Usuários** window of the panel.

For production, also create the restricted database login for accounts (as a
PostgreSQL superuser) and set `PG_CONTAS_USER` / `PG_CONTAS_PASSWORD`:

```sql
CREATE ROLE omniroot_dashboard_contas LOGIN PASSWORD 'change-me' IN ROLE omniroot_contas;
```

> Only **`.env`** is read by the server — `.env.example` is just a documented
> template. Every change to `.env` requires restarting the server (`Ctrl+C` and
> `npm run dev` again).

## 4. Run

```bash
npm run dev
```

This starts the processes together:

- `server` — the read API at http://localhost:3001
- `client` — the interface at **http://localhost:5173** ← open this one
- `tunel` — the public tunnel for the audience QR code (does nothing if `TUNEL`
  is not set)

Log in with the account you created. Code changes reload
automatically. Stop with `Ctrl+C`.

**Red banner "Não foi possível carregar os dados" (could not load data)?** The
dashboard opened but could not reach PostgreSQL — check host/port/password in
`.env` and whether the database is up. Quick test: open
http://localhost:3001/api/health (it should answer `{"ok":true}`).

## 5. (Optional) Open on a phone

```bash
npm run dev:celular
```

The terminal shows a `Network: http://192.168.x.x:5173` address: open it on a
phone on the same Wi-Fi. On Windows, the firewall may ask whether to allow
Node — allow it on private networks.

## 6. (Optional) Local database, without the central one

In `../Omni-Root_challenge_2026`, `docker compose up -d` starts PostgreSQL and
applies `Banco de dados/setup_completo.sql` (the only database script). To get
data, run `main.py` (or `tests/simular_cenario.py`, no camera needed) and
`sync_daemon.py` there.

In this folder's `.env`: `PG_HOST=localhost`, the port and password of the
Docker PostgreSQL — then run `npm run dev` again.

## 7. (Optional) QR code for the audience

`npm run dev` builds the panel and opens a public tunnel at the fixed address
chosen by `TUNEL` in `.env`:

- `TUNEL=zrok` + `ZROK_NOME` → `https://<name>.shares.zrok.io` (needs the
  `zrok2` binary, an account enabled with `zrok2 enable` and the name created
  once with `zrok2 create name <name>`);
- `TUNEL=tailscale` → `https://<laptop>.<tailnet>.ts.net` (Tailscale installed
  and logged in, with Funnel enabled);
- `TUNEL=ngrok` + `NGROK_DOMAIN` / `NGROK_AUTHTOKEN`.

The QR code appears on the login screen and in the sidebar; click it (or press
**Q** on the panel) for full screen. It leads to the **login screen**, where
visitors tap **Entrar como visitante** (needs the visitor account:
`npm run usuario -- criar visitante --papel convidado --sem-senha`), sign in
with Google or Microsoft (with the setting *"Login social sem cadastro entra
como visitante"* on, in **Configurações**, any account enters as the visitor),
or use their own account. For social login through the tunnel, register
`https://<public address>/api/auth/<google|microsoft|github>/retorno` as the
redirect URL with each provider.

Visitors through the tunnel use **economy mode** (adaptive refresh rate, smaller
live camera, shared 5 s cache — see the README). Changed the front end? Restart
`npm run dev` so the audience sees it.

## 8. (Optional) Production build

```bash
npm run build
npm start
```

A single process: Express serves the compiled interface and the API on port
3001 (http://localhost:3001).

---

More details (API endpoints, technical decisions, variables): see
[README.md](README.md).
