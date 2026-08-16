import { CircleStop, Play, RefreshCw, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@renderer/lib/ui/alert';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import { LogTail } from './log-tail';
import { remoteServerStore } from './remote-server-store';
import { StackSection, StackStatusRow } from './server-stack-section';

/**
 * Lifecycle for a managed Switch stack running in Docker on an SSH host. The
 * same section as the local one, reading through per-host accessors; resetting
 * it lives at the bottom of the server's page rather than here.
 */
export const RemoteServerControls = observer(function RemoteServerControls({
  sshHost,
  name,
}: {
  sshHost: string;
  name: string;
}) {
  const store = remoteServerStore;

  useEffect(() => {
    void store.init();
    void store.checkDocker(sshHost);
  }, [store, sshHost]);

  const status = store.statusFor(sshHost);
  const hostBlocked = store.isHostBlocked(sshHost);
  // Every lifecycle action rides the host's SSH connection, so none of them can
  // succeed while it is down — disable rather than let them fail (CHOO-1780).
  const transitioning = store.isTransitioning(sshHost) || hostBlocked;
  const running = store.isRunning(sshHost);
  const docker = store.dockerFor(sshHost);
  const dockerUnavailable = docker && !docker.available ? docker : null;
  // Report the version the host is actually on, not the one this build wants —
  // they diverge exactly when the page's drift notice has something to say.
  const runningVersion = status.deployedVersion ?? status.version;
  // A stack ahead of this build must not be started at all: doing so would point
  // it at a core older than its database has migrated to (CHOO-1736).
  const downgradeBlocked = store.driftFor(sshHost)?.direction === 'downgrade';
  const logs = store.logsFor(sshHost);

  return (
    <StackSection title={`Server on ${sshHost}`}>
      <StackStatusRow
        phase={hostBlocked ? 'unreachable' : status.phase}
        detail={running ? `switch-core ${runningVersion}` : 'not running'}
        actions={
          running ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={transitioning}
                onClick={() => void store.start(sshHost, name)}
              >
                <RefreshCw className="size-4" />
                Restart
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={transitioning}
                onClick={() => void store.stop(sshHost)}
              >
                <CircleStop className="size-4" />
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={transitioning || downgradeBlocked}
              onClick={() => void store.start(sshHost, name)}
            >
              <Play className="size-4" />
              {status.phase === 'error' && !downgradeBlocked ? 'Retry' : 'Start'}
            </Button>
          )
        }
      />

      <div className="space-y-3 p-3">
        {status.message && transitioning && (
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Spinner className="size-3.5" />
            <span>{status.message}</span>
          </div>
        )}

        {dockerUnavailable && (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertTitle>
              {dockerUnavailable.reason === 'not-installed'
                ? 'Docker is not installed on the host'
                : 'Docker is not running on the host'}
            </AlertTitle>
            <AlertDescription>{dockerUnavailable.detail}</AlertDescription>
          </Alert>
        )}

        {store.error && !dockerUnavailable && (
          <Alert variant="destructive">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{store.error}</AlertDescription>
          </Alert>
        )}

        {/* What the stack is, until it has said something itself. Once it is
          talking, its own output is the more useful thing to keep on screen. */}
        {logs.length > 0 ? (
          <LogTail lines={logs} placeholder={null} />
        ) : (
          <p className="text-xs text-foreground-muted">
            Runs the full Switch stack in Docker on {sshHost}, bridged to this computer over SSH
            {runningVersion ? ` (switch-core ${runningVersion})` : ''}. It keeps running when you
            close Switch Console; agents on this computer can reach it while Switch Console is open.
          </p>
        )}
      </div>
    </StackSection>
  );
});
