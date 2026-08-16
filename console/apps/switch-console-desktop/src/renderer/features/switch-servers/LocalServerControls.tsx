import { CircleStop, Play, RefreshCw, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@renderer/lib/ui/alert';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import { localServerStore } from './local-server-store';
import { LogTail } from './log-tail';
import { StackSection, StackStatusRow } from './server-stack-section';

/**
 * Lifecycle for the managed local Switch stack: live status, Docker guidance,
 * and start / restart / stop. Rendered as its own section of the server's page;
 * resetting it lives at the bottom of that page rather than here.
 */
export const LocalServerControls = observer(function LocalServerControls() {
  const store = localServerStore;

  useEffect(() => {
    void store.checkDocker();
  }, [store]);

  const transitioning = store.isTransitioning;
  const dockerUnavailable = store.docker && !store.docker.available ? store.docker : null;
  // Report the version the stack is actually on, not the one this build wants —
  // they diverge exactly when the page's drift notice has something to say.
  const runningVersion = store.status?.deployedVersion ?? store.status?.version ?? '';
  // A stack ahead of this build must not be started at all: doing so would point
  // it at a core older than its database has migrated to (CHOO-1736).
  const downgradeBlocked = store.drift?.direction === 'downgrade';

  return (
    <StackSection title="Local server">
      <StackStatusRow
        phase={store.phase}
        detail={store.isRunning ? `switch-core ${runningVersion}` : 'not running'}
        actions={
          store.isRunning ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={transitioning}
                onClick={() => void store.start()}
              >
                <RefreshCw className="size-4" />
                Restart
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={transitioning}
                onClick={() => void store.stop()}
              >
                <CircleStop className="size-4" />
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={transitioning || downgradeBlocked}
              onClick={() => void store.start()}
            >
              <Play className="size-4" />
              {store.phase === 'error' && !downgradeBlocked ? 'Retry' : 'Start'}
            </Button>
          )
        }
      />

      <div className="space-y-3 p-3">
        {store.message && transitioning && (
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Spinner className="size-3.5" />
            <span>{store.message}</span>
          </div>
        )}

        {dockerUnavailable && (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertTitle>
              {dockerUnavailable.reason === 'not-installed'
                ? 'Docker is not installed'
                : 'Docker is not running'}
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
        {store.logs.length > 0 ? (
          <LogTail lines={store.logs} placeholder={null} />
        ) : (
          <p className="text-xs text-foreground-muted">
            Runs the full Switch stack on this computer with Docker
            {runningVersion ? ` (switch-core ${runningVersion})` : ''}. It keeps running when you
            close Switch Console — your agents, rooms and messaging apps come back with it.
          </p>
        )}
      </div>
    </StackSection>
  );
});
