// Relatório PDF — sumário do período (não é uma captura de tela do navegador;
// é gerado no servidor com pdfkit). Respeita o período e a máquina filtrados.
//
// Duas armadilhas do pdfkit que este arquivo evita de propósito:
//   1. `doc.text(txt)` sem X continua da posição X da ÚLTIMA escrita — depois
//      de uma tabela, títulos "escorregam" para a coluna da direita. Aqui todo
//      texto de bloco recebe X = margem esquerda explicitamente.
//   2. Escrever abaixo da margem inferior (rodapé) faz o pdfkit abrir uma
//      página nova em branco. O rodapé zera a margem inferior enquanto escreve.
import type express from 'express';
import PDFDocument from 'pdfkit';
import { getPdfReport } from '../consultas/exportacao.js';
import { type Filters } from '../consultas/filtros.js';
import { getQualidade } from '../consultas/qualidade.js';
import { getMapa, LIMITES, type Metrica, type Nivel } from '../consultas/mapa.js';
import { STATUS_LABEL, DOW_LABEL, FONTE_POSICAO_LABEL, fmtDateBR } from './rotulos.js';
import {
  INK, JD_GREEN, JD_GREEN_DARK, JD_YELLOW, METRICA_TITULO, MUTED, NIVEL_COR, RULE, STATUS_COLOR, ZEBRA,
  ascii, conf, num, pct, tipoDadoLabel,
} from './pdf-estilo.js';
import { COR_ROTA, desenharMapaPdf, desenharPino, prepararVista, type FrotaPdf } from './pdf-mapa.js';
import { getRastro, listarFrota } from '../frota.js';
import { listMaquinas } from '../consultas/operacao.js';
import type { Status } from '../validate.js';

export async function streamPdf(f: Filters, res: express.Response): Promise<void> {
  const [rep, qual, mapa, rastro, frotaToda, maquinas] = await Promise.all([
    getPdfReport(f),
    getQualidade(f).catch(() => null),
    getMapa(f).catch(() => null),
    getRastro(f).catch(() => null),
    listarFrota().catch(() => []),
    listMaquinas().catch(() => []),
  ]);
  // Máquina (pino) e rota no mapa, como no painel — só a máquina filtrada, se houver filtro.
  const snFiltro = f.maquinaId == null ? null : (maquinas.find((m) => m.id === f.maquinaId)?.numero_serie ?? '');
  const frota: FrotaPdf = {
    maquinas: frotaToda.filter((p) => p.lat !== null && p.lon !== null && (snFiltro === null || p.maquina === snFiltro)),
    trajetos: rastro?.maquinas ?? [],
  };
  const filename = `relatorio_${f.from}_a_${f.to}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: 'Omni-Root — Relatório de qualidade da madeira' } });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 24; // deixa espaço para o rodapé

  // ---- Faixa de cabeçalho (verde JD com filete amarelo) ----
  const drawHeaderBand = () => {
    doc.save();
    doc.rect(0, 0, doc.page.width, 64).fill(JD_GREEN);
    doc.rect(0, 64, doc.page.width, 4).fill(JD_YELLOW);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text('Omni-Root · Qualidade da Madeira', left, 18, { width, lineBreak: false });
    doc.font('Helvetica').fontSize(9.5).fillColor('#e8f0e5').text('Relatório de inspeções · Challenge John Deere / Suzano / Eldorado', left, 40, { width, lineBreak: false });
    doc.restore();
  };
  drawHeaderBand();
  doc.y = 84;

  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(
    `Período: ${fmtDateBR(f.from)} a ${fmtDateBR(f.to)}` +
      (f.maquinaId ? `  ·  Máquina #${f.maquinaId}` : '  ·  Todas as máquinas') +
      `  ·  Gerado em ${fmtDateBR(new Date().toISOString().slice(0, 19))}`,
    left, doc.y, { width },
  );
  doc.moveDown(0.9);

  if (rep.totals.total === 0) {
    doc.font('Helvetica').fontSize(12).fillColor(INK).text(
      'Nenhuma inspeção encontrada para o período e filtros selecionados.', left, doc.y, { width },
    );
    rodape();
    doc.end();
    return;
  }

  // ---- KPIs em cartões ----
  const { total, falhas, confMedia } = rep.totals;
  const massaTotalKg = qual ? qual.porTalhao.reduce((a, r) => a + (r.massa_kg ?? 0), 0) : null;
  const volumeTotal = qual ? qual.porTalhao.reduce((a, r) => a + (r.volume_m3 ?? 0), 0) : null;
  const kpis: [string, string, string?][] = [
    ['Inspeções', String(total), '100% das toras, não amostra'],
    ['Taxa de aprovação', pct(total - falhas, total), `${falhas} em contenção/rejeitadas`],
    ['Confiança média da IA', conf(confMedia)],
    ['Massa seca estimada', massaTotalKg != null ? num(massaTotalKg / 1000, 2, ' t') : '—', volumeTotal != null ? `${num(volumeTotal, 2)} m³ medidos` : undefined],
  ];
  const gap = 10;
  const kpiW = (width - gap * (kpis.length - 1)) / kpis.length;
  const kpiH = 58;
  const ky = doc.y;
  kpis.forEach(([label, value, sub], i) => {
    const x = left + i * (kpiW + gap);
    doc.save();
    doc.roundedRect(x, ky, kpiW, kpiH, 6).fillAndStroke(ZEBRA, RULE);
    doc.rect(x, ky, 4, kpiH).fill(JD_GREEN);
    doc.restore();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, x + 12, ky + 9, { width: kpiW - 18, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text(value, x + 12, ky + 21, { width: kpiW - 18, lineBreak: false });
    if (sub) doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(sub, x + 12, ky + 43, { width: kpiW - 18, lineBreak: false });
  });
  doc.y = ky + kpiH + 14;

  // ---- Seções e tabelas ----
  const section = (title: string, sub?: string) => {
    if (doc.y > bottomLimit() - 90) novaPagina();
    doc.moveDown(0.5);
    const y = doc.y;
    doc.save().rect(left, y + 2, 3, 12).fill(JD_YELLOW).restore();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(JD_GREEN_DARK).text(title, left + 10, y, { width: width - 10 });
    if (sub) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(sub, left + 10, doc.y, { width: width - 10 });
    doc.moveDown(0.35);
  };

  const novaPagina = () => {
    doc.addPage();
    drawHeaderBand();
    doc.y = 84;
  };

  // Tabela com larguras relativas, cabeçalho verde, zebra e quebra de página
  // que repete o cabeçalho.
  const table = (
    headers: string[],
    widths: number[],
    rows: string[][],
    aligns: ('left' | 'right')[] = [],
    opts: { colorCol?: number; colors?: (string | null)[] } = {},
  ) => {
    const colX = (i: number) => left + widths.slice(0, i).reduce((a, b) => a + b, 0) * width;
    const colW = (i: number) => widths[i] * width;
    const rowH = (cells: string[], size: number) => {
      doc.fontSize(size);
      return Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: colW(i) - 8 }))) + 7;
    };
    // Cabeçalho + primeira linha juntos: cabeçalho sozinho no pé da página
    // (com as linhas na seguinte) não serve para nada.
    if (rows.length > 0 && doc.y + rowH(headers, 8.5) + rowH(rows[0], 9) > bottomLimit()) novaPagina();
    const drawHeader = () => {
      const h = rowH(headers, 8.5);
      doc.save().rect(left, doc.y, width, h).fill(JD_GREEN).restore();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
      const y = doc.y;
      headers.forEach((c, i) => doc.text(c, colX(i) + 4, y + 3.5, { width: colW(i) - 8, align: aligns[i] ?? 'left', lineBreak: false }));
      doc.y = y + h;
    };
    drawHeader();
    rows.forEach((cells, r) => {
      const h = rowH(cells, 9);
      if (doc.y + h > bottomLimit()) {
        novaPagina();
        drawHeader();
      }
      const y = doc.y;
      if (r % 2 === 1) doc.save().rect(left, y, width, h).fill(ZEBRA).restore();
      cells.forEach((c, i) => {
        const cor = opts.colorCol === i && opts.colors?.[r] ? opts.colors[r]! : INK;
        doc.font(opts.colorCol === i ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(cor);
        doc.text(c, colX(i) + 4, y + 3.5, { width: colW(i) - 8, align: aligns[i] ?? 'left' });
      });
      doc.y = y + h;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.4).strokeColor(RULE).stroke();
    });
    doc.moveDown(0.4);
  };

  // ---- Por classificação ----
  section('Por classificação', 'Aprovada segue para a fábrica; Contenção vai para revisão manual; Rejeitada sai do fluxo.');
  const statusOrder: Status[] = ['aprovado', 'quarentena', 'reprovado'];
  const byStatus = new Map(rep.porStatus.map((r) => [r.status, r]));
  const statusRows = statusOrder.filter((s) => byStatus.has(s));
  table(
    ['Classificação', 'Inspeções', 'Participação', 'Confiança média IA'],
    [0.4, 0.2, 0.2, 0.2],
    statusRows.map((s) => {
      const r = byStatus.get(s)!;
      return [STATUS_LABEL[s], String(r.total), pct(r.total, total), conf(r.confMedia)];
    }),
    ['left', 'right', 'right', 'right'],
    { colorCol: 0, colors: statusRows.map((s) => STATUS_COLOR[s]) },
  );

  // ---- Qualidade da madeira (o que o desafio pede) ----
  if (qual && qual.porTalhao.length > 0) {
    section(
      'Qualidade da madeira por talhão e clone',
      'Casca residual e tortuosidade medidas pela câmera; densidade é referência por clone (proveniência indicada); massa seca = volume medido × densidade.',
    );
    table(
      ['Talhão', 'Clone', 'Toras', 'Casca', 'Tortuos.', 'Diâm.', 'Densid.', 'Proven.', 'Volume', 'Massa'],
      [0.16, 0.1, 0.07, 0.09, 0.12, 0.09, 0.1, 0.1, 0.09, 0.08],
      qual.porTalhao.map((r) => [
        r.talhao ?? '—',
        r.clone ?? '—',
        String(r.toras),
        num(r.casca_media, 1, '%'),
        r.tort_n > 0 ? `${num(r.tort_media, 1, '%')} (n=${r.tort_n})` : 'n/a (seção)',
        num(r.diam_medio, 1, ' cm'),
        num(r.densidade, 0, ' kg/m³'),
        tipoDadoLabel(r.tipo_dado),
        num(r.volume_m3, 2, ' m³'),
        r.massa_kg != null ? num(r.massa_kg / 1000, 2, ' t') : '—',
      ]),
      ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'left', 'right', 'right'],
    );

    // A mesma madeira na unidade da fábrica de celulose (consumo.ts).
    const comConsumo = qual.porTalhao.filter((r) => r.consumo_m3_tsa != null);
    if (comConsumo.length > 0) {
      section(
        'Previsão para a fábrica de celulose',
        'Celulose prevista = massa seca × rendimento depurado ÷ 0,9 (t seca ao ar). Consumo específico teórico = 0,9 ÷ (densidade × rendimento), ' +
          'Foelkel (2017); sem perdas de descascamento, picagem e fibras (industrial: 3,4 a 3,9 m³/tsa, benchmark ABTCP).',
      );
      table(
        ['Talhão', 'Clone', 'Volume', 'Densid.', 'Rend.', 'Proven.', 'Celulose', 'Consumo específico'],
        [0.14, 0.1, 0.09, 0.11, 0.08, 0.13, 0.1, 0.25],
        comConsumo.map((r) => [
          r.talhao ?? '—',
          r.clone ?? '—',
          num(r.volume_m3, 2, ' m³'),
          num(r.densidade, 0, ' kg/m³'),
          num(r.rendimento, 1, '%'),
          tipoDadoLabel(r.consumo_tipo_dado),
          num(r.celulose_t, 2, ' tsa'),
          num(r.consumo_m3_tsa, 2, ' m³/tsa') +
            (r.consumo_min != null && r.consumo_max != null ? ` (${num(r.consumo_min, 2)} a ${num(r.consumo_max, 2)})` : ''),
        ]),
        ['left', 'left', 'right', 'right', 'right', 'left', 'right', 'right'],
      );
    }

    const hist = (titulo: string, faixas: { faixa: string; total: number }[]) => {
      const n = faixas.reduce((a, b) => a + b.total, 0);
      if (n === 0) return;
      if (doc.y > bottomLimit() - 80) novaPagina();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(titulo, left, doc.y, { width });
      doc.moveDown(0.25);
      const maxT = Math.max(...faixas.map((x) => x.total));
      const labelW = 110;
      const barW = width - labelW - 60;
      faixas.forEach((fx) => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(ascii(fx.faixa), left, y + 1, { width: labelW - 6, lineBreak: false });
        const w = maxT > 0 ? (fx.total / maxT) * barW : 0;
        doc.save().rect(left + labelW, y, Math.max(w, 1), 10).fill(w > 0 ? JD_GREEN : RULE).restore();
        doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(`${fx.total} (${pct(fx.total, n)})`, left + labelW + w + 6, y + 1, { lineBreak: false });
        doc.y = y + 14;
      });
      doc.moveDown(0.5);
    };
    hist('Distribuição de casca residual (toras)', qual.casca);
    hist('Distribuição de tortuosidade (só toras vistas de lado)', qual.tortuosidade);
  }

  // ---- Mapa de qualidade + Onde agir ----
  if (mapa && mapa.disponivel && mapa.com_posicao > 0) {
    // Uma página para os mapas: três mapas grandes (um por indicador), como o
    // painel mostra alternando o seletor. Mesma área => o fundo de ruas é
    // baixado uma vez e reaproveitado.
    const mapaH = 172;
    const blocoH = 13 + mapaH + 18; // título + mapa + legenda
    if (doc.y + 40 + blocoH * 3 > bottomLimit()) novaPagina();
    section(
      'Mapa de qualidade',
      `Toras na posição da máquina no corte, agrupadas em zonas de ${mapa.celula_m} m; cada ponto é uma tora. ` +
        `Zona pequena demais para a escala vira bolinha na cor do nível; as do "Onde agir" têm aro escuro e o nome. ` +
        (frota.maquinas.length ? 'O pino vermelho é a máquina (SN) e a linha azul, a rota no período. ' : '') +
        `${mapa.com_posicao} de ${mapa.total} toras do período com posição.`,
    );
    const vista = await prepararVista(mapa, width, mapaH, frota);
    const metricas: Metrica[] = ['casca', 'tort', 'falhas'];
    for (const m of metricas) {
      if (doc.y + blocoH > bottomLimit()) novaPagina();
      const topo = doc.y;
      const [ok, at] = LIMITES[m];
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(METRICA_TITULO[m], left, topo, { width, lineBreak: false });
      desenharMapaPdf(doc, mapa, vista, m, left, topo + 13, width, mapaH, frota);
      // Legenda: os limites que coloriram as zonas.
      const ly = topo + 13 + mapaH + 4;
      const faixas: [Nivel, string][] =
        m === 'tort'
          ? [['ok', `< ${ok}%`], ['atencao', `${ok}-${at}%`], ['critico', `>= ${at}%`], ['sem', 'sem medida']]
          : [['ok', `<= ${ok}%`], ['atencao', `${ok}-${at}%`], ['critico', `> ${at}%`], ['sem', 'sem medida']];
      let lx = left;
      for (const [nv, rot] of faixas) {
        doc.save().fillOpacity(nv === 'sem' ? 0.3 : 1).rect(lx, ly + 1, 7, 7).fill(NIVEL_COR[nv]).restore();
        doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(rot, lx + 10, ly + 0.5, { lineBreak: false });
        lx += 10 + doc.widthOfString(rot) + 10;
      }
      // Símbolos: zona do "Onde agir", máquina e rota (só os que aparecem).
      const legenda = (desenhar: () => void, rot: string) => {
        desenhar();
        doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(rot, lx + 11, ly + 0.5, { lineBreak: false });
        lx += 11 + doc.widthOfString(rot) + 10;
      };
      if (mapa.alertas.some((a) => a.metrica === m)) {
        legenda(() => doc.save().lineWidth(1.4).circle(lx + 4, ly + 4.5, 3.4).fillAndStroke(NIVEL_COR.critico, INK).restore(), 'zona do Onde agir');
      }
      if (frota.maquinas.length) legenda(() => desenharPino(doc, lx + 4, ly + 9.5, 10), 'máquina (SN)');
      if (frota.trajetos.length) {
        legenda(() => doc.save().lineWidth(1.8).strokeColor(COR_ROTA).moveTo(lx, ly + 4.5).lineTo(lx + 8, ly + 4.5).stroke().restore(), 'rota');
      }
      doc.y = topo + blocoH;
    }
    if (vista.tiles.length === 0) {
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
        'Mapa de ruas não incluído: o servidor não alcançou o OpenStreetMap ao gerar este relatório. Zonas, toras e valores estão completos.',
        left, doc.y, { width },
      );
      doc.moveDown(0.3);
    }

    const fontes = mapa.fontes
      .map((fo) => `${FONTE_POSICAO_LABEL[fo.fonte] ?? fo.fonte} (${fo.toras})`)
      .join('; ');
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
      `Posição: ${fontes}. É a posição da MÁQUINA no corte; a árvore está no alcance da grua (~10 m), além do erro da própria fonte.`,
      left, doc.y, { width },
    );
    doc.moveDown(0.6);

    // Título + cabeçalho + ao menos duas linhas juntos: sem isso o título
    // ficava sozinho no pé da página e a tabela começava na seguinte.
    if (doc.y > bottomLimit() - 80) novaPagina();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Onde agir', left, doc.y, { width });
    doc.moveDown(0.25);
    if (mapa.alertas.length === 0) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
        `Nenhuma zona acima dos limites no período (mínimo de ${mapa.min_toras_alerta} toras por zona).`,
        left, doc.y, { width },
      );
      doc.moveDown(0.5);
    } else {
      table(
        ['Zona', 'Indicador', 'Valor', 'Toras', 'Limite', 'Ação recomendada'],
        [0.07, 0.13, 0.09, 0.08, 0.08, 0.55],
        mapa.alertas.map((a) => [
          a.zona,
          METRICA_TITULO[a.metrica],
          num(a.valor, a.metrica === 'falhas' ? 0 : 1, '%'),
          String(a.n),
          `${a.limite}%`,
          a.acao,
        ]),
        ['left', 'left', 'right', 'right', 'right', 'left'],
        { colorCol: 2, colors: mapa.alertas.map((a) => NIVEL_COR[a.nivel]) },
      );
    }
  }

  // ---- Por máquina ----
  section('Por máquina');
  table(
    ['Máquina', 'Nº de série', 'Inspeções', 'Falhas', 'Taxa de falha'],
    [0.3, 0.28, 0.14, 0.14, 0.14],
    rep.porMaquina.map((m) => [m.modelo ?? '—', m.numero_serie ?? '—', String(m.total), String(m.falhas), pct(m.falhas, m.total)]),
    ['left', 'left', 'right', 'right', 'right'],
  );

  // ---- Por talhão ----
  section('Por talhão');
  table(
    ['Talhão', 'Inspeções', 'Falhas', 'Taxa de falha'],
    [0.46, 0.18, 0.18, 0.18],
    rep.porTalhao.map((t) => [t.nome ?? '—', String(t.total), String(t.falhas), pct(t.falhas, t.total)]),
    ['left', 'right', 'right', 'right'],
  );

  // ---- Padrão temporal das falhas ----
  section('Padrão temporal das falhas', 'Concentração por dia da semana e horário — sinal de turno, fadiga ou troca de talhão.');
  table(
    ['Dia da semana', 'Inspeções', 'Falhas', 'Taxa de falha'],
    [0.46, 0.18, 0.18, 0.18],
    rep.porDow.map((d) => [DOW_LABEL[d.dow] ?? String(d.dow), String(d.total), String(d.falhas), pct(d.falhas, d.total)]),
    ['left', 'right', 'right', 'right'],
  );
  if (rep.topHoras.length > 0) {
    if (doc.y > bottomLimit() - 70) novaPagina(); // título junto da tabela
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Top 5 horários com mais falhas', left, doc.y, { width });
    doc.moveDown(0.25);
    table(
      ['Horário', 'Falhas'],
      [0.5, 0.5],
      rep.topHoras.map((h) => [`${String(h.hora).padStart(2, '0')}:00 – ${String(h.hora).padStart(2, '0')}:59`, String(h.falhas)]),
      ['left', 'right'],
    );
  }

  // ---- Nota metodológica (curta, honesta) ----
  if (doc.y > bottomLimit() - 60) novaPagina();
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
    'Nota: casca residual, tortuosidade, diâmetro e defeitos são medidos por visão computacional na máquina. ' +
      'Densidade básica vem do cadastro por clone (fonte de verdade no banco central) e a massa seca herda a incerteza dessa referência — é estimativa, não pesagem. ' +
      'O rendimento depurado também é referência por clone; a proveniência do consumo específico é a menos confiável entre densidade e rendimento. ' +
      'Na vista de seção o comprimento usa o traçamento configurado do talhão.',
    left, doc.y, { width, align: 'justify' },
  );

  rodape();
  doc.end();

  // Rodapé em todas as páginas. Zera a margem inferior enquanto escreve para
  // o pdfkit não abrir uma página em branco no fim.
  function rodape() {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const margemInferior = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.moveTo(left, doc.page.height - 34).lineTo(right, doc.page.height - 34).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
        `Omni-Root · gerado automaticamente a partir do banco central — página ${i + 1} de ${range.count}`,
        left, doc.page.height - 28, { width, align: 'center', lineBreak: false },
      );
      doc.page.margins.bottom = margemInferior;
    }
  }
}
