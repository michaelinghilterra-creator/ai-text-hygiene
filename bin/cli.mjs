#!/usr/bin/env node
// ai-text-hygiene CLI. Read from files or stdin, clean, write to stdout (or in
// place with --write). See `ai-text-hygiene --help`.
import fs from 'fs';
import { clean, stripInvisible, cleanConservative } from '../src/index.mjs';

const HELP = `ai-text-hygiene -- clean up invisible AI text artifacts

Usage:
  ai-text-hygiene [options] [file ...]
  cat file | ai-text-hygiene [options]

Options:
  --strip-only     Only strip invisible/format Unicode + normalize spaces
                   (no punctuation changes; safe for any language).
  --conservative   Length-stable: invisibles + curly quotes only (no dash/ellipsis
                   folding), for fixed-width or character-capped fields.
  --write, -w      Rewrite each input file in place (default: print to stdout).
  --help, -h       Show this help.

With no files, reads stdin and writes cleaned text to stdout.`;

function pickMode(args) {
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
  const fn = pickMode(args);
  const write = args.includes('--write') || args.includes('-w');
  const files = args.filter((a) => !a.startsWith('-'));

  if (files.length === 0) {
    const input = await readStdin();
    process.stdout.write(fn(input));
    return;
  }
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const out = fn(text);
    if (write) {
      if (out !== text) fs.writeFileSync(f, out);
      console.error(`${out !== text ? 'cleaned' : 'unchanged'}: ${f}`);
    } else {
      process.stdout.write(out);
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
