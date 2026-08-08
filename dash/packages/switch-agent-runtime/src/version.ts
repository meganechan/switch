/**
 * This artifact's own release version (CHOO-1865).
 *
 * A semver says *where* an artifact is — which release you are running. It says
 * nothing about whether it can talk to anything; that is what the contract
 * revisions in `./contracts` are for. The two move independently and must never
 * be derived from one another.
 *
 * package.json cannot be imported here without inlining the whole manifest into
 * the bundle, so the number is written twice. `version.test.ts` fails if the two
 * disagree, which is the part that makes the duplication safe — a comment
 * reading "keep in sync" is what let COMPATIBLE_SWITCH_VERSION drift.
 */
export const RUNTIME_VERSION = '0.1.5';

/** The artifact name this package declares itself as to Switch. */
export const RUNTIME_ARTIFACT = 'agent-runtime';
