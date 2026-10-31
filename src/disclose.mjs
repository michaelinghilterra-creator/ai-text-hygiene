// Optional, honest AI-assistance disclosure for people who want to be upfront.

export const DISCLOSURE_LEVELS = {
  assisted: 'Written with help from {tool} and reviewed by me.',
  drafted: 'First drafted with {tool}, then edited and checked by me.',
  edited: 'Written by me, with editing help from {tool}.',
};

function validValues(values) {
  return values.join(', ');
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function disclosureLine({ level = 'assisted', tool = 'an AI assistant', format = 'text' } = {}) {
  if (!Object.prototype.hasOwnProperty.call(DISCLOSURE_LEVELS, level)) {
    throw new TypeError(`Unknown disclosure level "${level}". Valid levels: ${validValues(Object.keys(DISCLOSURE_LEVELS))}.`);
  }
  if (!['text', 'markdown', 'html'].includes(format)) {
    throw new TypeError(`Unknown disclosure format "${format}". Valid formats: text, markdown, html.`);
  }
  const value = String(tool);
  if (format === 'html') {
    const sentence = DISCLOSURE_LEVELS[level].replace('{tool}', () => escapeHtml(value));
    return `<p class="ai-disclosure">${sentence}</p>`;
  }
  const sentence = DISCLOSURE_LEVELS[level].replace('{tool}', () => value);
  return format === 'markdown' ? `_${sentence}_` : sentence;
}

export function disclose(text, opts = {}) {
  if (text == null) return text;
  const value = String(text);
  const line = disclosureLine(opts);
  const plain = disclosureLine({ ...opts, format: 'text' });
  const html = disclosureLine({ ...opts, format: 'html' });
  if (value.includes(plain) || value.includes(html)) return value;
  if (!value.trim()) return line;
  const hadNewline = /\r?\n$/.test(value);
  return value.trimEnd() + '\n\n' + line + (hadNewline ? '\n' : '');
}
