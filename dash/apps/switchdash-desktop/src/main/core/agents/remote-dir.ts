import { posix as pathPosix } from 'node:path';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { sshConnectionIdForHost } from '@main/core/locations/location-transport';
import { ensureSshConnected } from '@main/core/ssh/connect/connect-agent-ssh';
import { log } from '@main/lib/logger';
import type { RemoteDirInspection } from '@shared/core/remote-hosts/remote-dir';

/**
 * Both helpers open their {@link SshFileSystem} at the filesystem root rather
 * than at the directory under test, because the directory under test is exactly
 * what may not exist. Every other caller roots its FS at an agent's working
 * directory, which also scopes that FS's path-traversal guard to it — and that
 * guard is why a missing *parent* cannot be created through the ordinary write
 * path: recursive mkdir walks up only as far as its own root. That containment
 * is deliberate, so these two helpers reach past it explicitly and are the only
 * place allowed to, instead of the guard being widened for everyone.
 */
async function rootFsFor(sshHost: string): Promise<SshFileSystem> {
  const proxy = await ensureSshConnected(sshConnectionIdForHost(sshHost), sshHost);
  return new SshFileSystem(proxy, '/');
}

/** Absolute ancestors of `dir`, deepest first, stopping above the root. */
function ancestorsOf(dir: string): string[] {
  const ancestors: string[] = [];
  let current = pathPosix.dirname(dir);
  while (current !== '/' && current !== '.' && !ancestors.includes(current)) {
    ancestors.push(current);
    current = pathPosix.dirname(current);
  }
  return ancestors;
}

/**
 * Inspect a prospective remote working directory on `sshHost`: does it exist,
 * is it actually a directory, and if it is missing, how much of its path is
 * missing with it (CHOO-1416).
 *
 * `dir` must be absolute — a relative path would resolve against whatever
 * directory the SSH session happens to start in, which is not a thing the user
 * chose.
 *
 * A path that cannot be stat'd for any reason *other* than absence (permission
 * denied, dead connection) propagates rather than being reported as `missing`.
 * Reporting an unreadable path as missing would offer to create a directory
 * that is already there, and the create would then fail for the same reason the
 * probe did.
 */
export async function inspectRemoteDir(sshHost: string, dir: string): Promise<RemoteDirInspection> {
  if (!pathPosix.isAbsolute(dir)) {
    throw new Error(`Remote working directory must be an absolute path: ${dir}`);
  }
  const normalized = pathPosix.normalize(dir).replace(/\/+$/, '') || '/';

  const fs = await rootFsFor(sshHost);
  try {
    const entry = await fs.stat(normalized);
    if (entry) {
      return {
        dir: normalized,
        status: entry.type === 'dir' ? 'directory' : 'file',
        existingAncestor: '',
        missingSegments: [],
      };
    }

    // Walk up to the deepest ancestor that does exist, so the caller can say
    // how much of the path is absent rather than just naming the leaf.
    let existingAncestor = '/';
    for (const ancestor of ancestorsOf(normalized)) {
      const ancestorEntry = await fs.stat(ancestor);
      if (ancestorEntry) {
        // A file where a parent directory should be makes the whole path
        // uncreatable; report it against the offending path, not the leaf.
        if (ancestorEntry.type !== 'dir') {
          return {
            dir: ancestor,
            status: 'file',
            existingAncestor: '',
            missingSegments: [],
          };
        }
        existingAncestor = ancestor;
        break;
      }
    }

    const missingSegments = normalized
      .slice(existingAncestor === '/' ? 1 : existingAncestor.length + 1)
      .split('/')
      .filter(Boolean);

    return { dir: normalized, status: 'missing', existingAncestor, missingSegments };
  } finally {
    fs.close();
  }
}

/**
 * Create `dir` (and any missing parents) on `sshHost`.
 *
 * Only ever called after the user has been shown the path and has explicitly
 * asked for it — creating a directory on someone's host is not something to do
 * on their behalf because a write happened to fail. What was created is logged,
 * since the user sees a directory appear but not how much of the path came with
 * it.
 */
export async function createRemoteDir(sshHost: string, dir: string): Promise<void> {
  const inspection = await inspectRemoteDir(sshHost, dir);
  if (inspection.status === 'directory') return;
  if (inspection.status === 'file') {
    throw new Error(`Cannot create ${inspection.dir} on ${sshHost}: a file already exists there`);
  }

  const fs = await rootFsFor(sshHost);
  try {
    await fs.mkdir(inspection.dir, { recursive: true });
  } finally {
    fs.close();
  }
  log.info('remote-dir: created remote working directory', {
    sshHost,
    dir: inspection.dir,
    created: inspection.missingSegments.length,
  });
}
