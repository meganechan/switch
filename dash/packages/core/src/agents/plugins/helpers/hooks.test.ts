import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { filterUserHooks, makeStdinHookCommand, SWITCHDASH_MARKER } from './hooks';

const execFileAsync = promisify(execFile);

/**
 * Run a generated POSIX hook command under a real `sh` with `curl` stubbed out,
 * and report the URL and token it would have posted to. The endpoint resolution
 * is shell code, so asserting on the string alone would not catch a quoting or
 * `sed` mistake — only executing it does.
 */
async function resolveEndpoint(
  env: Record<string, string>
): Promise<{ url: string; token: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hook-cmd-'));
  try {
    // A `curl` that records its own argv instead of making a request.
    const stub = path.join(dir, 'curl');
    const out = path.join(dir, 'argv');
    await writeFile(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(out)}\n`, {
      mode: 0o755,
    });

    const command = makeStdinHookCommand('notification', { platform: 'linux' });
    await execFileAsync('sh', ['-c', command], {
      env: { ...env, PATH: `${dir}:${process.env.PATH ?? ''}` },
    });

    const { stdout } = await execFileAsync('cat', [out]);
    const argv = stdout.split('\n');
    const url = argv.find((a) => a.startsWith('http://')) ?? '';
    const tokenIdx = argv.findIndex((a) => a.startsWith('X-Switchdash-Token:'));
    return { url, token: argv[tokenIdx]?.replace('X-Switchdash-Token: ', '') ?? '' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('makeStdinHookCommand endpoint resolution', () => {
  it('uses the env port and token when no endpoint file is configured', async () => {
    const { url, token } = await resolveEndpoint({
      SWITCHDASH_HOOK_PORT: '5001',
      SWITCHDASH_HOOK_TOKEN: 'env-token',
      SWITCHDASH_PTY_ID: 'claude:s1',
    });

    expect(url).toBe('http://127.0.0.1:5001/hook');
    expect(token).toBe('env-token');
  });

  it('prefers the endpoint file, so a pane follows a restarted sidecar', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hook-ep-'));
    const endpointFile = path.join(dir, 'endpoint');
    // What the sidecar rewrites after rebinding on a fresh port + token.
    await writeFile(endpointFile, '6002\nfresh-token\n');

    try {
      const { url, token } = await resolveEndpoint({
        // Stale values baked into the pane at spawn time.
        SWITCHDASH_HOOK_PORT: '5001',
        SWITCHDASH_HOOK_TOKEN: 'stale-token',
        SWITCHDASH_PTY_ID: 'claude:s1',
        SWITCHDASH_HOOK_ENDPOINT_FILE: endpointFile,
      });

      expect(url).toBe('http://127.0.0.1:6002/hook');
      expect(token).toBe('fresh-token');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the env when the endpoint file is missing or unreadable', async () => {
    const { url, token } = await resolveEndpoint({
      SWITCHDASH_HOOK_PORT: '5001',
      SWITCHDASH_HOOK_TOKEN: 'env-token',
      SWITCHDASH_PTY_ID: 'claude:s1',
      SWITCHDASH_HOOK_ENDPOINT_FILE: '/nonexistent/endpoint',
    });

    expect(url).toBe('http://127.0.0.1:5001/hook');
    expect(token).toBe('env-token');
  });

  it('falls back to the env when the endpoint file is empty (mid-write)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hook-ep-'));
    const endpointFile = path.join(dir, 'endpoint');
    await writeFile(endpointFile, '');

    try {
      const { url, token } = await resolveEndpoint({
        SWITCHDASH_HOOK_PORT: '5001',
        SWITCHDASH_HOOK_TOKEN: 'env-token',
        SWITCHDASH_PTY_ID: 'claude:s1',
        SWITCHDASH_HOOK_ENDPOINT_FILE: endpointFile,
      });

      expect(url).toBe('http://127.0.0.1:5001/hook');
      expect(token).toBe('env-token');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stays recognisable to filterUserHooks so managed entries are replaced, not duplicated', () => {
    const command = makeStdinHookCommand('notification', { platform: 'linux' });

    expect(command).toContain(SWITCHDASH_MARKER);
    expect(filterUserHooks([{ command }, { command: 'user-own-hook' }])).toEqual([
      { command: 'user-own-hook' },
    ]);
  });
});
