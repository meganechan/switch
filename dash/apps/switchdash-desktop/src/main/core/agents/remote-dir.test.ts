import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSystemError, FileSystemErrorCodes } from '@main/core/fs/types';

const stat = vi.hoisted(() => vi.fn());
const mkdir = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());
const exec = vi.hoisted(() => vi.fn(async () => ({ stdout: 'writable\n', stderr: '' })));
const constructedWith = vi.hoisted(() => [] as string[]);

vi.mock('@main/core/fs/impl/ssh-fs', () => ({
  SshFileSystem: class {
    constructor(_proxy: unknown, base: string) {
      constructedWith.push(base);
    }
    stat = stat;
    mkdir = mkdir;
    close = close;
  },
}));
vi.mock('@main/core/locations/location-transport', () => ({
  sshConnectionIdForHost: (host: string) => `conn:${host}`,
}));
vi.mock('@main/core/ssh/connect/connect-agent-ssh', () => ({
  ensureSshConnected: vi.fn(async () => ({})),
}));
vi.mock('@main/core/execution-context/ssh-execution-context', () => ({
  SshExecutionContext: class {
    exec = exec;
  },
}));
vi.mock('@main/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { createRemoteDir, inspectRemoteDir } = await import('./remote-dir');

/** Report `paths` as existing directories and everything else as absent. */
function existingDirs(paths: string[]) {
  stat.mockImplementation(async (path: string) =>
    paths.includes(path) ? { path, type: 'dir' } : null
  );
}

const REPO_DIR = '/home/ubuntu/switch-agents/internal-deployments';

beforeEach(() => {
  vi.clearAllMocks();
  constructedWith.length = 0;
  exec.mockResolvedValue({ stdout: 'writable\n', stderr: '' });
});

describe('inspectRemoteDir', () => {
  it('reports an existing directory as usable', async () => {
    existingDirs([REPO_DIR]);

    expect(await inspectRemoteDir('host', REPO_DIR)).toEqual({
      dir: REPO_DIR,
      status: 'directory',
      existingAncestor: '',
      missingSegments: [],
      creatable: false,
    });
    // No point asking whether an existing directory could be created.
    expect(exec).not.toHaveBeenCalled();
  });

  // The ticket's repro: the directory *and* its parent are absent, which is
  // what the per-directory FS could not recover from (CHOO-1416).
  it('names every missing segment when several ancestors are absent', async () => {
    existingDirs(['/home/ubuntu']);

    expect(await inspectRemoteDir('host', REPO_DIR)).toEqual({
      dir: REPO_DIR,
      status: 'missing',
      existingAncestor: '/home/ubuntu',
      missingSegments: ['switch-agents', 'internal-deployments'],
      creatable: true,
    });
    // Writability is asked of the deepest *existing* ancestor — the directory
    // the eventual mkdir actually has to write into.
    expect(exec).toHaveBeenCalledWith('sh', [
      '-c',
      'if [ -w "$1" ]; then echo writable; else echo readonly; fi',
      'sh',
      '/home/ubuntu',
    ]);
  });

  it('reports a single missing leaf under an existing parent', async () => {
    existingDirs(['/home/ubuntu/switch-agents']);

    expect(await inspectRemoteDir('host', REPO_DIR)).toMatchObject({
      status: 'missing',
      existingAncestor: '/home/ubuntu/switch-agents',
      missingSegments: ['internal-deployments'],
    });
  });

  it('falls back to the root when no ancestor exists', async () => {
    existingDirs([]);

    expect(await inspectRemoteDir('host', '/srv/agent')).toMatchObject({
      status: 'missing',
      existingAncestor: '/',
      missingSegments: ['srv', 'agent'],
    });
  });

  // A misspelt username lands on `/home/<typo>`, whose parent `/home` nobody
  // can write to. Reporting this as plainly "missing" offered a Create button
  // that could only ever fail with EACCES.
  it('reports a missing path under an unwritable ancestor as not creatable', async () => {
    existingDirs(['/home']);
    exec.mockResolvedValue({ stdout: 'readonly\n', stderr: '' });

    expect(await inspectRemoteDir('host', '/home/louis_amauduz/repo')).toEqual({
      dir: '/home/louis_amauduz/repo',
      status: 'missing',
      existingAncestor: '/home',
      missingSegments: ['louis_amauduz', 'repo'],
      creatable: false,
    });
  });

  it('ignores login-shell banner noise before the verdict', async () => {
    existingDirs(['/home/ubuntu']);
    exec.mockResolvedValue({ stdout: 'Welcome to Ubuntu\nwritable\n', stderr: '' });

    expect(await inspectRemoteDir('host', REPO_DIR)).toMatchObject({ creatable: true });
  });

  it('reports a path that is a file rather than offering to create it', async () => {
    stat.mockImplementation(async (path: string) =>
      path === REPO_DIR ? { path, type: 'file' } : null
    );

    expect(await inspectRemoteDir('host', REPO_DIR)).toMatchObject({
      dir: REPO_DIR,
      status: 'file',
    });
  });

  it('blames the ancestor when a parent is a file', async () => {
    stat.mockImplementation(async (path: string) => {
      if (path === '/home/ubuntu/switch-agents') return { path, type: 'file' };
      return null;
    });

    expect(await inspectRemoteDir('host', REPO_DIR)).toMatchObject({
      dir: '/home/ubuntu/switch-agents',
      status: 'file',
    });
  });

  // Treating an unreadable path as missing would offer to create a directory
  // that is already there, and the create would fail the same way the probe did.
  it('propagates a probe failure that is not absence', async () => {
    stat.mockRejectedValue(
      new FileSystemError('Permission denied: /home', FileSystemErrorCodes.PERMISSION_DENIED)
    );

    await expect(inspectRemoteDir('host', REPO_DIR)).rejects.toThrow('Permission denied');
  });

  it('rejects a relative path rather than resolving it against the login dir', async () => {
    await expect(inspectRemoteDir('host', 'switch-agents/repo')).rejects.toThrow(
      'must be an absolute path'
    );
    expect(stat).not.toHaveBeenCalled();
  });

  it('normalises a trailing slash', async () => {
    existingDirs([REPO_DIR]);

    expect(await inspectRemoteDir('host', `${REPO_DIR}/`)).toMatchObject({ dir: REPO_DIR });
  });

  it('closes the SFTP channel even when the probe throws', async () => {
    stat.mockRejectedValue(new Error('boom'));

    await expect(inspectRemoteDir('host', REPO_DIR)).rejects.toThrow('boom');
    expect(close).toHaveBeenCalled();
  });
});

describe('createRemoteDir', () => {
  it('creates the directory and its missing parents from the filesystem root', async () => {
    existingDirs(['/home/ubuntu']);

    await createRemoteDir('host', REPO_DIR);

    expect(mkdir).toHaveBeenCalledWith(REPO_DIR, { recursive: true });
    // Rooting at `/` is what lets the ancestors be created at all — an FS
    // rooted at the repo dir cannot create its own parents.
    expect(constructedWith).toEqual(['/', '/']);
  });

  it('is a no-op when the directory already exists', async () => {
    existingDirs([REPO_DIR]);

    await createRemoteDir('host', REPO_DIR);

    expect(mkdir).not.toHaveBeenCalled();
  });

  it('refuses to create under an unwritable ancestor instead of failing at mkdir', async () => {
    existingDirs(['/home']);
    exec.mockResolvedValue({ stdout: 'readonly\n', stderr: '' });

    await expect(createRemoteDir('host', '/home/louis_amauduz/repo')).rejects.toThrow(
      'no write access to /home'
    );
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('refuses to create over an existing file', async () => {
    stat.mockImplementation(async (path: string) =>
      path === REPO_DIR ? { path, type: 'file' } : null
    );

    await expect(createRemoteDir('host', REPO_DIR)).rejects.toThrow('a file already exists there');
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('closes the SFTP channel even when mkdir throws', async () => {
    existingDirs(['/home/ubuntu']);
    mkdir.mockRejectedValue(new Error('mkdir failed'));

    await expect(createRemoteDir('host', REPO_DIR)).rejects.toThrow('mkdir failed');
    expect(close).toHaveBeenCalled();
  });
});
