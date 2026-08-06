import { Loader2 } from 'lucide-react';
import type { RemoteDirInspection } from '@shared/core/remote-hosts/remote-dir';

/**
 * Inline notice for a remote working directory that is not usable (CHOO-1416),
 * alongside `HostReachabilityNotice` in the add-agent modal's run-location
 * field.
 *
 * The directory is free text and was previously only touched at write time, so
 * a wrong path surfaced as a raw `FileSystemError` after an identity had
 * already been minted. Checking it when the user commits the path means they
 * find out while the field is still in front of them.
 *
 * switchdash does not create the directory — it says which path is missing and
 * leaves that to the user. Naming the deepest part of the path that *does*
 * exist is what separates "not made yet" from a typo.
 *
 * Renders nothing when the directory is fine, so it can be dropped into the
 * form unconditionally.
 */
export function RemoteDirNotice({
  sshHost,
  inspection,
  checking,
  error,
}: {
  sshHost: string;
  inspection: RemoteDirInspection | undefined;
  checking: boolean;
  error: Error | null;
}) {
  if (checking) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-background-1 px-2.5 py-2 text-xs text-foreground-muted">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <span>Checking the working directory on {sshHost}…</span>
      </div>
    );
  }

  // A probe that failed for any reason other than absence (permission denied, a
  // dropped connection) is not evidence the directory is missing, and is
  // reported as itself so the user does not go and fix the wrong thing.
  if (error) {
    return (
      <NoticeShell>
        <p className="text-xs font-medium text-foreground">
          Couldn’t check the working directory on {sshHost}
        </p>
        <p className="text-xs break-words text-foreground-muted">{error.message}</p>
      </NoticeShell>
    );
  }

  if (!inspection || inspection.status === 'directory') return null;

  if (inspection.status === 'file') {
    return (
      <NoticeShell>
        <p className="text-xs font-medium text-foreground">
          <span className="font-mono break-all">{inspection.dir}</span> is a file
        </p>
        <p className="text-xs text-foreground-passive">
          An agent's working directory has to be a directory. Choose another path.
        </p>
      </NoticeShell>
    );
  }

  return (
    <NoticeShell>
      <p className="text-xs font-medium text-foreground">
        <span className="font-mono break-all">{inspection.dir}</span> does not exist on {sshHost}
      </p>
      <p className="text-xs break-words text-foreground-muted">
        The deepest part of that path that exists is{' '}
        <span className="font-mono">{inspection.existingAncestor}</span>.
      </p>
      <p className="text-xs text-foreground-passive">
        Create the directory on the host and set the location again, or correct the path.
      </p>
    </NoticeShell>
  );
}

function NoticeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-amber-500/30 bg-amber-500/8 px-2.5 py-2">
      {children}
    </div>
  );
}
