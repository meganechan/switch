# Contributing to Agent Switch

Thanks for your interest in contributing! This guide covers what you need to
get a change merged.

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). To
report a security vulnerability, follow [SECURITY.md](SECURITY.md) rather than
opening an issue.

## Contributor License Agreement (required)

Every contributor must agree to a Contributor License Agreement before their
contributions can be merged. There are two paths — individual and corporate.

### Individual contributors

Agent Switch requires every contributor to sign the
[Contributor License Agreement](CLA.md). This is a one-time step handled
automatically:

1. Open your pull request as usual.
2. An automated CLA assistant comments on the PR with a link to the CLA and a
   status check.
3. Reply to the PR with the exact sentence:

   > I have read the CLA Document and I hereby sign the CLA

Your signature is recorded automatically and applies to all future
contributions — you only sign once.

### Corporate contributors

If you contribute on behalf of a company, your employer can sign the Corporate
CLA instead of each employee signing individually:

1. Download the [Corporate CLA](CCLA.pdf) and complete it: the corporation's
   details, the GitHub usernames of the employees authorized to contribute
   (Schedule A), and a signature from a person authorized to bind the company.
2. Email the completed, signed PDF to **legal@sandboxquantum.com**.
3. Once we record it, we add those GitHub usernames to the project's approved
   contributor list, so their contributions are recognized as covered — they do
   not each need to sign the individual CLA.

To add or remove authorized contributors later, the company emails an updated,
signed copy to the same address.

## Development setup

```bash
uv sync            # install dependencies
just up            # start Switch locally (Docker Compose)
just migrate       # apply database migrations
```

## Before you open a pull request

- **Format & lint:** `just check` (CI runs `ruff format --check` + `ruff check`).
- **Type-check:** `just typecheck` (mypy over `core/switch_core/`).
- **Test:** `just test` (pytest; store tests run against a real PostgreSQL
  instance, not mocks or SQLite).

## Conventions

Code style, import rules, and the error-handling philosophy ("fail loud, never
fake") are documented in [CLAUDE.md](CLAUDE.md). That file is written as
instructions for AI coding agents working in this repository, but the
conventions it describes are the ones the project follows, so it is worth
reading before making substantial changes — matching the surrounding code keeps
review fast.

## License

By contributing, you agree that your contributions will be licensed under the
project's [LICENSE](LICENSE) (Apache License 2.0 with the Commons Clause
condition).
