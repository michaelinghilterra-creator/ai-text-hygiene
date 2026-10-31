// Plain-text email draft cleaning preserves headers, replies, and quotations
// while cleaning the editable subject and body.
import { clean, stripInvisible, cleanConservative } from './index.mjs';

function cleanerFor(mode) {
  if (mode === 'clean') return clean;
  if (mode === 'strip') return stripInvisible;
  if (mode === 'conservative') return cleanConservative;
  throw new TypeError(`unknown email cleaning mode: ${mode}`);
}

function splitLines(text) {
  const lines = [];
  const re = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match;
  while ((match = re.exec(text)) && (match[0] || re.lastIndex < text.length)) {
    lines.push({ content: match[1], ending: match[2] });
    if (!match[2]) break;
  }
  return lines;
}

function joinLines(lines) {
  return lines.map((line) => line.content + line.ending).join('');
}

function mimeEncoded(lines) {
  const header = [];
  for (const line of lines) {
    if (line.content === '') break;
    header.push(line.content);
  }
  const text = header.join('\n');
  return /^Content-Transfer-Encoding:\s*(?:quoted-printable|base64)\s*$/im.test(text) ||
    /^Content-Type:\s*multipart\//im.test(text);
}

function cleanHeader(lines, end, cleaner) {
  const output = [];
  for (let i = 0; i < end; i++) {
    const line = lines[i];
    if (!/^Subject:/i.test(line.content)) {
      output.push(line);
      continue;
    }
    let value = line.content.replace(/^Subject:\s*/i, '');
    const prefix = line.content.slice(0, line.content.length - value.length);
    let last = i;
    while (last + 1 < end && /^[ \t]/.test(lines[last + 1].content)) {
      value += ' ' + lines[last + 1].content.trim();
      last++;
    }
    output.push({ content: prefix + cleaner(value), ending: lines[last].ending });
    i = last;
  }
  return output;
}

function cleanBody(lines, cleaner) {
  const output = [];
  let run = [];
  let stopped = false;
  let signature = false;
  const flush = () => {
    if (run.length) {
      const ending = run[run.length - 1].ending;
      const editable = joinLines(run).slice(0, joinLines(run).length - ending.length);
      output.push({ content: cleaner(editable) + ending, ending: '' });
    }
    run = [];
  };
  for (const line of lines) {
    if (!stopped && (/^On .+wrote:\s*$/.test(line.content) || /^-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line.content))) {
      flush();
      stopped = true;
    }
    if (!stopped && /^-{2} ?$/.test(line.content)) {
      flush();
      signature = true;
      stopped = true;
    }
    if (signature) output.push({ content: stripInvisible(line.content + line.ending), ending: '' });
    else if (stopped || /^\s*>/.test(line.content)) {
      flush();
      output.push(line);
    } else run.push(line);
  }
  flush();
  return joinLines(output);
}

export function cleanEmail(text, opts = {}) {
  if (text == null) return text;
  const source = String(text);
  const cleaner = cleanerFor(opts.mode == null ? 'clean' : opts.mode);
  const lines = splitLines(source);
  if (mimeEncoded(lines)) return source;
  const hasHeaders = lines.length > 0 && /^(?:Subject|To|From|Cc|Bcc|Date|Reply-To):/i.test(lines[0].content);
  if (!hasHeaders) return cleanBody(lines, cleaner);
  let end = lines.findIndex((line) => line.content === '');
  if (end < 0) end = lines.length;
  const header = cleanHeader(lines, end, cleaner);
  const separator = end < lines.length ? [lines[end]] : [];
  return joinLines(header.concat(separator)) + cleanBody(lines.slice(end + separator.length), cleaner);
}
