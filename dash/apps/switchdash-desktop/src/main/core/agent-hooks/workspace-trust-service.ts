import type { AgentProviderId } from '@shared/core/providers/agent-provider-registry';
import { claudeTrustService } from './claude-trust-service';
import { cursorTrustService } from './cursor-trust-service';

type WorkspaceTrustLocalArgs = {
  providerId: AgentProviderId;
  cwd?: string;
  homedir: string;
  force?: boolean;
};

type WorkspaceTrustProvider = {
  maybeAutoTrustLocal(args: WorkspaceTrustLocalArgs): Promise<void>;
};

export class WorkspaceTrustService {
  constructor(private readonly providers: readonly WorkspaceTrustProvider[]) {}

  async maybeAutoTrustLocal(args: WorkspaceTrustLocalArgs): Promise<void> {
    for (const provider of this.providers) {
      await provider.maybeAutoTrustLocal(args);
    }
  }
}

export const workspaceTrustService = new WorkspaceTrustService([
  claudeTrustService,
  cursorTrustService,
]);
