/**
 * Streaming XML scanner for package parts. Namespace prefixes are dropped from element and
 * attribute names (`x:row` -> `row`), which is what spreadsheet parts need. DOCTYPE declarations
 * are skipped and only the predefined and numeric entities are decoded, so a crafted file cannot
 * expand entities or reach external resources.
 */

export type XmlAttrs = Record<string, string>;

export interface XmlHandler {
  open?(name: string, attrs: XmlAttrs, selfClosing: boolean): void;
  close?(name: string): void;
  text?(text: string): void;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, body: string) => {
    if (body[0] !== '#') return NAMED[body] ?? whole;
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const localName = (name: string): string => {
  const i = name.indexOf(':');
  return i < 0 ? name : name.slice(i + 1);
};

const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(s: string): XmlAttrs {
  const out: XmlAttrs = {};
  ATTR.lastIndex = 0;
  for (let m = ATTR.exec(s); m; m = ATTR.exec(s)) {
    if (!m[1].startsWith('xmlns')) out[localName(m[1])] = decodeEntities(m[2] ?? m[3]);
  }
  return out;
}

/** End of the tag starting at `from`; '>' inside quoted attribute values does not count. */
function tagEnd(xml: string, from: number): number {
  let quote = '';
  for (let i = from; i < xml.length; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

const after = (xml: string, marker: string, from: number): number => {
  const i = xml.indexOf(marker, from);
  if (i < 0) throw new Error('Malformed XML');
  return i + marker.length;
};

/** Reports elements and text in document order; throws on an unterminated construct. */
export function scanXml(xml: string, h: XmlHandler): void {
  let p = 0;
  while (p < xml.length) {
    const lt = xml.indexOf('<', p);
    if (lt < 0) {
      if (h.text && p < xml.length) h.text(decodeEntities(xml.slice(p)));
      return;
    }
    if (lt > p && h.text) h.text(decodeEntities(xml.slice(p, lt)));
    if (xml.startsWith('<?', lt)) p = after(xml, '?>', lt);
    else if (xml.startsWith('<!--', lt)) p = after(xml, '-->', lt);
    else if (xml.startsWith('<![CDATA[', lt)) {
      p = after(xml, ']]>', lt);
      h.text?.(xml.slice(lt + 9, p - 3));
    } else if (xml.startsWith('<!', lt)) {
      p = skipDoctype(xml, lt);
    } else {
      const end = tagEnd(xml, lt);
      if (end < 0) throw new Error('Malformed XML');
      p = end + 1;
      if (xml[lt + 1] === '/') {
        h.close?.(localName(xml.slice(lt + 2, end).trim()));
        continue;
      }
      const selfClosing = xml[end - 1] === '/';
      const body = xml.slice(lt + 1, selfClosing ? end - 1 : end);
      const space = body.search(/\s/);
      const name = localName(space < 0 ? body : body.slice(0, space));
      h.open?.(name, space >= 0 ? parseAttrs(body.slice(space)) : {}, selfClosing);
      if (selfClosing) h.close?.(name);
    }
  }
}

function skipDoctype(xml: string, from: number): number {
  let depth = 0;
  for (let i = from; i < xml.length; i++) {
    if (xml[i] === '[') depth++;
    else if (xml[i] === ']') depth--;
    else if (xml[i] === '>' && depth === 0) return i + 1;
  }
  throw new Error('Malformed XML');
}
