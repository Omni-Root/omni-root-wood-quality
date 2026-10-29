// Limite de tentativas de login erradas, em memória (um processo só — o
// dashboard roda num processo). Duas contagens, numa janela de 15 min:
//   - por LOGIN (8): segura quem tenta adivinhar a senha de uma conta,
//     venha de onde vier;
//   - por IP (30): segura quem testa muitas contas a partir de um lugar.
// Login certo zera a contagem daquele login. Estourou -> 429 com
// Retry-After, sem nem conferir a senha (não gasta scrypt com o atacante).

const JANELA_MS = 15 * 60 * 1000;
const MAX_POR_LOGIN = 8;
const MAX_POR_IP = 30;

interface Contagem {
  falhas: number;
  desde: number;
}

const porLogin = new Map<string, Contagem>();
const porIp = new Map<string, Contagem>();

function atual(mapa: Map<string, Contagem>, chave: string, agora: number): Contagem | null {
  const c = mapa.get(chave);
  if (!c) return null;
  if (agora - c.desde > JANELA_MS) {
    mapa.delete(chave);
    return null;
  }
  return c;
}

/** Segundos até poder tentar de novo (0 = pode tentar agora). */
export function esperaParaTentar(ip: string, login: string): number {
  const agora = Date.now();
  let fim = 0;
  const l = atual(porLogin, login, agora);
  if (l && l.falhas >= MAX_POR_LOGIN) fim = Math.max(fim, l.desde + JANELA_MS);
  const i = atual(porIp, ip, agora);
  if (i && i.falhas >= MAX_POR_IP) fim = Math.max(fim, i.desde + JANELA_MS);
  return fim > agora ? Math.ceil((fim - agora) / 1000) : 0;
}

export function registrarFalha(ip: string, login: string): void {
  const agora = Date.now();
  for (const [mapa, chave] of [
    [porLogin, login],
    [porIp, ip],
  ] as const) {
    const c = atual(mapa, chave, agora);
    if (c) c.falhas++;
    else mapa.set(chave, { falhas: 1, desde: agora });
  }
  // Sem crescer para sempre sob ataque: de vez em quando, joga fora o vencido.
  if (porIp.size + porLogin.size > 5000) {
    for (const mapa of [porLogin, porIp]) {
      for (const [k, c] of mapa) if (agora - c.desde > JANELA_MS) mapa.delete(k);
    }
  }
}

export function registrarSucesso(login: string): void {
  porLogin.delete(login);
}
