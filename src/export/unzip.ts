import { crc32 } from './zip';

/**
 * Minimal ZIP reader (PKWARE APPNOTE 6.3), enough for spreadsheet packages: finds entries through
 * the central directory and inflates them with the platform DecompressionStream. No ZIP64 and no
 * encryption. Sizes are enforced while inflating, so a crafted archive cannot exhaust memory.
 */

export interface UnzipOptions {
  /** Upper limit for the total uncompressed size in bytes (default 1 GiB). */
  maxSize?: number;
}

const STORE = 0;
const DEFLATE = 8;
const FLAG_ENCRYPTED = 1;
const EOCD_SIZE = 22;
const DEFAULT_MAX_SIZE = 1024 ** 3;

interface CentralEntry {
  path: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  headerOffset: number;
}

function findEndRecord(view: DataView): number {
  // The end record is followed only by an optional comment of at most 65535 bytes.
  const lowest = Math.max(0, view.byteLength - EOCD_SIZE - 0xffff);
  for (let p = view.byteLength - EOCD_SIZE; p >= lowest; p--) {
    if (view.getUint32(p, true) === 0x06054b50) return p;
  }
  throw new Error('Not a ZIP archive');
}

function readDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < EOCD_SIZE) throw new Error('Not a ZIP archive');
  const end = findEndRecord(view);
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const names = new TextDecoder();
  const entries: CentralEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
    const nameLength = view.getUint16(p + 28, true);
    entries.push({
      path: names.decode(bytes.subarray(p + 46, p + 46 + nameLength)),
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      crc: view.getUint32(p + 16, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      headerOffset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
}

function payloadOf(bytes: Uint8Array, e: CentralEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = e.headerOffset;
  if (h + 30 > bytes.length || view.getUint32(h, true) !== 0x04034b50) throw new Error(`Corrupt ZIP entry: ${e.path}`);
  const start = h + 30 + view.getUint16(h + 26, true) + view.getUint16(h + 28, true);
  if (start + e.compressedSize > bytes.length) throw new Error(`Corrupt ZIP entry: ${e.path}`);
  return bytes.subarray(start, start + e.compressedSize);
}

async function inflateRaw(data: Uint8Array, limit: number, path: string): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') throw new Error('This environment cannot decompress ZIP entries');
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new RangeError(`ZIP entry too large: ${path}`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Lists a package and gives access to its entries by path. */
export class ZipReader {
  private readonly entries = new Map<string, CentralEntry>();
  private remaining: number;

  constructor(private readonly bytes: Uint8Array, opts: UnzipOptions = {}) {
    this.remaining = opts.maxSize ?? DEFAULT_MAX_SIZE;
    for (const e of readDirectory(bytes)) this.entries.set(e.path, e);
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  get paths(): string[] {
    return [...this.entries.keys()];
  }

  /** Uncompressed content of an entry; undefined when the package has no such entry. */
  async read(path: string): Promise<Uint8Array | undefined> {
    const e = this.entries.get(path);
    if (!e) return undefined;
    if (e.flags & FLAG_ENCRYPTED) throw new Error('Encrypted packages are not supported');
    if (e.method !== STORE && e.method !== DEFLATE) throw new Error(`Unsupported ZIP compression: ${e.method}`);
    const payload = payloadOf(this.bytes, e);
    const data = e.method === STORE ? payload : await inflateRaw(payload, this.remaining, path);
    if (data.length > this.remaining) throw new RangeError(`ZIP entry too large: ${path}`);
    if (crc32(data) !== e.crc) throw new Error(`ZIP checksum mismatch: ${path}`);
    this.remaining -= data.length;
    return data;
  }

  async readText(path: string): Promise<string | undefined> {
    const data = await this.read(path);
    return data && new TextDecoder().decode(data);
  }
}
