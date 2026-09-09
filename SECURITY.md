# Security Policy

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Report privately through GitHub's **Private Vulnerability Reporting**: open the
repository's **Security** tab and click **"Report a vulnerability"**
([direct link](https://github.com/michaelinghilterra-creator/ai-text-hygiene/security/advisories/new)).
Include:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive a response within 72 hours, and we will coordinate a fix before
public disclosure.

## Scope

Security issues in the following are in scope:

- **Library** (`src/`) — ReDoS in any regex used for detection/normalization,
  unbounded memory use on crafted input
- **CLI** (`bin/cli.mjs`) — path traversal or unsafe file handling on
  user-supplied paths

## Out of Scope

- Issues in third-party dependencies (this package has zero runtime
  dependencies, so this should rarely apply)
- False positives/negatives in style or AI-tell detection are quality bugs,
  not security issues — file those as a normal issue instead

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will credit the
reporter (unless they prefer anonymity) in the release notes.
