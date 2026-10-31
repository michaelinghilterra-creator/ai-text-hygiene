# ai-text-hygiene

Clean up invisible AI text artifacts. Zero dependencies, one small module.

Large-language-model output routinely carries things you can't see: zero-width
spaces, a byte-order mark, bidirectional control characters, non-breaking spaces,
and typographic "AI tells" like em dashes, curly quotes, and the single-character
ellipsis. Those artifacts make text look machine-made, can break ATS keyword
parsing, and turn a clean copy-paste into a mess. This library folds them back to
plain, human-looking text.

## What it is, and what it is not

This is **document hygiene**: clean, human-sounding, parseable output.

It is **not an AI-detection evasion tool.** Stripping invisible characters does
**not** defeat a statistical or cadence-based watermark (the kind baked into a
model's word choice). If you are trying to pass content off as human-written to
beat a detector, this is the wrong tool and it will not do that. What it does is
make honest AI-assisted text read cleanly and parse correctly. On job materials in
particular, the thing that actually reads as machine-written is *cadence* (every
sentence the same shape and length), and no character scrub fixes that.

## Watermarks: questions people ask

**What is a text watermark?** Some model providers build a statistical pattern
into the words their models choose. You can't see it, and it adds no characters.
Someone holding the provider's detection key can check a long enough passage and
tell, with some confidence, that the model wrote it. Anthropic applies one to
Claude output and is extending it to more Claude models from November 3, 2026.
Google's SynthID Text is another example.

**Does this tool remove it?** No. This library changes characters and
punctuation, not word choice. Its only word-level fix swaps a short list of
filler phrases ("in order to" becomes "to"), which is not designed to remove
a watermark and is not a way to do so. If you need text that is provably
human-written, write it yourself.

**Then what were all those invisible characters?** Mostly artifacts:
zero-width spaces, byte-order marks, and odd spaces that come along with
generated or copy-pasted text. People often mistake them for a watermark. They
are worth stripping because they break ATS keyword parsing and plain-text
pipelines, which is what `stripInvisible` and `clean` are for.

**Who can check for a watermark?** It depends on the provider. At launch,
Anthropic limits checking to groups such as regulators, journalists,
fact-checkers, and researchers.

**Does the watermark identify me?** Per Anthropic, it carries no information
about the user, their organization, or their conversations. It indicates
that a Claude model produced the text.

**So how should I use AI help honestly?** Treat it like any other editor. Review
what you send, make it sound like you (the voice report below points at the
sentences that don't), and say so when someone asks or when you'd rather be
upfront (`disclose` adds a one-line note).

## Install

```bash
npm install ai-text-hygiene
```

Node 16+. No dependencies.

## Use

```js
import { clean, stripInvisible, cleanConservative, cleanText } from 'ai-text-hygiene';

clean('We "delivered" results — on time…');
// => 'We "delivered" results, on time...'

stripInvisible('in​visible﻿');   // strip only, any language
// => 'invisible'

cleanConservative('length‑stable "field"'); // 1:1 swaps only, no growth
```

### API

- `clean(s)` — full English house-style clean: strip invisibles + normalize
  spaces/newlines + curly quotes to straight + em dash / `--` to `", "` + ellipsis
  to `...`. The sensible default for prose. URLs, emails and inline `code` are left
  byte-exact.
- `stripInvisible(s)` — the always-safe tier only (invisible/format Unicode +
  Unicode spaces + newline normalization). No punctuation changes; safe for any
  language.
- `cleanConservative(s)` — length-stable: strip invisibles + curly quotes only, no
  length-growing transforms. For fixed-width slots and character-capped fields.
- `cleanText(s, opts)` — the engine. Toggle individual transforms; see `DEFAULTS`.
  Homoglyph folding (Cyrillic/Greek look-alikes to Latin) is **off by default** and
  enabled with `{ foldHomoglyphs: true }` — it is opt-in because it would otherwise
  mangle a legitimately non-Latin name.

### Cadence (the other half of "reads like a human")

Cleaning is the cosmetic half. The thing that actually reads as machine-written is
**cadence**: whether every sentence has the same length and shape. A character
scrub does nothing to rhythm. `analyzeCadence` measures it.

```js
import { analyzeCadence, formatCadenceReport } from 'ai-text-hygiene';

const report = analyzeCadence(resumeBullets);
report.score;   // 0-100 variety score (higher = more varied, more human)
report.flags;   // [{ type, severity, message }], e.g. "11 of 14 lines land within 2 words of 20"
console.log(formatCadenceReport(report));
```

- `analyzeCadence(text, opts)` — returns `{ score, insufficient, units, flags, metrics }`.
  It measures sentence-length variance, length-band clustering, and repeated
  openers / templates. Fewer than 5 lines returns `insufficient: true` with a
  `null` score, because rhythm cannot be judged from a handful of lines.
- `formatCadenceReport(report)` — a printable summary for a CLI or log.

This is a **writing-quality signal, not a detector.** It flags monotony so you (or
a model) can vary the rhythm. It does not claim to beat any AI-detection system,
because varied rhythm is simply better writing, not a trick.

### Style (word choice and framing)

Cadence covers rhythm; this covers the other visible tells: overused AI vocabulary
("delve," "tapestry," "leverage," "seamless"), filler, cliche or sycophantic
openers, and bullet overload.

```js
import { analyzeStyle, stripRedundantFiller } from 'ai-text-hygiene';

analyzeStyle(text).score;   // 0-100 plainness score (higher = plainer)
analyzeStyle(text).flags;   // [{ type, severity, term, message }]
stripRedundantFiller('In order to win we meet on a daily basis.');
// => 'To win we meet daily.'
```

- `analyzeStyle(text, opts)` — **detect only**, never rewrites. Returns
  `{ score, flags, counts, density, insufficient }`. Words that are legitimate in
  technical writing (leverage, robust, streamline) are flagged as **low severity**,
  not penalized hard. `opts.expectBullets` suppresses the bullet-overload flag for
  documents where bullets are expected (a resume). Under ~30 words it returns
  `insufficient`.
- `stripRedundantFiller(text)` — the **one safe auto-fix**: a short, strict list of
  phrases whose replacement is correct in essentially every context ("in order
  to" -> "to," "due to the fact that" -> "because"). Everything judgment-heavy
  stays flag-only, because a blind find-and-replace on word choice homogenizes and
  breaks text.
- `formatStyleReport(report)` — a printable summary.

### Voice (does this sound like you?)

The style and cadence reports compare text against general AI habits. The voice
report compares a draft against **your own writing**: give it a few paragraphs
you wrote yourself, and it points at the sentences that don't sound like you.

```js
import { analyzeVoice, formatVoiceReport } from 'ai-text-hygiene';

const report = analyzeVoice(draft, [oldEmail, oldPost, oldCoverLetter]);
report.score;      // 0-100 match to your samples
report.sentences;  // [{ index, text, reasons }], the ones worth rewriting yourself
console.log(formatVoiceReport(report));
```

- `analyzeVoice(draft, samples, opts)`: **flag only**, never rewrites. Compares
  simple, explainable features (sentence length and spread, contractions,
  first-person use, word length, commas, questions, exclamations) and flags AI
  vocabulary that never shows up in your samples. Returns `{ score, insufficient,
  features, flags, sentences, metrics }`. Needs about 150 words of samples and 30
  words of draft; below that it returns `insufficient: true`.
- `formatVoiceReport(report)`: a printable summary.

The fix is always yours to make. Rewriting the flagged sentences in your own words
is what makes the text yours.

### Disclosure (optional)

For people who would rather say up front that they had help.

```js
import { disclose, disclosureLine } from 'ai-text-hygiene';

disclose(coverLetter, { level: 'drafted' });
// appends: "First drafted with an AI assistant, then edited and checked by me."
disclosureLine({ level: 'edited', tool: 'Claude', format: 'html' });
// => '<p class="ai-disclosure">Written by me, with editing help from Claude.</p>'
```

- `disclosureLine({ level, tool, format })`: levels `assisted` (default),
  `drafted`, `edited`; formats `text`, `markdown`, `html`.
- `disclose(text, opts)`: appends the line after a blank line. Running it twice
  adds it once.

### Word documents (.docx)

```js
import fs from 'fs';
import { cleanDocx, extractDocxText } from 'ai-text-hygiene';

const { buffer, changed, changedParts } = cleanDocx(fs.readFileSync('resume.docx'));
if (changed) fs.writeFileSync('resume.docx', buffer);
extractDocxText(fs.readFileSync('resume.docx')).body; // plain text for the reports
```

- `cleanDocx(buf, { mode })`: cleans only the text inside Word text runs (body,
  headers, footers, footnotes, endnotes). Layout, styles, images and every other
  part of the file keep their original bytes. `mode` is `clean` (default),
  `strip`, or `conservative`. Text is cleaned run by run, so punctuation that
  Word split across two formatting runs may fold less neatly than in plain text.
- `extractDocxText(buf)`: `{ body, headers, footers, notes, structure }`, where
  `structure` counts tables, text boxes and images.

Still zero dependencies: a small zip reader and writer on Node's built-in `zlib`.
ZIP64, encrypted and multi-disk archives are refused with a clear error.

### HTML and email drafts

- `cleanHtml(html, { mode })`: cleans text between tags only. Tags, attributes,
  comments, and the contents of `script`, `style`, `textarea`, `pre`, `code`,
  `kbd` and `samp` stay byte-exact. Entity forms of the characters it folds
  (`&mdash;`, `&#8212;`, `&ldquo;`, zero-width references) are folded too;
  `&nbsp;`, `&amp;`, `&lt;` and the rest are left as written.
- `cleanEmail(text, { mode })`: for plain-text drafts. Cleans the `Subject:`
  line and your body; leaves other headers, `>` quoted lines, everything from an
  `On ... wrote:` line down, and your signature (after the `-- ` line) alone,
  apart from stripping invisible characters from the signature. MIME-encoded
  messages are returned unchanged.

### ATS check

```js
import { checkAts, formatAtsReport } from 'ai-text-hygiene';

const report = checkAts(fs.readFileSync('resume.docx'), { keywords: ['Python', 'C++'] });
report.ok;        // false when anything high-severity turned up
report.findings;  // [{ type, severity, message }]
report.keywords;  // [{ keyword, status: 'found' | 'split' | 'missing' }]
console.log(formatAtsReport(report));
```

Checks for the things that quietly break resume parsing: invisible characters,
symbol-font bullets (private-use characters), tab or space-aligned columns,
keywords that are missing or split by an invisible character, and smart
punctuation (low severity). For a `.docx` it also flags contact details that
only appear in a header or footer, text boxes, tables and images. Takes a
string, an HTML string with `{ html: true }`, or a `.docx` Buffer. Read-only.

### CLI

```bash
npx ai-text-hygiene messy.txt > clean.txt      # stdout
npx ai-text-hygiene --write notes.md           # rewrite in place
cat draft.txt | npx ai-text-hygiene --conservative
npx ai-text-hygiene --cadence resume.md        # rhythm report, does not modify
npx ai-text-hygiene --style cover-letter.md    # word-choice report, does not modify
cat draft.txt | npx ai-text-hygiene --strip-filler   # apply only the safe swaps
npx ai-text-hygiene --voice my-writing.txt draft.md  # voice report against your samples
npx ai-text-hygiene --disclose=drafted cover.md      # clean + append a disclosure line
npx ai-text-hygiene --write resume.docx              # clean a Word file in place
npx ai-text-hygiene --write page.html                # tags and code left alone
cat reply.txt | npx ai-text-hygiene --email          # quoted text and signature left alone
npx ai-text-hygiene --ats --keywords=Python,SQL resume.docx  # exits 2 if something needs fixing
```

The format comes from the file extension (`.html`, `.htm`, `.eml`, `.docx`) or
`--format=text|html|email|docx`. A `.docx` is only rewritten with `--write`.

## Guarantees

- **Idempotent.** Running twice equals running once.
- **Protected spans stay byte-exact.** URLs, emails, markdown link targets, and
  inline `` `code` `` are never touched by the prose transforms.
- **English house-style only.** Curly-quote and dash folding target English; for
  other languages use `stripInvisible` (or turn those flags off in `cleanText`).

## Where this came from

This module was extracted from [trajecktory](https://github.com/michaelinghilterra-creator/trajecktory),
an open-source job-search pipeline, where it cleans AI-drafted resumes, cover
letters, and outreach before they go out.

The invisible/format codepoint inventory was seeded by
[guillaumemeyer/watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover)
(MIT). See [NOTICE](NOTICE).

## License

MIT. See [LICENSE](LICENSE).
