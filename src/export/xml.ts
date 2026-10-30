// XML 1.0 forbids most C0 controls and lone surrogates even when escaped; a single one makes the
// whole part unreadable, so they are dropped rather than escaped.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** Escapes text for use in element content and double-quoted attributes. */
export function escapeXml(text: string): string {
  return text.replace(INVALID_XML, '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Attribute list helper: skips undefined/false values. */
export function attrs(a: Record<string, string | number | boolean | undefined>): string {
  let s = '';
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === false) continue;
    s += ` ${k}="${v === true ? '1' : escapeXml(String(v))}"`;
  }
  return s;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
