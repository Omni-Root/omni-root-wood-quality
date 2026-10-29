// Export StanForD — gera um arquivo .hpr (Harvested Production Report) no
// padrão StanForD 2010 por máquina, empacotados num ZIP. Cada tora inspecionada
// vira um <Stem> com <Log>/<LogMeasurement>, um <StemGrade> (OK / REVISAO_MANUAL
// / REJEITADO a partir do status) e os indicadores da IA + defeitos do YOLO em
// <UserDefinedData> (mecanismo oficial DataTableGroup/DataTable/Row/ColumnData).
//
// Estrutura baseada na documentação pública da Skogforsk (StanForD 2010). NÃO é
// validada contra o XSD oficial — não declarar como "certificado StanForD".
import type express from 'express';
import { getStanfordDataset, type StanfordIndicador, type StanfordDefeito, type StanfordStem } from '../consultas/exportacao.js';
import { type Filters } from '../consultas/filtros.js';
import { STATUS_STANFORD } from './rotulos.js';
import { makeZip, type ZipEntry } from './zip.js';

const NS = 'urn:skogforsk:stanford2010:HarvestedProduction:v3p0';

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function num(v: number, decimals = 2): string {
  return v.toFixed(decimals);
}
function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_') || 'maquina';
}

function indicadorValor(inds: StanfordIndicador[], tipo: string): number | null {
  const found = inds.find((i) => i.tipo_indicador === tipo);
  return found ? found.valor : null;
}

// O StanForD expressa diâmetro/comprimento em MILÍMETROS. O pipeline grava
// esses indicadores em cm (main.py), mas outras origens podem usar mm ou m —
// então a conversão respeita a unidade gravada junto com o valor, em vez de
// assumir uma só.
function indicadorEmMm(inds: StanfordIndicador[], tipo: string): number | null {
  const found = inds.find((i) => i.tipo_indicador === tipo);
  if (!found) return null;
  switch ((found.unidade ?? '').toLowerCase()) {
    case 'mm':
      return found.valor;
    case 'cm':
      return found.valor * 10;
    case 'm':
      return found.valor * 1000;
    default:
      return found.valor;
  }
}

function stemXml(
  stem: StanfordStem,
  stemNumber: number,
  inds: StanfordIndicador[],
  defs: StanfordDefeito[],
): string {
  const grade = STATUS_STANFORD[stem.status];
  const diametroMm = indicadorEmMm(inds, 'diametro'); // DBH / diâmetro do log (mm)
  const alturaMm = indicadorEmMm(inds, 'altura'); // comprimento visível (mm)
  const volume = indicadorValor(inds, 'volume_util'); // m3, sem conversão

  const parts: string[] = [];
  parts.push('    <Stem>');
  parts.push(`      <StemKey>${stem.id}</StemKey>`);
  parts.push(`      <StemNumber>${stemNumber}</StemNumber>`);
  parts.push('      <SpeciesGroupKey>1</SpeciesGroupKey>');
  parts.push(`      <StemGrade>${grade.code}</StemGrade>`);
  parts.push('      <SingleTreeProcessedStem>');
  if (diametroMm != null) parts.push(`        <DBH>${num(diametroMm, 0)}</DBH>`);
  parts.push('        <Log>');
  parts.push('          <LogKey>1</LogKey>');
  if (volume != null) {
    parts.push(`          <LogVolume logVolumeCategory="m3sub">${num(volume, 4)}</LogVolume>`);
  }
  parts.push('          <LogMeasurement logMeasurementCategory="1">');
  if (diametroMm != null) {
    parts.push(`            <LogDiameter diameterCategory="ob">${num(diametroMm, 0)}</LogDiameter>`);
  }
  if (alturaMm != null) {
    parts.push(`            <LogLength>${num(alturaMm, 0)}</LogLength>`);
  }
  parts.push('          </LogMeasurement>');
  parts.push('        </Log>');
  parts.push('      </SingleTreeProcessedStem>');

  // Indicadores da IA + defeitos do YOLO no mecanismo oficial de dados livres.
  parts.push('      <UserDefinedData>');
  parts.push('        <DataTableGroup>');
  parts.push('          <DataTableGroupKey>1</DataTableGroupKey>');
  parts.push('          <DataTableGroupName>OmniRoot-IA</DataTableGroupName>');

  // Metadados da tora (uuid, log_id, confiança da IA, status, hash).
  parts.push('          <DataTable>');
  parts.push('            <DataTableKey>1</DataTableKey>');
  parts.push('            <DataTableName>InspecaoIA</DataTableName>');
  const metaCols: [string, string][] = [
    ['uuid_local', stem.uuid_local],
    ['log_id', stem.log_id],
    ['data_inspecao', stem.data],
    ['confianca_ia', num(stem.confianca, 4)],
    ['status', grade.text],
    ['hash_sha256', stem.hash_sha256],
  ];
  metaCols.forEach(([name, val], i) => {
    parts.push(
      `            <Row><RowKey>${i + 1}</RowKey>` +
        `<ColumnName>${esc(name)}</ColumnName>` +
        `<ColumnData>${esc(val)}</ColumnData></Row>`,
    );
  });
  parts.push('          </DataTable>');

  // Posição da máquina no corte (WGS84, graus decimais) — tabela própria no
  // mecanismo de dados livres. NÃO usamos um elemento nativo de coordenada do
  // StanForD porque não conferimos o nome/formato dele contra o XSD oficial.
  if (stem.pos_lat != null && stem.pos_lon != null) {
    parts.push('          <DataTable>');
    parts.push('            <DataTableKey>4</DataTableKey>');
    parts.push('            <DataTableName>PosicaoMaquina</DataTableName>');
    const posCols: [string, string][] = [
      ['latitude_wgs84', Number(stem.pos_lat).toFixed(7)],
      ['longitude_wgs84', Number(stem.pos_lon).toFixed(7)],
      ['referencia', 'posicao da maquina no corte; arvore no alcance da grua'],
      ['fonte', stem.pos_fonte ?? ''],
    ];
    if (stem.pos_hdop != null) posCols.push(['hdop', Number(stem.pos_hdop).toFixed(1)]);
    if (stem.pos_satelites != null) posCols.push(['satelites', String(stem.pos_satelites)]);
    if (stem.pos_precisao_m != null) posCols.push(['precisao_m', Number(stem.pos_precisao_m).toFixed(1)]);
    posCols.forEach(([name, val], i) => {
      parts.push(
        `            <Row><RowKey>${i + 1}</RowKey>` +
          `<ColumnName>${esc(name)}</ColumnName>` +
          `<ColumnData>${esc(val)}</ColumnData></Row>`,
      );
    });
    parts.push('          </DataTable>');
  }

  // Todos os indicadores medidos.
  if (inds.length > 0) {
    parts.push('          <DataTable>');
    parts.push('            <DataTableKey>2</DataTableKey>');
    parts.push('            <DataTableName>IndicadoresQualidade</DataTableName>');
    inds.forEach((ind, i) => {
      parts.push(
        `            <Row><RowKey>${i + 1}</RowKey>` +
          `<ColumnName>${esc(ind.tipo_indicador)}</ColumnName>` +
          `<ColumnData>${num(ind.valor, 4)}</ColumnData>` +
          `<ColumnData>${esc(ind.unidade ?? '')}</ColumnData>` +
          `<ColumnData>${esc(ind.metodo_medicao)}</ColumnData></Row>`,
      );
    });
    parts.push('          </DataTable>');
  }

  // Defeitos detectados pelo YOLO (bounding boxes).
  if (defs.length > 0) {
    parts.push('          <DataTable>');
    parts.push('            <DataTableKey>3</DataTableKey>');
    parts.push('            <DataTableName>DefeitosYOLO</DataTableName>');
    defs.forEach((d, i) => {
      parts.push(
        `            <Row><RowKey>${i + 1}</RowKey>` +
          `<ColumnName>${esc(d.tipo_defeito)}</ColumnName>` +
          `<ColumnData>${num(d.pos_x, 2)}</ColumnData>` +
          `<ColumnData>${num(d.pos_y, 2)}</ColumnData>` +
          `<ColumnData>${num(d.largura, 2)}</ColumnData>` +
          `<ColumnData>${num(d.altura, 2)}</ColumnData>` +
          `<ColumnData>${num(d.confianca, 4)}</ColumnData></Row>`,
      );
    });
    parts.push('          </DataTable>');
  }

  parts.push('        </DataTableGroup>');
  parts.push('      </UserDefinedData>');
  parts.push('    </Stem>');
  return parts.join('\n');
}

export async function buildStanfordZip(f: Filters): Promise<Buffer> {
  const ds = await getStanfordDataset(f);
  const now = new Date().toISOString().slice(0, 19);

  if (ds.machines.length === 0) {
    return makeZip([
      {
        name: 'SEM_DADOS.txt',
        data: Buffer.from(
          `Nenhuma inspeção encontrada para o período ${f.from} a ${f.to}` +
            (f.maquinaId ? ` (máquina #${f.maquinaId}).` : '.'),
          'utf8',
        ),
      },
    ]);
  }

  // Agrupa as toras por máquina (já vêm ordenadas por maquina_id, id).
  const stemsByMachine = new Map<number, StanfordStem[]>();
  for (const s of ds.stems) {
    const list = stemsByMachine.get(s.maquina_id) ?? [];
    list.push(s);
    stemsByMachine.set(s.maquina_id, list);
  }

  const entries: ZipEntry[] = [];
  for (const m of ds.machines) {
    const stems = stemsByMachine.get(m.id) ?? [];
    const talhao = stems.find((s) => s.talhao_nome)?.talhao_nome ?? 'Talhão';
    const especie = stems.find((s) => s.talhao_especie)?.talhao_especie ?? 'Eucalipto';

    const xml: string[] = [];
    xml.push('<?xml version="1.0" encoding="UTF-8"?>');
    xml.push(
      `<HarvestedProduction xmlns="${NS}" ` +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
        `CreationDate="${now}">`,
    );
    xml.push('  <MachineReportHeader>');
    xml.push(`    <ModificationDate>${now}</ModificationDate>`);
    xml.push('    <CountryCode>76</CountryCode>');
    xml.push('    <BaseMachineManufacturer>John Deere</BaseMachineManufacturer>');
    xml.push(`    <BaseMachineModel>${esc(m.modelo)}</BaseMachineModel>`);
    xml.push(`    <BaseMachineNumber>${esc(m.numero_serie)}</BaseMachineNumber>`);
    xml.push(`    <BaseMachineID>${m.id}</BaseMachineID>`);
    xml.push(
      '    <CreationSource>OmniRoot Dashboard - Export StanForD 2010 (.hpr)</CreationSource>',
    );
    xml.push('  </MachineReportHeader>');
    xml.push('  <Machine>');
    xml.push(`    <MachineKey>${m.id}</MachineKey>`);
    xml.push('    <ObjectDefinition>');
    xml.push('      <ObjectKey>1</ObjectKey>');
    xml.push(`      <ObjectName>${esc(talhao)}</ObjectName>`);
    xml.push('    </ObjectDefinition>');
    xml.push('    <SpeciesGroupDefinition>');
    xml.push('      <SpeciesGroupKey>1</SpeciesGroupKey>');
    xml.push(`      <SpeciesGroupName>${esc(especie)}</SpeciesGroupName>`);
    xml.push('    </SpeciesGroupDefinition>');

    stems.forEach((s, i) => {
      xml.push(stemXml(s, i + 1, ds.indicadores.get(s.id) ?? [], ds.defeitos.get(s.id) ?? []));
    });

    xml.push('  </Machine>');
    xml.push('</HarvestedProduction>');

    entries.push({
      name: `${safeName(m.numero_serie)}.hpr`,
      data: Buffer.from(xml.join('\n'), 'utf8'),
    });
  }

  return makeZip(entries);
}

export async function streamStanford(f: Filters, res: express.Response): Promise<void> {
  const zip = await buildStanfordZip(f);
  const filename = `stanford_${f.from}_a_${f.to}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(zip.length));
  res.end(zip);
}
