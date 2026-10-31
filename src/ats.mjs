// ATS checks flag text and document structures that can interfere with resume
// parsing, and report keyword presence without modifying the input.
import { stripInvisible } from './index.mjs';
import { extractDocxText } from './docx.mjs';

const SMART = new RegExp('[' + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026]
  .map((point) => String.fromCharCode(point)).join('') + ']', 'g');
const FANCY = new RegExp('^\\s*[' + [0x25CF, 0x25AA, 0x25A0, 0x25C6, 0x27A2, 0x2713, 0x2714, 0x25BA]
  .map((point) => String.fromCharCode(point)).join('') + ']', 'm');
const PRIVATE = new RegExp('[\\uE000-\\uF8FF]', 'g');
const EMAIL = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;
const PHONE = /\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/;

function keywordRe(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![A-Za-z0-9])' + escaped + '(?![A-Za-z0-9])', 'i');
}

export function checkAts(input, opts = {}) {
  const docx = Buffer.isBuffer(input);
  const extracted = docx ? extractDocxText(input) : null;
  let text = docx ? extracted.body : String(input == null ? '' : input);
  if (!docx && opts.html === true) text = text.replace(/<[^>]*>/g, ' ');
  const findings = [];
  const add = (type, severity, message) => findings.push({ type, severity, message });
  // stripInvisible also folds CRLF to LF, which is not an ATS hazard.
  text = text.replace(/\r\n?/g, '\n');
  const stripped = stripInvisible(text);
  if (stripped !== text) {
    const count = text.length - stripped.length;
    add('invisible', 'high', count > 0 ? `${count} invisible character(s) should be removed.`
      : 'Some invisible spaces were normalized to plain spaces.');
  }
  const privateCount = (text.match(PRIVATE) || []).length;
  if (privateCount) add('symbol-bullets', 'high', `${privateCount} private-use symbol character(s) may hide bullets from an ATS.`);
  if (FANCY.test(text)) add('fancy-bullets', 'low', 'Use - or a plain bullet at the start of list items.');
  const smartCount = (text.match(SMART) || []).length;
  if (smartCount) add('smart-punctuation', 'low', `${smartCount} smart punctuation character(s) found; most ATS read them, but folding is safer.`);
  const columnLines = text.split(/\r\n|\r|\n/).filter((line) => /\S\t\S|\S {4,}\S/.test(line)).length;
  if (columnLines >= 3) add('columns', 'medium', `${columnLines} lines look like columns and may be read out of order.`);

  const keywords = (opts.keywords == null ? [] : opts.keywords).map((keyword) => {
    const value = String(keyword);
    const re = keywordRe(value);
    let status = 'missing';
    if (re.test(text)) status = 'found';
    else if (re.test(stripped)) status = 'split';
    if (status === 'split') add('keyword-split', 'high', `Keyword "${value}" is split by invisible characters.`);
    else if (status === 'missing') add('keyword-missing', 'medium', `Keyword "${value}" is missing.`);
    return { keyword: value, status };
  });

  if (docx) {
    const outside = extracted.headers + '\n' + extracted.footers;
    if ((EMAIL.test(outside) || PHONE.test(outside)) && !(EMAIL.test(text) || PHONE.test(text))) {
      add('header-footer-contact', 'high', 'Contact details appear only in a header or footer.');
    }
    if (extracted.structure.textBoxes > 0) add('text-box', 'high', 'Text boxes may not be read by an ATS.');
    if (extracted.structure.tables > 0) add('tables', 'medium', 'Tables may be read out of order by an ATS.');
    if (extracted.structure.images > 0) add('images', 'low', 'Images are not readable as resume text.');
  }
  const rank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { ok: !findings.some((finding) => finding.severity === 'high'), findings, keywords };
}

export function formatAtsReport(report) {
  const issues = report.findings.filter((finding) => finding.severity !== 'low').length;
  const lines = [`ats: ${issues ? `${issues} issue(s) to fix` : 'ok'}`];
  for (const finding of report.findings) lines.push(`  [${finding.severity}] ${finding.message}`);
  if (report.keywords.length) lines.push('keywords: ' + report.keywords.map((item) => `${item.keyword} (${item.status})`).join(', '));
  return lines.join('\n');
}
