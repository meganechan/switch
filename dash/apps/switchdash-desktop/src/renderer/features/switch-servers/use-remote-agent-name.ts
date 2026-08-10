import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { switchServersStore } from './switch-servers-store';

/**
 * The agent's registered Switch name (e.g. `claude-code.my-repo.me`), resolved
 * from the gateway. Prefer this over the local `Agent.name`, which is only the
 * working-directory basename and does not identify the agent. Falls back to
 * `fallback` while loading or when the agent can't be resolved.
 *
 * A server on an unreachable host is not queried: the name is cosmetic, and one
 * row per agent retrying a call that cannot succeed is pure noise. Reading the
 * observable here means the queries resume on their own when the host returns.
 */
export function useRemoteAgentName(
  serverId: string | null | undefined,
  switchAgentId: string | null | undefined,
  fallback: string
): string {
  const hostBlocked = serverId ? switchServersStore.isHostBlocked(serverId) : false;
  const query = useQuery({
    queryKey: ['remote-agent-name', serverId, switchAgentId],
    queryFn: () =>
      rpc.switchServers.getRemoteAgent({
        serverId: serverId as string,
        agentId: switchAgentId as string,
      }),
    enabled: !!serverId && !!switchAgentId && !hostBlocked,
  });
  return query.data?.name?.trim() || fallback;
}
