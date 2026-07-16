import type { LocalSubagent } from '@switchdash/core/agents/plugins';
import type { RemoteChildAgent } from '@main/core/switch-servers/gateway-client';
import type { RemoteOnlySubagent, Subagent } from '@shared/core/subagents/subagents';

/** Strip the `<parent>.` prefix from a server-side child name, if present. */
function displayChildName(childName: string, parentName: string): string {
  const prefix = `${parentName}.`;
  return childName.startsWith(prefix) ? childName.slice(prefix.length) : childName;
}

/**
 * Reconcile locally-discovered subagents against the gateway's children of the
 * parent. Pure so it can be unit-tested without a gateway. When `remote` is
 * null (reconciliation could not run) every subagent's `registered` is null and
 * no drift is reported.
 */
export function reconcileSubagents(args: {
  parentAgentId: string;
  serverId: string | null;
  local: LocalSubagent[];
  remote: { parentName: string; children: RemoteChildAgent[] } | null;
}): { subagents: Subagent[]; remoteOnly: RemoteOnlySubagent[] } {
  const { parentAgentId, serverId, local, remote } = args;

  if (!remote) {
    return {
      subagents: local.map((l) => ({ ...l, parentAgentId, serverId, registered: null })),
      remoteOnly: [],
    };
  }

  const childIds = new Set(remote.children.map((c) => c.id));
  const matchedChildIds = new Set<string>();

  const subagents: Subagent[] = local.map((l) => {
    const registered = !!l.switchAgentId && childIds.has(l.switchAgentId);
    if (registered && l.switchAgentId) matchedChildIds.add(l.switchAgentId);
    return { ...l, parentAgentId, serverId, registered };
  });

  const remoteOnly: RemoteOnlySubagent[] = remote.children
    .filter((c) => !matchedChildIds.has(c.id))
    .map((c) => ({ name: displayChildName(c.name, remote.parentName), switchAgentId: c.id }));

  return { subagents, remoteOnly };
}
