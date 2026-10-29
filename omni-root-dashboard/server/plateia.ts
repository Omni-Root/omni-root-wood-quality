// Painel no celular da plateia: QR code -> link público (túnel) -> a tela de
// login normal. Quem escaneia toca em "Entrar como visitante" (conta de
// visitante, papel convidado), entra com Google/Microsoft/GitHub (qualquer
// conta vira visitante com OAUTH_CONVIDADOS=sim, server/rotas/oauth.ts) ou
// com a própria conta. O QR não leva segredo nenhum: por isso aparece também
// na tela de login.
//
//   - Túnel (TUNEL no .env, o mesmo que scripts/tunel.mjs abre):
//       tailscale  Tailscale Funnel: o endereço é o nome do notebook na rede
//                  Tailscale (https://<notebook>.<rede>.ts.net), lido do
//                  próprio `tailscale status` — fixo enquanto o nome não mudar;
//       zrok       https://ZROK_NOME.shares.zrok.io: nome reservado na conta
//                  (`zrok2 create name <nome>`), fixo;
//       ngrok      https://NGROK_DOMAIN (domínio fixo da conta).
//     PLATEIA_URL, se preenchido, vale por cima de todos.
//   - Quem chega pelo túnel vê o mesmo painel, no MODO ECONÔMICO: o ritmo se
//     ajusta à lotação e a câmera vem numa versão menor (server/economia.ts).
import { execFile } from 'node:child_process';
import fs from 'node:fs';

export const TUNEL = (process.env.TUNEL ?? '').trim().toLowerCase() || (process.env.NGROK_DOMAIN?.trim() ? 'ngrok' : '');

function semBarra(url: string): string {
  return url.replace(/\/+$/, '');
}

// No Windows, o instalador põe o CLI no PATH, mas terminal (e VS Code) aberto
// antes da instalação não enxerga: usa o caminho padrão direto.
const EXE_WINDOWS = 'C:\\Program Files\\Tailscale\\tailscale.exe';
const TAILSCALE = process.platform === 'win32' && fs.existsSync(EXE_WINDOWS) ? EXE_WINDOWS : 'tailscale';

/** Roda o CLI do Tailscale e devolve o JSON da saída (null se não instalado/sem login). */
function tailscaleJson(args: string[]): Promise<unknown> {
  return new Promise((resolve) => {
    execFile(TAILSCALE, [...args, '--json'], { timeout: 3000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

let urlTailscale: string | null = null;

/** Endereço público da plateia, sem barra no fim ('' = não configurado). */
export async function urlPublica(): Promise<string> {
  const fixa = process.env.PLATEIA_URL?.trim();
  if (fixa) return semBarra(fixa);
  if (TUNEL === 'ngrok') {
    const dominio = process.env.NGROK_DOMAIN?.trim().replace(/^https?:\/\//, '') ?? '';
    return dominio ? `https://${semBarra(dominio)}` : '';
  }
  if (TUNEL === 'zrok') {
    const nome = process.env.ZROK_NOME?.trim() ?? '';
    const dominio = process.env.ZROK_DOMINIO?.trim() || 'shares.zrok.io';
    return nome ? `https://${nome}.${dominio}` : '';
  }
  if (TUNEL === 'tailscale') {
    if (urlTailscale) return urlTailscale;
    // Self.DNSName vem com ponto no fim: "notebook.rede.ts.net."
    const st = (await tailscaleJson(['status'])) as { Self?: { DNSName?: string } } | null;
    const nome = st?.Self?.DNSName?.replace(/\.$/, '');
    if (nome) urlTailscale = `https://${nome}`;
    return urlTailscale ?? '';
  }
  return '';
}

/** O link que vai no QR code: a página inicial pública (cai no login). */
export async function linkQr(): Promise<string> {
  const base = await urlPublica();
  return base ? `${base}/` : '';
}

// zrok: sem API local para perguntar — testa o caminho inteiro, pela
// internet: o /api/health deste servidor respondeu pelo endereço público?
// "No ar" fica guardado por 20 s; "falhou" só por 3 s — logo depois do
// npm run dev o túnel ainda está subindo, e o cartão do QR precisa ver a
// virada para "no ar" na hora, não 20 s depois.
let saude: { em: number; ok: boolean } | null = null;
async function saudePublica(base: string): Promise<boolean> {
  if (saude && Date.now() - saude.em < (saude.ok ? 20_000 : 3_000)) return saude.ok;
  let ok = false;
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
    ok = res.ok && ((await res.json().catch(() => null)) as { ok?: boolean } | null)?.ok === true;
  } catch {
    ok = false;
  }
  saude = { em: Date.now(), ok };
  return ok;
}

/**
 * O túnel está no ar? zrok ou endereço fixo (PLATEIA_URL): o /api/health
 * responde pelo endereço público. ngrok: pergunta à API local do agente
 * (porta 4040, ou 4041 se outra cópia já ocupava a 4040). Tailscale: o
 * Funnel está ligado na configuração do `tailscale serve`.
 */
export async function tunelNoAr(): Promise<boolean | null> {
  const base = await urlPublica();
  if (!base) return false;
  if (process.env.PLATEIA_URL?.trim() || TUNEL === 'zrok') return saudePublica(base);
  if (TUNEL === 'tailscale') {
    // `tailscale funnel 3001` em primeiro plano (o do npm run dev) fica em
    // Foreground.<sessão>; o `--bg` fica no nível de cima.
    type Serve = { AllowFunnel?: Record<string, boolean> };
    const cfg = (await tailscaleJson(['funnel', 'status'])) as (Serve & { Foreground?: Record<string, Serve> }) | null;
    if (!cfg) return null;
    const ligado = (s: Serve) => Object.values(s.AllowFunnel ?? {}).some(Boolean);
    return ligado(cfg) || Object.values(cfg.Foreground ?? {}).some(ligado);
  }
  const host = new URL(base).host;
  for (const porta of [4040, 4041]) {
    try {
      const res = await fetch(`http://127.0.0.1:${porta}/api/tunnels`, { signal: AbortSignal.timeout(800) });
      if (!res.ok) continue;
      const { tunnels } = (await res.json()) as { tunnels?: { public_url?: string }[] };
      if (tunnels?.some((t) => t.public_url && new URL(t.public_url).host === host)) return true;
    } catch {
      /* agente não está nessa porta */
    }
  }
  return false;
}
