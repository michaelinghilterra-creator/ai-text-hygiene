# Changelog

## 0.4.0 (2026-10-31)

### Features

- **Voice match**: `analyzeVoice(draft, samples)` and `--voice <file>` compare a draft with samples of your own writing and flag the sentences that don't sound like you. Flag only, never rewrites.
- **Word documents**: `cleanDocx` cleans the text inside a `.docx` (body, headers, footers, notes) and leaves every other part of the file byte-exact. `extractDocxText` feeds the cadence, style and voice reports.
- **HTML and email drafts**: `cleanHtml` cleans text nodes only; `cleanEmail` leaves quoted replies, other headers and the signature alone. The CLI picks the format from the file extension or `--format`.
- **ATS check**: `checkAts` and `--ats --keywords=...` flag invisible characters, symbol-font bullets, column layouts, missing or split keywords, and `.docx` contact details that only sit in a header or footer.
- **Disclosure**: `disclose` and `--disclose[=level]` add an optional one-line note about how AI assistance was used.

### Fixes

- Removed quadratic regex paths in the core cleaner and the new ATS and `.docx` code (flagged by CodeQL).

### Docs

- README FAQ on text watermarks: what they are, and why this library does not remove one.

## Earlier releases

0.1.0 to 0.3.0: see the [GitHub releases](https://github.com/michaelinghilterra-creator/ai-text-hygiene/releases).
