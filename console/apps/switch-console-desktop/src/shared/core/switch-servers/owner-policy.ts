import type { AddressingPolicy } from '@shared/core/switch-servers/switch-servers';

/**
 * The addressing policy a newly created agent starts on, the reverse reading
 * the "allow these agents" picker works from, and the mapping between a policy
 * and the three choices the UI offers for it (CHOO-2137).
 *
 * Shared rather than renderer-local because the main process reads policies
 * too — the owner-recognition probe in `gateway-client.ts` asks the same
 * question of a policy the chooser does, and one reading of `owner: true` that
 * both sides use is the point.
 */

/**
 * Whether any rule admits the agent's owner. Such a policy leans on the owner
 * having claimed a messaging identity, so it is the question both the rule
 * editor's warning and the messaging-apps warning are really asking.
 *
 * Any rule carrying `owner: true` counts, not just the {@link addressingModeOf}
 * `owner` shape: a hand-built rule set that names the owner depends on owner
 * recognition exactly as much as the shortcut does. A null policy is open, and
 * an open agent answers everyone regardless of who they are recognised as.
 */
export function policyNamesOwner(policy: AddressingPolicy | null): boolean {
  return policy !== null && policy.rules.some((rule) => rule.owner === true);
}

/**
 * What the "Who can send instructions" chooser offers.
 *
 * `owner` and `anyone` are the two answers almost everyone wants, each backed
 * by one policy shape; `custom` is the rule editor for everything else.
 */
export type AddressingMode = 'owner' | 'anyone' | 'custom';

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

/**
 * "Anyone" written as a rule, for the switch into the rule editor.
 *
 * An empty rule list is already open (both here and in switch-core, where
 * `AddressingPolicy.is_open()` allows everything), but an editor with no rules
 * in it does not show what the previous choice meant — this does.
 */
function anyoneRulePolicy(): AddressingPolicy {
  return { rules: [{ rooms: '*', room_groups: '*', users: '*', agents: '*', owner: false }] };
}

/**
 * Which of the three choices a stored policy is. `custom` is everything the
 * two shortcuts cannot express, including a policy hand-edited into a shape
 * {@link ownerRuleAgentIds} steps aside from.
 */
export function addressingModeOf(policy: AddressingPolicy | null): AddressingMode {
  if (policy === null || policy.rules.length === 0) return 'anyone';
  return ownerRuleAgentIds(policy) === null ? 'custom' : 'owner';
}

/**
 * The policy a chooser change produces, seeded from the policy being left.
 *
 * Moving to `custom` carries the current policy into the editor so the rules
 * start from what the previous choice meant; moving to either shortcut
 * replaces it, since neither can hold arbitrary rules.
 */
export function policyForMode(
  mode: AddressingMode,
  current: AddressingPolicy | null
): AddressingPolicy | null {
  if (mode === 'anyone') return null;
  if (mode === 'owner') return ownerOnlyPolicy(ownerRuleAgentIds(current) ?? []);
  if (current === null || current.rules.length === 0) return anyoneRulePolicy();
  return current;
}
