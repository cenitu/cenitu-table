export const CSV_MIME = 'text/csv;charset=utf-8';

/** Saves data as a file in the browser via a temporary object URL and a synthetic link click. */
export function downloadBlob(data: Uint8Array | string, fileName: string, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
