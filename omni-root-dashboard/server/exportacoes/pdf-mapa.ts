import { nivelCelula, valorMetrica, type Mapa, type Metrica, type Nivel } from '../consultas/mapa.js';
import { distanciaM, type PosicaoFrota, type TrajetoMaquina } from '../frota.js';
import { INK, MUTED, NIVEL_COR, RULE, ZEBRA, num } from './pdf-estilo.js';
import { baixarTiles, type TileBaixado } from './tiles.js';

// ------------------------------------------------------------
// MAPA DO RELATÓRIO — o mesmo mapa do painel: ruas do OpenStreetMap por
// baixo, zonas coloridas e toras; por cima, a rota (azul) e a máquina (pino
// vermelho com o SN), como no painel.
//
// Zona pequena demais para ver na escala do mapa (posições espalhadas por
// quilômetros, zonas de 25 m) vira uma bolinha na cor do nível; as zonas do
// "Onde agir" ganham bolinha maior, aro escuro e etiqueta com o nome — o
// mapa bate com a tabela logo abaixo.
//
// Tudo na projeção dos tiles (Web Mercator), em coordenadas "de mundo"
// u, v em [0, 1]: fundo, zonas e pontos alinham exatamente como no Leaflet.
// Sem internet, o fundo de ruas não vem: o mapa sai sobre a grade de zonas,
// com aviso — o resto do relatório não muda.
// ------------------------------------------------------------
const CIRC_TERRA_M = 40_075_016.686;

function mundo(lat: number, lon: number): [number, number] {
  const r = (lat * Math.PI) / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2];
}

export interface VistaMapa {
  uc: number; // centro da caixa, em coordenadas de mundo
  vc: number;
  S: number; // pt por unidade de mundo
  mPorPt: number; // metros por pt (para a barra de escala)
  z: number;
  tiles: TileBaixado[];
}

// Máquinas e rota que entram no mapa (mesmos dados do painel: server/frota.ts).
export interface FrotaPdf {
  maquinas: PosicaoFrota[]; // só as com posição
  trajetos: TrajetoMaquina[];
}

// Enquadra toras, zonas, máquinas e rota numa caixa w x h e baixa os tiles
// que a cobrem. É feito UMA vez: os três mapas (casca, tortuosidade,
// rejeição) são da mesma área e reaproveitam o mesmo fundo.
export async function prepararVista(mapa: Mapa, w: number, h: number, frota?: FrotaPdf): Promise<VistaMapa> {
  const us: number[] = [];
  const vs: number[] = [];
  const pontos: [number, number][] = [
    ...mapa.celulas.flatMap((c) => [[c.lat_min, c.lon_min], [c.lat_max, c.lon_max]] as [number, number][]),
    ...(frota?.maquinas.map((p) => [p.lat as number, p.lon as number] as [number, number]) ?? []),
    ...(frota?.trajetos.flatMap((t) => t.segmentos.flat()) ?? []),
  ];
  for (const [la, lo] of pontos) {
    const [u, v] = mundo(la, lo);
    us.push(u);
    vs.push(v);
  }
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  const lat0 = (mapa.celulas[0].lat_min + mapa.celulas[0].lat_max) / 2;
  const mPorUnidade = CIRC_TERRA_M * Math.cos((lat0 * Math.PI) / 180);
  // Folga de 25% em volta e extensão mínima de ~120 m: uma zona só aparece
  // com a vizinhança (ruas, quadra), não como um quadrado colado na borda.
  const minU = 120 / mPorUnidade;
  const du = Math.max((u1 - u0) * 1.5, minU);
  const dv = Math.max((v1 - v0) * 1.5, minU * (h / w));
  const S = Math.min(w / du, h / dv);
  // Zoom dos tiles: um tile (256 px) com ~128 pt => ~2 px por pt (nítido).
  const z = Math.max(0, Math.min(19, Math.round(Math.log2(S / 128))));
  const n = 2 ** z;
  const tx0 = Math.floor((uc - w / 2 / S) * n);
  const tx1 = Math.floor((uc + w / 2 / S) * n);
  const ty0 = Math.floor((vc - h / 2 / S) * n);
  const ty1 = Math.floor((vc + h / 2 / S) * n);
  const tiles = await baixarTiles(z, tx0, tx1, ty0, ty1);
  return { uc, vc, S, mPorPt: mPorUnidade / S, z, tiles };
}

// Comprimento "redondo" para a barra de escala (~1/4 da largura do mapa).
function escalaRedonda(metros: number): number {
  const opcoes = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  return opcoes.reduce((melhor, o) => (o <= metros ? o : melhor), opcoes[0]);
}

export const COR_ROTA = '#1a73e8';
const COR_PINO = '#e3191c';
// Pino do painel (viewBox 30x42): gota vermelha + miolo branco; ponta em (15, 40.6).
const PINO_GOTA =
  'M15 1.5C7.5 1.5 1.5 7.4 1.5 14.8c0 10 12 24.2 12.5 24.8a1.3 1.3 0 0 0 2 0c.5-.6 12.5-14.8 12.5-24.8C28.5 7.4 22.5 1.5 15 1.5z';

/** Pino vermelho e branco com a PONTA em (px, py); `alturaPt` = altura total. */
export function desenharPino(doc: PDFKit.PDFDocument, px: number, py: number, alturaPt = 17, apagado = false) {
  const s = alturaPt / 42;
  doc.save().translate(px - 15 * s, py - 40.6 * s).scale(s);
  doc.lineWidth(2.5).fillOpacity(apagado ? 0.7 : 1).path(PINO_GOTA).fillAndStroke(COR_PINO, INK);
  doc.lineWidth(2.2).fillOpacity(1).circle(15, 14.8, 5.6).fillAndStroke('#ffffff', INK);
  doc.restore();
}

export function desenharMapaPdf(
  doc: PDFKit.PDFDocument, mapa: Mapa, vista: VistaMapa, metrica: Metrica,
  x: number, y: number, w: number, h: number, frota?: FrotaPdf,
) {
  const { uc, vc, S, z, tiles } = vista;
  const pos = (lat: number, lon: number): [number, number] => {
    const [u, v] = mundo(lat, lon);
    return [x + w / 2 + (u - uc) * S, y + h / 2 + (v - vc) * S];
  };

  doc.save().rect(x, y, w, h).fillAndStroke(ZEBRA, RULE).restore();
  doc.save();
  doc.rect(x, y, w, h).clip();

  // Fundo: ruas (tiles) ou, sem internet, a grade de zonas.
  const n = 2 ** z;
  const lado = S / n;
  for (const t of tiles) {
    doc.image(t.png, x + w / 2 + (t.x / n - uc) * S, y + h / 2 + (t.y / n - vc) * S, { width: lado, height: lado });
  }
  if (tiles.length === 0) {
    // Grade alinhada às zonas: o passo é o tamanho de uma zona na tela.
    const c0 = mapa.celulas[0];
    const [xa, ya] = pos(c0.lat_min, c0.lon_min);
    const [xb, yb] = pos(c0.lat_max, c0.lon_max);
    const passoX = Math.abs(xb - xa);
    const passoY = Math.abs(yb - ya);
    doc.lineWidth(0.3).strokeColor(RULE);
    for (let gx = xa - Math.ceil((xa - x) / passoX) * passoX; gx <= x + w; gx += passoX) doc.moveTo(gx, y).lineTo(gx, y + h).stroke();
    for (let gy = ya - Math.ceil((ya - y) / passoY) * passoY; gy <= y + h; gy += passoY) doc.moveTo(x, gy).lineTo(x + w, gy).stroke();
  }

  // Zonas coloridas pelo indicador. Pequena demais para ver (< 6 pt): bolinha
  // no centro, na cor do nível; zona do "Onde agir" deste indicador: bolinha
  // maior com aro escuro (desenhada por último, por cima de tudo).
  const emAlerta = new Set(mapa.alertas.filter((a) => a.metrica === metrica).map((a) => a.zona));
  const caixas: { c: Mapa['celulas'][number]; nivel: Nivel; x0: number; y0: number; cw: number; ch: number }[] = [];
  const marcas: { c: Mapa['celulas'][number]; nivel: Nivel; cx: number; cy: number }[] = [];
  for (const c of mapa.celulas) {
    const nivel = nivelCelula(c, metrica);
    const cor = NIVEL_COR[nivel];
    const [x0, y0] = pos(c.lat_max, c.lon_min);
    const [x1, y1] = pos(c.lat_min, c.lon_max);
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (cw < 6 || ch < 6) {
      const cx = x0 + cw / 2;
      const cy = y0 + ch / 2;
      if (emAlerta.has(c.zona)) marcas.push({ c, nivel, cx, cy });
      else doc.save().lineWidth(0.6).fillOpacity(nivel === 'sem' ? 0.5 : 0.9).circle(cx, cy, 2.6).fillAndStroke(cor, '#ffffff').restore();
      continue;
    }
    doc.save().fillOpacity(nivel === 'sem' ? 0.12 : 0.45).rect(x0, y0, cw, ch).fill(cor).restore();
    doc.save().lineWidth(emAlerta.has(c.zona) ? 2 : 1).strokeColor(emAlerta.has(c.zona) ? INK : cor).rect(x0, y0, cw, ch).stroke().restore();
    caixas.push({ c, nivel, x0, y0, cw, ch });
  }

  // Cada tora: ponto escuro com contorno branco.
  for (const p of mapa.pontos) {
    const [px, py] = pos(p.lat, p.lon);
    doc.save().lineWidth(0.5).fillColor(INK).strokeColor('#ffffff').circle(px, py, 1.8).fillAndStroke().restore();
  }

  // Rota (azul, como no painel): contínua = caminho registrado; tracejada =
  // sem registro entre uma posição e a seguinte (inclusive até a máquina).
  const linha = (pts: [number, number][], tracejada: boolean) => {
    const xy = pts.map(([la, lo]) => pos(la, lo));
    for (const [cor, larg] of [['#ffffff', 3.4], [COR_ROTA, 1.8]] as [string, number][]) {
      doc.save().lineWidth(larg).strokeColor(cor).lineCap('round').lineJoin('round');
      if (tracejada) doc.dash(0.5, { space: 3.2 });
      doc.moveTo(xy[0][0], xy[0][1]);
      for (const [px, py] of xy.slice(1)) doc.lineTo(px, py);
      doc.stroke().undash().restore();
    }
  };
  for (const t of frota?.trajetos ?? []) {
    const segs = t.segmentos.filter((s) => s.length > 0);
    if (segs.length === 0) continue;
    segs.forEach((seg, i) => {
      if (i > 0) linha([segs[i - 1][segs[i - 1].length - 1], seg[0]], true);
      if (seg.length >= 2) linha(seg, false);
    });
    const ult = segs[segs.length - 1][segs[segs.length - 1].length - 1];
    const maq = frota?.maquinas.find((p) => p.maquina === t.maquina);
    if (maq && maq.lat !== null && maq.lon !== null && distanciaM(ult, [maq.lat, maq.lon]) >= 20) {
      const recente = maq.em !== null && new Date(maq.em).getTime() - new Date(t.fim).getTime() < 10 * 60_000;
      linha([ult, [maq.lat, maq.lon]], !recente);
    }
    const [sx, sy] = pos(segs[0][0][0], segs[0][0][1]);
    doc.save().lineWidth(1.4).circle(sx, sy, 2.6).fillAndStroke('#ffffff', COR_ROTA).restore();
  }

  // Zonas do "Onde agir" (pequenas): bolinha maior, aro escuro.
  for (const { nivel, cx, cy } of marcas) {
    doc.save().lineWidth(1.6).circle(cx, cy, 5).fillAndStroke(NIVEL_COR[nivel], INK).restore();
  }

  // Máquinas: pino com o SN ao lado.
  const ocupados: [number, number, number, number][] = []; // etiquetas já postas (x, y, w, h)
  const livre = (bx: number, by: number, bw: number, bh: number) =>
    bx >= x + 2 && by >= y + 2 && bx + bw <= x + w - 2 && by + bh <= y + h - 2 &&
    ocupados.every(([ox, oy, ow, oh]) => bx + bw < ox || ox + ow < bx || by + bh < oy || oy + oh < by);
  for (const p of frota?.maquinas ?? []) {
    if (p.lat === null || p.lon === null) continue;
    const [px, py] = pos(p.lat, p.lon);
    desenharPino(doc, px, py, 17, !p.online);
    const rot = p.online ? p.maquina : `${p.maquina} (última posição)`;
    doc.font('Helvetica-Bold').fontSize(6.5);
    const rw = doc.widthOfString(rot) + 6;
    const rx = px + 8;
    const ry = py - 17;
    doc.save().lineWidth(0.8).roundedRect(rx, ry, rw, 10, 2).fillAndStroke('#ffffff', INK).restore();
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(INK).text(rot, rx + 3, ry + 2.3, { lineBreak: false });
    ocupados.push([rx, ry, rw, 10], [px - 6, py - 17, 12, 17]);
  }

  // Etiqueta das zonas do "Onde agir" que viraram bolinha: nome + valor, ao
  // lado (direita, esquerda, acima ou abaixo — o primeiro lugar livre).
  for (const { c, cx, cy } of marcas) {
    const v = valorMetrica(c, metrica);
    const texto = `${c.zona}  ${v == null ? 'sem medida' : num(v, metrica === 'falhas' ? 0 : 1, '%')}`;
    doc.font('Helvetica-Bold').fontSize(6.5);
    const tw = doc.widthOfString(texto) + 6;
    const th = 10;
    const opcoes: [number, number][] = [[cx + 7, cy - th / 2], [cx - 7 - tw, cy - th / 2], [cx - tw / 2, cy - 7 - th], [cx - tw / 2, cy + 7]];
    const lugar = opcoes.find(([bx, by]) => livre(bx, by, tw, th));
    if (!lugar) continue; // sem espaço: a bolinha com aro já marca; a tabela tem o valor
    const [bx, by] = lugar;
    doc.save().lineWidth(0.8).fillOpacity(0.95).roundedRect(bx, by, tw, th, 2).fillAndStroke('#ffffff', INK).restore();
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(INK).text(texto, bx + 3, by + 2.3, { lineBreak: false });
    ocupados.push([bx, by, tw, th]);
  }

  // Rótulo "zona + valor" no topo de cada zona, com fundo claro: por cima de
  // tudo, legível sobre rua, cor e pontos.
  for (const { c, nivel, x0, y0, cw, ch } of caixas) {
    if (cw < 14 || ch < 9) continue;
    const v = valorMetrica(c, metrica);
    const cabeValor = cw >= 38;
    const rotValor = v == null || nivel === 'sem' ? 'sem medida' : num(v, metrica === 'falhas' ? 0 : 1, '%');
    const texto = cabeValor ? `${c.zona}  ${rotValor}` : c.zona;
    const fz = Math.max(5.5, Math.min(8, ch * 0.28));
    doc.font('Helvetica-Bold').fontSize(fz);
    const tw = Math.min(doc.widthOfString(texto) + 5, cw - 2);
    const tx = x0 + (cw - tw) / 2;
    const ty = y0 + 2;
    doc.save().fillOpacity(0.9).roundedRect(tx, ty, tw, fz + 3.5, 1.5).fill('#ffffff').restore();
    doc.font('Helvetica-Bold').fontSize(fz).fillColor(INK).text(texto, tx, ty + 1.8, { width: tw, align: 'center', lineBreak: false });
  }

  // Sem internet: diz por que não há ruas (o mapa continua certo).
  if (tiles.length === 0) {
    const aviso = 'Mapa de ruas indisponível (sem internet) — zonas e toras completas';
    doc.font('Helvetica').fontSize(7);
    const aw = doc.widthOfString(aviso) + 10;
    doc.save().fillOpacity(0.9).roundedRect(x + 6, y + 6, aw, 13, 2).fill('#ffffff').restore();
    doc.fillColor(MUTED).text(aviso, x + 11, y + 9.5, { lineBreak: false });
  }
  doc.restore(); // fim do recorte

  // Barra de escala (inferior esquerdo), norte (superior direito) e a
  // atribuição obrigatória do OSM (inferior direito), com fundo claro.
  const barraM = escalaRedonda((w * vista.mPorPt) / 4);
  const barraPt = barraM / vista.mPorPt;
  const bx = x + 8;
  const by = y + h - 9;
  doc.save().fillOpacity(0.85).roundedRect(bx - 4, by - 13, barraPt + 8, 17, 2).fill('#ffffff').restore();
  doc.save().lineWidth(1.2).strokeColor(INK).moveTo(bx, by).lineTo(bx + barraPt, by).stroke()
    .moveTo(bx, by - 3).lineTo(bx, by + 1).stroke().moveTo(bx + barraPt, by - 3).lineTo(bx + barraPt, by + 1).stroke().restore();
  doc.font('Helvetica').fontSize(6.5).fillColor(INK).text(`${barraM} m`, bx, by - 10, { lineBreak: false });

  const nx = x + w - 13;
  const ny = y + 7;
  doc.save().fillOpacity(0.85).roundedRect(nx - 7, ny - 3, 14, 23, 2).fill('#ffffff').restore();
  doc.save().polygon([nx, ny], [nx - 4, ny + 9], [nx + 4, ny + 9]).fill(INK).restore();
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(INK).text('N', nx - 2.3, ny + 11, { lineBreak: false });

  if (tiles.length > 0) {
    const attr = '© colaboradores do OpenStreetMap';
    doc.font('Helvetica').fontSize(6);
    const aw = doc.widthOfString(attr) + 6;
    doc.save().fillOpacity(0.85).rect(x + w - aw, y + h - 10, aw, 10).fill('#ffffff').restore();
    doc.fillColor(MUTED).text(attr, x + w - aw + 3, y + h - 8, { lineBreak: false });
  }
}
