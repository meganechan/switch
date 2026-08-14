import type { AddressingPolicy } from '@shared/core/switch-servers/switch-servers';

/**
 * The addressing policy a newly created agent starts on, and the reverse
 * reading the "allow these agents" picker works from (CHOO-2137).
 */

/**
 * Its owner may address it, plus whichever agents the user explicitly grants.
 *
 * Owner-only rather than open, because an agent registered from someone's own
 * machine runs on their machine — everyone in every room being able to drive it
 * should be a decision, not the default. The owner is named as `owner: true`
 * rather than as a list of identities, so the rule keeps working when a new
 * workspace is connected or the agent changes hands.
 */
export function ownerOnlyPolicy(allowedAgentIds: string[]): AddressingPolicy {
  return {
    rules: [{ rooms: '*', room_groups: '*', users: [], agents: [...allowedAgentIds], owner: true }],
  };
}

/**
 * The agent ids the owner-only default also admits, or null when the policy has
 * been edited into a shape this shortcut cannot represent.
 *
 * Null hides the "allow these agents" control rather than having it rewrite a
 * rule set the user built by hand — a shortcut that silently discards the rules
 * around it is worse than one that steps aside.
 */
export function ownerRuleAgentIds(policy: AddressingPolicy | null): string[] | null {
  if (policy === null || policy.rules.length !== 1) return null;
  const rule = policy.rules[0];
  if (rule.owner !== true || rule.rooms !== '*' || rule.room_groups !== '*') return null;
  if (rule.users === '*' || rule.users.length > 0) return null;
  if (rule.agents === '*') return null;
  return rule.agents;
}
