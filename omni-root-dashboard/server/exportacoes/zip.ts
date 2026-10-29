// Escritor de ZIP mínimo (sem dependência externa). Suficiente para empacotar
// os .hpr do Export StanForD: usa DEFLATE via zlib + CRC32 próprio, monta os
// cabeçalhos locais, o diretório central e o EOCD à mão.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function makeZip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data);
    const useDeflate = deflated.length < e.data.length;
    const method = useDeflate ? 8 : 0; // 8 = DEFLATE, 0 = STORE
    const body = useDeflate ? deflated : e.data;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // assinatura local file header
    lfh.writeUInt16LE(20, 4); // versão necessária
    lfh.writeUInt16LE(0x0800, 6); // flag: nome em UTF-8
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10); // hora
    lfh.writeUInt16LE(0x21, 12); // data (1980-01-01, válida)
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(body.length, 18); // tamanho comprimido
    lfh.writeUInt32LE(e.data.length, 22); // tamanho original
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra
    local.push(lfh, nameBuf, body);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // assinatura central directory
    cdh.writeUInt16LE(20, 4); // versão que criou
    cdh.writeUInt16LE(20, 6); // versão necessária
    cdh.writeUInt16LE(0x0800, 8); // flag UTF-8
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0x21, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(body.length, 20);
    cdh.writeUInt32LE(e.data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra
    cdh.writeUInt16LE(0, 32); // comentário
    cdh.writeUInt16LE(0, 34); // disco
    cdh.writeUInt16LE(0, 36); // atributos internos
    cdh.writeUInt32LE(0, 38); // atributos externos
    cdh.writeUInt32LE(offset, 42); // deslocamento do header local
    central.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // assinatura EOCD
  eocd.writeUInt16LE(0, 4); // disco
  eocd.writeUInt16LE(0, 6); // disco do início do CD
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comentário

  return Buffer.concat([...local, centralBuf, eocd]);
}
