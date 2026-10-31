// HTML cleaning keeps markup and protected element content byte-exact while
// applying the text cleaners to ordinary text nodes.
import { clean, stripInvisible, cleanConservative } from './index.mjs';

const ENTITY_POINTS = new Set([
  0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x00AD,
  0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C,
  0x202D, 0x202E, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xFEFF,
]);
const NAMED = {
  mdash: 0x2014, ndash: 0x2013, hellip: 0x2026, lsquo: 0x2018,
  rsquo: 0x2019, ldquo: 0x201C, rdquo: 0x201D, shy: 0x00AD,
  zwsp: 0x200B, ZeroWidthSpace: 0x200B, zwj: 0x200D, zwnj: 0x200C,
  lrm: 0x200E, rlm: 0x200F,
};
const DECODE_RE = /&(?:mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|shy|zwsp|ZeroWidthSpace|zwj|zwnj|lrm|rlm|#\d+|#x[0-9A-Fa-f]+);/g;
const BLOCK_RAW = new Set(['script', 'style', 'textarea']);
const NESTED_RAW = new Set(['pre', 'code', 'kbd', 'samp']);

function cleanerFor(mode) {
  if (mode === 'clean') return clean;
  if (mode === 'strip') return stripInvisible;
  if (mode === 'conservative') return cleanConservative;
  throw new TypeError(`unknown HTML cleaning mode: ${mode}`);
}

function decodeSelected(text) {
  return text.replace(DECODE_RE, (entity) => {
    let point;
    if (entity[1] !== '#') point = NAMED[entity.slice(1, -1)];
    else if (entity[2].toLowerCase() === 'x') point = parseInt(entity.slice(3, -1), 16);
    else point = parseInt(entity.slice(2, -1), 10);
    return ENTITY_POINTS.has(point) ? String.fromCharCode(point) : entity;
  });
}

function markupEnd(html, start) {
  if (html.startsWith('<!' + '-' + '-', start)) {
    const end = html.indexOf('-' + '->', start + 4);
    return end < 0 ? html.length : end + 3;
  }
  if (html.startsWith('<![CDATA[', start)) {
    const end = html.indexOf(']]>', start + 9);
    return end < 0 ? html.length : end + 3;
  }
  if (html.startsWith('<?', start)) {
    const end = html.indexOf('?>', start + 2);
    return end < 0 ? html.length : end + 2;
  }
  let quote = '';
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i + 1;
  }
  return html.length;
}

const MARKUP_START_RE = /<(?:!|\?|\/?\s*[A-Za-z])/g;

function nextMarkup(html, start) {
  MARKUP_START_RE.lastIndex = start;
  const match = MARKUP_START_RE.exec(html);
  return match ? match.index : -1;
}

function tagInfo(markup) {
  const match = /^<(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(markup);
  if (!match) return null;
  return {
    closing: match[1] === '/',
    name: match[2].toLowerCase(),
    selfClosing: /\/\s*>$/.test(markup),
  };
}

export function cleanHtml(html, opts = {}) {
  if (html == null) return html;
  const text = String(html);
  const cleaner = cleanerFor(opts.mode == null ? 'clean' : opts.mode);
  let output = '';
  let position = 0;
  let protectedDepth = 0;
  while (position < text.length) {
    const open = nextMarkup(text, position);
    const textEnd = open < 0 ? text.length : open;
    const segment = text.slice(position, textEnd);
    output += protectedDepth ? segment : cleaner(decodeSelected(segment));
    if (open < 0) break;
    const end = markupEnd(text, open);
    const markup = text.slice(open, end);
    const info = tagInfo(markup);
    output += markup;
    position = end;
    if (!info) continue;
    if (!info.closing && BLOCK_RAW.has(info.name) && !info.selfClosing) {
      const closeRe = new RegExp('<\\/\\s*' + info.name + '\\s*>', 'ig');
      closeRe.lastIndex = position;
      const close = closeRe.exec(text);
      if (!close) {
        output += text.slice(position);
        break;
      }
      output += text.slice(position, close.index + close[0].length);
      position = close.index + close[0].length;
    } else if (NESTED_RAW.has(info.name)) {
      if (info.closing) protectedDepth = Math.max(0, protectedDepth - 1);
      else if (!info.selfClosing) protectedDepth++;
    }
  }
  return output;
}
