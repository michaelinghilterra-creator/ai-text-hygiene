#!/usr/bin/env node
// ai-text-hygiene CLI. Read from files or stdin, clean, write to stdout (or in
// place with --write). See `ai-text-hygiene --help`.
import fs from 'fs';
import { clean, stripInvisible, cleanConservative, analyzeCadence, formatCadenceReport, analyzeStyle, formatStyleReport, stripRedundantFiller, analyzeVoice, formatVoiceReport, disclosureLine, disclose, cleanDocx, extractDocxText, cleanHtml, cleanEmail, checkAts, formatAtsReport } from '../src/index.mjs';

const HELP = `ai-text-hygiene -- clean up invisible AI text artifacts

Usage:
  ai-text-hygiene [options] [file ...]
  cat file | ai-text-hygiene [options]

Options:
  --strip-only     Only strip invisible/format Unicode + normalize spaces
                   (no punctuation changes; safe for any language).
  --conservative   Length-stable: invisibles + curly quotes only (no dash/ellipsis
                   folding), for fixed-width or character-capped fields.
  --cadence        Analyze rhythm instead of cleaning: report a 0-100 variety
                   score and flag monotonous sentence length / repeated openers.
                   Does not modify the text. Ignores --write.
  --style          Analyze word choice: report a 0-100 plainness score and flag
                   overused AI vocabulary, filler, cliche openers, bullet overload.
                   Does not modify the text. Ignores --write.
  --voice <file>   Compare with a file of your own writing samples. May repeat.
                   Flags differences without rewriting. Ignores --write.
  --ats            Check ATS parsing hazards and keywords without modifying input.
                   Exits 2 when high or medium issues need attention.
  --keywords <list>
                   Comma-separated ATS keywords to check.
  --format=<type>  Input format: text, html, email, or docx. Overrides extension.
  --email          Shorthand for --format=email.
  --disclose[=level]
                   Append an AI-assistance disclosure. Levels: assisted, drafted,
                   edited. Defaults to assisted.
  --strip-filler   Auto-fix ONLY the always-safe redundant phrases
                   ("in order to" -> "to"). Leaves everything else untouched.
  --write, -w      Rewrite each input file in place (default: print to stdout).
  --help, -h       Show this help.

With no files, reads stdin. Cleaning / --strip-filler write text to stdout;
--cadence, --style, and --voice write their report to stdout.
.docx files can be cleaned in place with --write or analyzed as document text.`;

function pickMode(args) {
  if (args.includes('--strip-filler')) return stripRedundantFiller;
  if (args.includes('--strip-only')) return stripInvisible;
  if (args.includes('--conservative')) return cleanConservative;
  return clean;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

function formatFor(file, override) {
  if (override) return override;
  if (file && /\.html?$/i.test(file)) return 'html';
  if (file && /\.eml$/i.test(file)) return 'email';
  if (file && /\.docx$/i.test(file)) return 'docx';
  return 'text';
}

function modeFor(args) {
  return args.includes('--strip-only') ? 'strip' : args.includes('--conservative') ? 'conservative' : 'clean';
}

function cleanFormatted(text, format, args) {
  if (format === 'html') return cleanHtml(text, { mode: modeFor(args) });
  if (format === 'email') return cleanEmail(text, { mode: modeFor(args) });
  return pickMode(args)(text);
}

function checkFormatOptions(format, args) {
  if ((format === 'html' || format === 'email') && args.includes('--strip-filler')) {
    throw new TypeError(`--strip-filler is not supported for ${format} input.`);
  }
}

function addDisclosure(text, format, level) {
  if (format === 'html') {
    const line = disclosureLine({ level, format: 'html' });
    if (text.includes(line)) return text;
    const match = /<\/body\s*>/i.exec(text);
    return match ? text.slice(0, match.index) + line + text.slice(match.index) : text + line;
  }
  if (format === 'email') {
    const match = /^-{2} ?(?:\r\n|\r|\n|$)/m.exec(text);
    if (!match) return disclose(text, { level });
    const before = disclose(text.slice(0, match.index), { level });
    const separator = /(?:\r\n|\r|\n)$/.test(before) ? '' : '\n';
    return before + separator + text.slice(match.index);
  }
  return disclose(text, { level });
}

function hasMimeGuard(text) {
  const header = text.split(/\r\n\r\n|\r\r|\n\n/, 1)[0];
  return /^Content-Transfer-Encoding:\s*(?:quoted-printable|base64)\s*$/im.test(header) ||
    /^Content-Type:\s*multipart\//im.test(header);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  const voiceFiles = [];
  const files = [];
  const keywords = [];
  let disclosureLevel = null;
  let formatOverride = args.includes('--email') ? 'email' : null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--voice') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) throw new TypeError('--voice requires a samples file.');
      voiceFiles.push(args[++i]);
    } else if (arg === '--disclose') {
      disclosureLevel = 'assisted';
    } else if (arg.startsWith('--disclose=')) {
      disclosureLevel = arg.slice('--disclose='.length);
    } else if (arg === '--keywords') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) throw new TypeError('--keywords requires a comma-separated list.');
      keywords.push(...args[++i].split(',').filter(Boolean));
    } else if (arg.startsWith('--keywords=')) {
      keywords.push(...arg.slice('--keywords='.length).split(',').filter(Boolean));
    } else if (arg === '--format') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) throw new TypeError('--format requires a value.');
      formatOverride = args[++i];
    } else if (arg.startsWith('--format=')) {
      formatOverride = arg.slice('--format='.length);
    } else if (!arg.startsWith('-')) {
      files.push(arg);
    }
  }
  if (formatOverride != null && !['text', 'html', 'email', 'docx'].includes(formatOverride)) {
    throw new TypeError(`unknown format: ${formatOverride}`);
  }
  const samples = voiceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n\n');
  const analyze = voiceFiles.length ? (t) => formatVoiceReport(analyzeVoice(t, samples))
    : args.includes('--cadence') ? (t) => formatCadenceReport(analyzeCadence(t))
    : args.includes('--style') ? (t) => formatStyleReport(analyzeStyle(t))
      : null;
  const write = args.includes('--write') || args.includes('-w');
  const ats = args.includes('--ats');
  let atsFailed = false;

  if (files.length === 0) {
    const input = await readStdin();
    const format = formatFor(null, formatOverride);
    if (format === 'docx') throw new TypeError('DOCX input must be read from a file.');
    checkFormatOptions(format, args);
    if (ats) {
      const report = checkAts(input, { keywords, html: format === 'html' });
      console.log(formatAtsReport(report));
      if (report.findings.some((finding) => finding.severity !== 'low')) process.exitCode = 2;
      return;
    }
    if (analyze) { console.log(analyze(input)); return; }
    let out = cleanFormatted(input, format, args);
    const mimeSkipped = format === 'email' && out === input && hasMimeGuard(input);
    if (disclosureLevel != null && !mimeSkipped) out = addDisclosure(out, format, disclosureLevel);
    process.stdout.write(out);
    return;
  }
  for (const f of files) {
    const format = formatFor(f, formatOverride);
    const isDocx = format === 'docx';
    checkFormatOptions(format, args);
    if (isDocx) {
      if (args.includes('--strip-filler')) throw new TypeError('--strip-filler is not supported for .docx files.');
      if (disclosureLevel != null) throw new TypeError('--disclose is not supported for .docx files.');
      const input = fs.readFileSync(f);
      if (ats) {
        if (files.length > 1) console.log(`== ${f} ==`);
        const report = checkAts(input, { keywords });
        console.log(formatAtsReport(report));
        if (report.findings.some((finding) => finding.severity !== 'low')) atsFailed = true;
        continue;
      }
      if (analyze) {
        if (files.length > 1) console.log(`== ${f} ==`);
        console.log(analyze(extractDocxText(input).body));
        continue;
      }
      if (!write) throw new TypeError('.docx cleaning requires --write.');
      const result = cleanDocx(input, { mode: modeFor(args) });
      if (result.changed) fs.writeFileSync(f, result.buffer);
      console.error(result.changed ? `cleaned: ${f} (${result.changedParts.join(', ')})` : `unchanged: ${f}`);
      continue;
    }
    const text = fs.readFileSync(f, 'utf8');
    if (ats) {
      if (files.length > 1) console.log(`== ${f} ==`);
      const report = checkAts(text, { keywords, html: format === 'html' });
      console.log(formatAtsReport(report));
      if (report.findings.some((finding) => finding.severity !== 'low')) atsFailed = true;
      continue;
    }
    if (analyze) {
      if (files.length > 1) console.log(`== ${f} ==`);
      console.log(analyze(text));
      continue;
    }
    let out = cleanFormatted(text, format, args);
    const mimeSkipped = format === 'email' && out === text && hasMimeGuard(text);
    if (mimeSkipped && /\.eml$/i.test(f)) {
      console.error(`skipped (MIME-encoded): ${f}`);
    }
    if (disclosureLevel != null && !mimeSkipped) out = addDisclosure(out, format, disclosureLevel);
    if (write) {
      if (out !== text) fs.writeFileSync(f, out);
      console.error(`${out !== text ? 'cleaned' : 'unchanged'}: ${f}`);
    } else {
      process.stdout.write(out);
    }
  }
  if (atsFailed) process.exitCode = 2;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
