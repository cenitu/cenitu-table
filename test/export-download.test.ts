import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSV_MIME, downloadBlob, XLSX_MIME } from '../src/export';

describe('downloadBlob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clicks a temporary link to an object URL and revokes it afterwards', async () => {
    const blobs: Blob[] = [];
    // jsdom lacks object URLs.
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), 'blob:test'));
    URL.revokeObjectURL = vi.fn();
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });

    downloadBlob('a,b', 'x.csv', CSV_MIME);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe('x.csv');
    expect(clicks[0].href).toBe('blob:test');
    expect(clicks[0].isConnected).toBe(false);
    expect(blobs[0].type).toBe(CSV_MIME);
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.readAsText(blobs[0]);
    });
    expect(text).toBe('a,b');

    downloadBlob(new Uint8Array([1, 2, 3]), 'y.xlsx', XLSX_MIME);
    expect(blobs[1].size).toBe(3);
    await new Promise((r) => setTimeout(r, 5));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
