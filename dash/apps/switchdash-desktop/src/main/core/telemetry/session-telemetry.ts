import { telemetryService } from '@main/lib/telemetry';
import { sessionRuntimeManager } from '../sessions/session-runtime-manager';
import { sessionService } from '../sessions/session-service';

sessionService.on('session:created', (session, params) => {
  telemetryService.capture('session_created', {
    strategy: 'blank',
    has_initial_prompt: Boolean(params.initialPrompt?.trim()),
    has_issue: 'none',
    provider: session.providerId,
  });
});

sessionRuntimeManager.hooks.on('session:provisioned', ({ projectId, sessionId }) => {
  telemetryService.capture('session_provisioned', { project_id: projectId, session_id: sessionId });
});
