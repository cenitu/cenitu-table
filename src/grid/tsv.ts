/** Tab-separated text, the clipboard format used by Excel and Google Sheets. */

export function toTSV(rows: string[][]): string {
  return rows
    .map((row) => row.map((v) => (/[\t\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join('\t'))
    .join('\n');
}

export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  const src = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');

  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' && cell === '') {
      // Quoted cell: may contain tabs, newlines and doubled quotes.
      const end = findClosingQuote(src, i + 1);
      if (end !== -1 && (end + 1 === src.length || src[end + 1] === '\t' || src[end + 1] === '\n')) {
        cell = src.slice(i + 1, end).replace(/""/g, '"');
        i = end + 1;
        continue;
      }
    }
    if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
    i++;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function findClosingQuote(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] !== '"') continue;
    if (src[i + 1] === '"') {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}
