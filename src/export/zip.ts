/**
 * Minimal ZIP writer (PKWARE APPNOTE 6.3): local headers, central directory, end record.
 * No ZIP64, so the archive must stay below 4 GiB and 65535 entries — far above what a
 * browser-generated workbook reaches.
 */

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

let crcTable: Uint32Array | undefined;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 (IEEE 802.3, reflected), as required for every ZIP entry. */
export function crc32(data: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time in local time; the format cannot represent years before 1980. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const STORE = 0;
const DEFLATE = 8;
// Bit 11: file names are UTF-8.
const FLAG_UTF8 = 0x0800;

interface Prepared {
  name: Uint8Array;
  crc: number;
  size: number;
  method: number;
  payload: Uint8Array;
}

function writeZip(items: Prepared[], modified: Date): Uint8Array {
  if (items.length > 0xffff) throw new RangeError('Too many ZIP entries');
  const { time, date } = dosDateTime(modified);
  let localSize = 0;
  let centralSize = 0;
  for (const it of items) {
    localSize += 30 + it.name.length + it.payload.length;
    centralSize += 46 + it.name.length;
  }
  if (localSize + centralSize + 22 > 0xffffffff) throw new RangeError('ZIP archive too large (no ZIP64 support)');
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let p = 0;
  const u16 = (v: number) => (view.setUint16(p, v, true), (p += 2));
  const u32 = (v: number) => (view.setUint32(p, v >>> 0, true), (p += 4));

  for (const it of items) {
    offsets.push(p);
    u32(0x04034b50);
    u16(20); // version needed: 2.0 (deflate)
    u16(FLAG_UTF8);
    u16(it.method);
    u16(time);
    u16(date);
    u32(it.crc);
    u32(it.payload.length);
    u32(it.size);
    u16(it.name.length);
    u16(0);
    out.set(it.name, p);
    p += it.name.length;
    out.set(it.payload, p);
    p += it.payload.length;
  }
  const centralStart = p;
  items.forEach((it, i) => {
    u32(0x02014b50);
    u16(20); // version made by: MS-DOS attributes, spec 2.0
    u16(20);
    u16(FLAG_UTF8);
    u16(it.method);
    u16(time);
    u16(date);
    u32(it.crc);
    u32(it.payload.length);
    u32(it.size);
    u16(it.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]);
    out.set(it.name, p);
    p += it.name.length;
  });
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(items.length);
  u16(items.length);
  u32(centralSize);
  u32(centralStart);
  u16(0);
  return out;
}

const encoder = new TextEncoder();

/** Builds an uncompressed (STORE) archive synchronously. */
export function zipStore(entries: ZipEntry[], modified = new Date()): Uint8Array {
  return writeZip(
    entries.map((e) => ({ name: encoder.encode(e.path), crc: crc32(e.data), size: e.data.length, method: STORE, payload: e.data })),
    modified,
  );
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const canDeflate = (): boolean => typeof CompressionStream === 'function';

/**
 * Builds a DEFLATE archive with the platform CompressionStream (it is async-only, hence a
 * separate function). Falls back to STORE per entry when compression is unavailable or does
 * not shrink the data.
 */
export async function zipDeflate(entries: ZipEntry[], modified = new Date()): Promise<Uint8Array> {
  const useDeflate = canDeflate();
  const items: Prepared[] = [];
  for (const e of entries) {
    let payload = e.data;
    let method = STORE;
    if (useDeflate && e.data.length > 0) {
      try {
        const packed = await deflateRaw(e.data);
        if (packed.length < e.data.length) (payload = packed), (method = DEFLATE);
      } catch {
        // 'deflate-raw' is missing on some older engines; STORE is still a valid entry.
      }
    }
    items.push({ name: encoder.encode(e.path), crc: crc32(e.data), size: e.data.length, method, payload });
  }
  return writeZip(items, modified);
}
