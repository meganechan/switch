import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTRACTS } from './contracts';
import { RUNTIME_ARTIFACT, RUNTIME_VERSION } from './version';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
) as { version: string };

describe('the runtime declares its own version', () => {
  it('matches package.json', () => {
    // The number is written twice because package.json cannot be imported
    // without inlining the manifest into the bundle. This is what makes that
    // safe: a release bump that misses one side fails here rather than
    // shipping a runtime that lies about which release it is.
    expect(RUNTIME_VERSION).toBe(manifest.version);
  });

  it('is three-part semver', () => {
    // Every Switch artifact carries MAJOR.MINOR.PATCH.
    expect(RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names an artifact the contract registry knows', () => {
    // Declaring a name the server has no range for would report as unknown
    // forever, and look like a client that simply never spoke up.
    expect(CONTRACTS['agent-protocol']).toHaveProperty(RUNTIME_ARTIFACT);
  });
});
