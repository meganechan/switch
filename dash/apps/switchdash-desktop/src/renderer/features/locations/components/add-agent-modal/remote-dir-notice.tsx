import { FolderPlus, Loader2 } from 'lucide-react';
import { Button } from '@renderer/lib/ui/button';
import type { RemoteDirInspection } from '@shared/core/remote-hosts/remote-dir';

/**
 * Inline notice for a remote working directory that does not exist yet
 * (CHOO-1416), alongside {@link HostReachabilityNotice} in the add-agent
 * modal's run-location field.
 *
 * The directory is free text and was previously only touched at write time, so
 * a typo surfaced as a raw `FileSystemError` after an identity had already been
 * minted. Checking it when the user commits the path means they find out while
 * the field is still in front of them.
 *
 * Creating it is offered, never assumed: `mkdir -p` on whatever was typed would
 * turn a typo into a real directory just as silently as the old error was
 * abrupt. Naming the path — and, when several segments are missing, saying so —
 * is what lets the user tell "not created yet" apart from "wrong path".
 *
 * Renders nothing when the directory is fine, so it can be dropped into the
 * form unconditionally.
 */
export function RemoteDirNotice({
  sshHost,
  inspection,
  checking,
  error,
  creating,
  onCreate,
}: {
  sshHost: string;
  inspection: RemoteDirInspection | undefined;
  checking: boolean;
  error: Error | null;
  creating: boolean;
  onCreate: () => void;
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
  // dropped connection) is not evidence the directory is missing, so it is
  // reported as itself rather than as an offer to create anything.
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
          <span className="font-mono">{inspection.dir}</span> is a file
        </p>
        <p className="text-xs text-foreground-passive">
          An agent's working directory has to be a directory. Choose another path.
        </p>
      </NoticeShell>
    );
  }

  const { missingSegments, existingAncestor } = inspection;

  // Nothing can be created under an ancestor the SSH user cannot write to, so
  // the offer is withheld rather than made and then failed. In practice this is
  // usually a misspelt path under `/home` — the user's own directory would be
  // writable, so landing on an unwritable one says the name is wrong.
  if (!inspection.creatable) {
    return (
      <NoticeShell>
        <p className="text-xs font-medium text-foreground">
          <span className="font-mono break-all">{inspection.dir}</span> does not exist on {sshHost},
          and cannot be created
        </p>
        <p className="text-xs break-words text-foreground-muted">
          You do not have write access to <span className="font-mono">{existingAncestor}</span>.
          Check the path for a typo, or create the directory on the host yourself.
        </p>
      </NoticeShell>
    );
  }

  return (
    <NoticeShell>
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-xs font-medium text-foreground">
            <span className="font-mono break-all">{inspection.dir}</span> does not exist on{' '}
            {sshHost}
          </p>
          {missingSegments.length > 1 && (
            <p className="text-xs break-words text-foreground-muted">
              {missingSegments.length} directories would be created — everything below{' '}
              <span className="font-mono">{existingAncestor}</span>. Check the path is right before
              creating it.
            </p>
          )}
          <p className="text-xs text-foreground-passive">
            Create it, or correct the path and set the location again.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={creating}
          onClick={onCreate}
        >
          {creating ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <FolderPlus className="size-3" />
          )}
          Create directory
        </Button>
      </div>
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
