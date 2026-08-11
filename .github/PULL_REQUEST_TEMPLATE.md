<!--
Thanks for the contribution. Keep this short — the diff says what changed, so
use the description to say why.
-->

## What this changes

<!-- One or two sentences. If it fixes an issue, link it: Fixes #123 -->

## Why

<!-- The problem being solved, or the behaviour that was wrong. -->

## How it was verified

<!-- Tests added or run, and anything checked by hand. -->

## Checklist

- [ ] Formatted and linted (`just check` for Python, `pnpm lint` in `console/`)
- [ ] Type-checked (`just typecheck` for Python, `pnpm typecheck` in `console/`)
- [ ] Tests pass (`just test` for Python, `pnpm test` in `console/`)
- [ ] Docs updated, if this changes behaviour someone relies on
- [ ] If this changes how agents interact with Switch, **both** connector skills
      are updated (`connectors/claude-code-plugin/` and `connectors/codex-plugin/`)
