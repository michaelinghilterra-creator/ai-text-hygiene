#!/usr/bin/env node
// ai-text-hygiene CLI. Read from files or stdin, clean, write to stdout (or in
// place with --write). See `ai-text-hygiene --help`.
import fs from 'fs';
import { clean, stripInvisible, cleanConservative, analyzeCadence, formatCadenceReport, analyzeStyle, formatStyleReport, stripRedundantFiller, analyzeVoice, formatVoiceReport, disclose, cleanDocx, extractDocxText } from '../src/index.mjs';

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

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  const voiceFiles = [];
  const files = [];
  let disclosureLevel = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--voice') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) throw new TypeError('--voice requires a samples file.');
      voiceFiles.push(args[++i]);
    } else if (arg === '--disclose') {
      disclosureLevel = 'assisted';
    } else if (arg.startsWith('--disclose=')) {
      disclosureLevel = arg.slice('--disclose='.length);
    } else if (!arg.startsWith('-')) {
      files.push(arg);
    }
  }
  const samples = voiceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n\n');
  const analyze = voiceFiles.length ? (t) => formatVoiceReport(analyzeVoice(t, samples))
    : args.includes('--cadence') ? (t) => formatCadenceReport(analyzeCadence(t))
    : args.includes('--style') ? (t) => formatStyleReport(analyzeStyle(t))
      : null;
  const fn = pickMode(args);
  const write = args.includes('--write') || args.includes('-w');

  if (files.length === 0) {
    const input = await readStdin();
    if (analyze) { console.log(analyze(input)); return; }
    const out = fn(input);
    process.stdout.write(disclosureLevel == null ? out : disclose(out, { level: disclosureLevel }));
    return;
  }
  for (const f of files) {
    const isDocx = /\.docx$/i.test(f);
    if (isDocx) {
      if (args.includes('--strip-filler')) throw new TypeError('--strip-filler is not supported for .docx files.');
      if (disclosureLevel != null) throw new TypeError('--disclose is not supported for .docx files.');
      const input = fs.readFileSync(f);
      if (analyze) {
        if (files.length > 1) console.log(`== ${f} ==`);
        console.log(analyze(extractDocxText(input).body));
        continue;
      }
      if (!write) throw new TypeError('.docx cleaning requires --write.');
      const mode = args.includes('--strip-only') ? 'strip' : args.includes('--conservative') ? 'conservative' : 'clean';
      const result = cleanDocx(input, { mode });
      if (result.changed) fs.writeFileSync(f, result.buffer);
      console.error(result.changed ? `cleaned: ${f} (${result.changedParts.join(', ')})` : `unchanged: ${f}`);
      continue;
    }
    const text = fs.readFileSync(f, 'utf8');
    if (analyze) {
      if (files.length > 1) console.log(`== ${f} ==`);
      console.log(analyze(text));
      continue;
    }
    let out = fn(text);
    if (disclosureLevel != null) out = disclose(out, { level: disclosureLevel });
    if (write) {
      if (out !== text) fs.writeFileSync(f, out);
      console.error(`${out !== text ? 'cleaned' : 'unchanged'}: ${f}`);
    } else {
      process.stdout.write(out);
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
