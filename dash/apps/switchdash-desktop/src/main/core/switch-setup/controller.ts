import { createRPCController } from '@shared/lib/ipc/rpc';
import { getRemoteSwitchSetupService } from './remote-switch-setup';
import { switchSetupService } from './switch-setup-service';

export const switchSetupController = createRPCController({
  listOnboardable: () => switchSetupService.listOnboardable(),
  listOnboardableRemote: async (sshHost: string) => {
    const service = await getRemoteSwitchSetupService(sshHost);
    const statuses = await service.listAgentTypeStatuses();
    return statuses.filter((s) => s.installed).map((s) => ({ agentId: s.agentId }));
  },
  getStatus: (agentId: string) => switchSetupService.getStatus(agentId),
  checkForUpdates: (agentId: string) => switchSetupService.checkForUpdates(agentId),
  install: (agentId: string) => switchSetupService.install(agentId),
  update: (agentId: string) => switchSetupService.update(agentId),
  uninstall: (agentId: string) => switchSetupService.uninstall(agentId),
});
