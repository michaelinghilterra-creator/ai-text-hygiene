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

### CLI

```bash
npx ai-text-hygiene messy.txt > clean.txt      # stdout
npx ai-text-hygiene --write notes.md           # rewrite in place
cat draft.txt | npx ai-text-hygiene --conservative
```

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
