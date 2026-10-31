// DOCX text cleaning and extraction. Only Word text nodes are changed;
// unrelated ZIP entries keep their original compressed bytes.
import { clean, stripInvisible, cleanConservative } from './index.mjs';
import { readZip, entryData, writeZip } from './zip.mjs';

const TEXT_RE = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;

function decodeXml(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);/g, (entity) => {
    if (entity === '&amp;') return '&';
    if (entity === '&lt;') return '<';
    if (entity === '&gt;') return '>';
    if (entity === '&quot;') return '"';
    if (entity === '&apos;') return "'";
    if (entity.startsWith('&#x')) return String.fromCodePoint(parseInt(entity.slice(3, -1), 16));
    return String.fromCodePoint(parseInt(entity.slice(2, -1), 10));
  });
}

function encodeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isTextPart(name) {
  return name === 'word/document.xml' || /^word\/(?:header|footer)[^/]*\.xml$/.test(name) ||
    name === 'word/footnotes.xml' || name === 'word/endnotes.xml';
}

function openDocx(buf) {
  let entries;
  try { entries = readZip(buf); } catch (error) { throw new Error('not a .docx file'); }
  if (!entries.some((entry) => entry.name === 'word/document.xml')) throw new Error('not a .docx file');
  return entries;
}

export function cleanDocx(buf, opts = {}) {
  const mode = opts.mode == null ? 'clean' : opts.mode;
  const cleaner = mode === 'clean' ? clean : mode === 'strip' ? stripInvisible
    : mode === 'conservative' ? cleanConservative : null;
  if (!cleaner) throw new TypeError(`unknown DOCX cleaning mode: ${mode}`);
  const entries = openDocx(buf);
  const changedParts = [];
  const output = entries.map((entry) => {
    if (!isTextPart(entry.name)) return entry;
    const xml = entryData(entry).toString('utf8');
    let changed = false;
    const cleanedXml = xml.replace(TEXT_RE, (whole, open, content, close) => {
      const decoded = decodeXml(content);
      const cleaned = cleaner(decoded);
      if (cleaned === decoded) return whole;
      changed = true;
      if (/^\s|\s$/.test(cleaned) && !/\bxml:space\s*=/.test(open)) open = open.slice(0, -1) + ' xml:space="preserve">';
      return open + encodeXml(cleaned) + close;
    });
    if (!changed) return entry;
    changedParts.push(entry.name);
    return { ...entry, data: Buffer.from(cleanedXml, 'utf8') };
  });
  if (changedParts.length === 0) return { buffer: buf, changedParts, changed: false };
  return { buffer: writeZip(output), changedParts, changed: true };
}

function partText(entry) {
  const xml = entryData(entry).toString('utf8');
  return xml.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\s*\/>|<w:(?:br|cr)\s*\/>|<[^>]*>/g,
    (whole, content) => content != null ? decodeXml(content) : whole === '</w:p>' ? '\n'
      : /^<w:tab/.test(whole) ? '\t' : /^<w:(?:br|cr)/.test(whole) ? '\n' : '');
}

export function extractDocxText(buf) {
  const entries = openDocx(buf);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const document = byName.get('word/document.xml');
  const documentXml = entryData(document).toString('utf8');
  const collect = (pattern) => entries.filter((entry) => pattern.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name)).map(partText).join('\n');
  return {
    body: partText(document),
    headers: collect(/^word\/header[^/]*\.xml$/),
    footers: collect(/^word\/footer[^/]*\.xml$/),
    notes: collect(/^word\/(?:footnotes|endnotes)\.xml$/),
    structure: {
      tables: (documentXml.match(/<w:tbl(?:\s|>)/g) || []).length,
      textBoxes: (documentXml.match(/<w:txbxContent(?:\s|>)/g) || []).length,
      images: (documentXml.match(/<w:drawing(?:\s|>)/g) || []).length,
    },
  };
}
