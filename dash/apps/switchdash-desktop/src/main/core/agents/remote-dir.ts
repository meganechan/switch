import { posix as pathPosix } from 'node:path';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { sshConnectionIdForHost } from '@main/core/locations/location-transport';
import { ensureSshConnected } from '@main/core/ssh/connect/connect-agent-ssh';
import type { RemoteDirInspection } from '@shared/core/remote-hosts/remote-dir';

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
 * is it actually a directory, and if not, what is the deepest part of the path
 * that does exist (CHOO-1416).
 *
 * The filesystem is opened at the host's root rather than at the directory
 * under test, because the directory under test is exactly what may not exist.
 * Every other caller roots its FS at an agent's working directory, which also
 * scopes that FS's path-traversal guard to it — so an FS rooted at a missing
 * directory cannot even stat its way out to find what is there instead.
 *
 * `dir` must be absolute — a relative path would resolve against whatever
 * directory the SSH session happens to start in, which is not a thing the user
 * chose.
 *
 * A path that cannot be stat'd for any reason *other* than absence (permission
 * denied, dead connection) propagates rather than being reported as `missing`.
 * An unreadable path is not a missing one, and saying so would send the user
 * off to fix the wrong problem.
 */
export async function inspectRemoteDir(sshHost: string, dir: string): Promise<RemoteDirInspection> {
  if (!pathPosix.isAbsolute(dir)) {
    throw new Error(`Remote working directory must be an absolute path: ${dir}`);
  }
  const normalized = pathPosix.normalize(dir).replace(/\/+$/, '') || '/';

  const proxy = await ensureSshConnected(sshConnectionIdForHost(sshHost), sshHost);
  const fs = new SshFileSystem(proxy, '/');
  try {
    const entry = await fs.stat(normalized);
    if (entry) {
      return {
        dir: normalized,
        status: entry.type === 'dir' ? 'directory' : 'file',
        existingAncestor: '',
      };
    }

    let existingAncestor = '/';
    for (const ancestor of ancestorsOf(normalized)) {
      const ancestorEntry = await fs.stat(ancestor);
      if (ancestorEntry) {
        existingAncestor = ancestor;
        break;
      }
    }

    return { dir: normalized, status: 'missing', existingAncestor };
  } finally {
    fs.close();
  }
}
