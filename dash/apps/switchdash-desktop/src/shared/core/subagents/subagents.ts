/**
 * A Claude Code subagent of a parent Switch agent. Subagents are defined as
 * `.claude/agents/<name>.md` files in the parent's working directory and, once
 * brought into Switch by the connector `configure` skill, registered on the
 * gateway as child agents with their own credentials written to
 * `.claude/switch-subagents/<name>.settings.json`.
 *
 * switchdash discovers them from those credential files (the launchable set) and
 * reconciles against the gateway's children of the parent. A subagent is not a
 * switchdash `agent` row of its own — sessions started "as a subagent" are owned
 * by the parent agent and carry the subagent name in their config.
 */
export type Subagent = {
  /** switchdash id of the parent agent. */
  parentAgentId: string;
  /** Bare subagent name — the `.md` file stem and the `--agent` value. */
  name: string;
  description: string | null;
  model: string | null;
  /** The subagent's own Switch agent id, read from its credentials file. */
  switchAgentId: string | null;
  apiEndpoint: string | null;
  /** Switch server the subagent belongs to (its parent's server). */
  serverId: string | null;
  /**
   * Whether the gateway lists this subagent as a child of the parent. `null`
   * when reconciliation could not run (parent has no linked server, or the app
   * is not signed in to it) — discovery still returns the local subagent.
   */
  registered: boolean | null;
};

/** A gateway child agent of the parent with no matching local credentials file. */
export type RemoteOnlySubagent = {
  /** Display name (the parent-name prefix stripped). */
  name: string;
  switchAgentId: string;
};

export type SubagentListResult = {
  parentAgentId: string;
  /** Subagents discovered locally, reconciled against the gateway when possible. */
  subagents: Subagent[];
  /** Gateway children of the parent with no local credentials file (drift). */
  remoteOnly: RemoteOnlySubagent[];
  /** Whether gateway reconciliation ran. When false, every `registered` is null. */
  reconciled: boolean;
};
