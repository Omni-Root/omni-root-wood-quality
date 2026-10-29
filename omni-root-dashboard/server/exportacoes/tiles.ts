// Blocos (tiles) do OpenStreetMap para o mapa de ruas do RELATÓRIO PDF — o
// mesmo fundo que o navegador usa no painel, baixado aqui pelo servidor.
//
// Regras de uso do servidor público de tiles do OSM que seguimos:
//   - User-Agent identificando o aplicativo;
//   - só os poucos blocos da área do relatório (nada de download em massa);
//   - cache em memória (o mesmo bloco não é pedido de novo a cada PDF);
//   - atribuição "© colaboradores do OpenStreetMap" desenhada no mapa.
//
// Sem internet (ou OSM fora), devolve null para o bloco e o PDF sai sem o
// fundo de ruas, com aviso — nunca trava nem falha a exportação.

const URL_TILE = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const USER_AGENT = 'OmniRoot-Dashboard/0.1 (FIAP Challenge 2026; relatorio PDF)';
const TIMEOUT_MS = 4000;
const MAX_CACHE = 300;

const cache = new Map<string, Buffer>();

async function baixarTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const chave = `${z}/${x}/${y}`;
  const guardado = cache.get(chave);
  if (guardado) return guardado;
  try {
    const res = await fetch(URL_TILE(z, x, y), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(chave, buf);
    return buf;
  } catch {
    return null; // sem rede / timeout: o chamador segue sem o fundo
  }
}

export interface TileBaixado {
  z: number;
  x: number;
  y: number;
  png: Buffer;
}

// Baixa em paralelo os blocos (z, x0..x1, y0..y1). Limite de segurança: um
// relatório nunca pede mais que isso (o zoom é escolhido para caber na caixa).
export async function baixarTiles(z: number, x0: number, x1: number, y0: number, y1: number): Promise<TileBaixado[]> {
  const n = 2 ** z;
  const pedidos: Promise<TileBaixado | null>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= n) continue;
      const xw = ((x % n) + n) % n;
      pedidos.push(baixarTile(z, xw, y).then((png) => (png ? { z, x, y, png } : null)));
      if (pedidos.length > 40) break;
    }
  }
  return (await Promise.all(pedidos)).filter((t): t is TileBaixado => t !== null);
}
