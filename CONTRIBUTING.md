# Contributing to ai-text-hygiene

Thanks for your interest in contributing!

## Before Submitting a PR

For anything beyond a small fix, please [open an issue](https://github.com/michaelinghilterra-creator/ai-text-hygiene/issues) first to discuss the change.

## Quick Start

1. Fork the repo
2. Create a branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run the tests: `npm test`
5. Commit using a [Conventional Commit](https://www.conventionalcommits.org/) message (e.g. `fix: handle mixed line endings in cadence analyzer`) — PR titles are checked for this on merge, since this project uses Release Please for versioning
6. Open a Pull Request referencing the issue

## What to Contribute

**Good first contributions:**
- New AI-tell patterns to detect (with a citation or example of real occurrence)
- False-positive fixes in existing detectors
- Documentation and README examples

**Bigger contributions:**
- New analyzers (following the shape of `analyzeCadence` / `analyzeStyle`)
- CLI ergonomics (`bin/cli.mjs`)

## Guidelines

- **Zero runtime dependencies is a hard constraint.** Don't add one without
  discussing it in an issue first.
- This is a hygiene/detection tool, not an AI-detection-evasion tool — PRs
  that shift the project toward defeating cadence/watermark detectors will be
  declined (see the README's "what it is not" section)
- Keep detectors conservative: prefer flagging over silently rewriting, except
  where the existing "always-safe" swap functions already do so

## Contributor License and Sign-Off (DCO)

Sign off each commit to certify you wrote the change, or have the right to
submit it:

```bash
git commit -s -m "your message"
```

This adds a `Signed-off-by:` line, certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/).

By contributing, you agree your contribution is licensed under the project's
[MIT LICENSE](LICENSE). You keep the copyright to your own contribution.

## Need Help?

[Open an issue](https://github.com/michaelinghilterra-creator/ai-text-hygiene/issues).
