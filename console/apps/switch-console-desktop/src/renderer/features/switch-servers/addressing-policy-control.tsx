import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import {
  type AddressingMode,
  addressingModeOf,
  policyForMode,
  policyNamesOwner,
} from '@shared/core/switch-servers/owner-policy';
import type { AddressingPolicy, LinkedIdentity } from '@shared/core/switch-servers/switch-servers';
import { AddressingPolicyEditor, type OptionItem } from './addressing-policy-editor';

const MODE_ORDER: AddressingMode[] = ['owner', 'ownerAndAgents', 'anyone', 'custom'];

const MODE_LABELS: Record<AddressingMode, string> = {
  owner: 'Only me (default)',
  ownerAndAgents: 'Only me and my agents',
  anyone: 'Anyone',
  custom: 'Custom rules',
};

const MODE_HINTS: Record<AddressingMode, string> = {
  ownerAndAgents:
    'You, and any agent you own — so one of your agents can hand this one work. Nobody else.',
  owner: 'Only you, in person. Agents cannot send it instructions, including your own.',
  anyone: 'Anyone in this agent’s rooms can send it instructions.',
  custom: 'Rules say exactly who can send instructions, and in which rooms.',
};

/**
 * Who may address an agent, as one choice out of four (CHOO-2137).
 *
 * The three answers people actually want are each a policy shape rather than a
 * form to fill in; the rule editor stays available behind the fourth for
 * everything else. Shared by the creation modal and the agent's settings page
 * so a policy is changed the same way it was set.
 */
export function AddressingPolicyControl({
  value,
  onChange,
  rooms,
  roomGroups,
  users,
  agents,
  linkedIdentities,
  onClaimIdentity,
  onOpenMessagingApps,
  disabled = false,
}: {
  value: AddressingPolicy | null;
  onChange: (next: AddressingPolicy | null) => void;
  rooms: OptionItem[];
  roomGroups: OptionItem[];
  users: OptionItem[];
  agents: OptionItem[];
  /** Messaging accounts the signed-in user has claimed on this server. An
   * owner rule resolves through these, so an empty list means such a rule
   * admits nobody. Null while unknown — no warning is drawn from a list that
   * has not arrived. */
  linkedIdentities: LinkedIdentity[] | null;
  /** Opens the claim-your-identity modal. Null where a modal cannot be opened
   * over the current one (the add-agent dialog), which sends the warning to
   * `onOpenMessagingApps` instead of claiming in place. */
  onClaimIdentity: (() => void) | null;
  /** Opens the server's Messaging apps, where an account is linked when it
   * cannot be claimed from here. */
  onOpenMessagingApps: () => void;
  disabled?: boolean;
}) {
  // Custom is sticky while it is chosen: a rule set can pass through a shape
  // one of the shortcuts also describes (owner-only, or no rules at all), and
  // the editor closing under the user mid-edit would be the wrong reading of
  // that. Every other mode is read straight off the policy, so a value that
  // arrives after mount — the settings page loads it — selects itself.
  const [customChosen, setCustomChosen] = useState(false);
  // The rules the user last had in the editor, kept across a trip through one
  // of the shortcuts so choosing Custom again does not start from scratch.
  const [customDraft, setCustomDraft] = useState<AddressingPolicy | null>(null);

  const mode: AddressingMode = customChosen ? 'custom' : addressingModeOf(value);

  const selectMode = (next: AddressingMode) => {
    if (next === mode) return;
    if (mode === 'custom') setCustomDraft(value);
    setCustomChosen(next === 'custom');
    onChange(policyForMode(next, next === 'custom' ? (customDraft ?? value) : value));
  };

  return (
    <div className="flex flex-col gap-3">
      <Select
        value={mode}
        onValueChange={(next) => selectMode(next as AddressingMode)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          {/* The label, not the value. Left to itself the trigger renders what
            is stored — "ownerAndAgents" — so the box contradicted the option
            just picked from it. */}
          <SelectValue>{MODE_LABELS[mode]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MODE_ORDER.map((option) => (
            <SelectItem key={option} value={option}>
              {MODE_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-xs text-foreground-muted">{MODE_HINTS[mode]}</span>

      {policyNamesOwner(value) && linkedIdentities?.length === 0 && (
        <OwnerUnreachableWarning
          onClaimIdentity={onClaimIdentity}
          onOpenMessagingApps={onOpenMessagingApps}
        />
      )}

      {mode === 'custom' && value !== null && (
        <AddressingPolicyEditor
          value={value}
          onChange={onChange}
          rooms={rooms}
          roomGroups={roomGroups}
          users={users}
          agents={agents}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/**
 * Shown when a rule admits the agent's owner but the signed-in user has claimed
 * no messaging account, which is exactly the case where a privacy control ends
 * up admitting nobody. Silence here would look like a working restriction right
 * up until someone wonders why the agent never answers.
 */
function OwnerUnreachableWarning({
  onClaimIdentity,
  onOpenMessagingApps,
}: {
  onClaimIdentity: (() => void) | null;
  onOpenMessagingApps: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-background-1 px-2 py-1.5 text-xs">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span>
          This admits the agent&apos;s owner, but you have not linked a messaging account on this
          server — so Switch cannot tell that a message from you is from you, and the agent will
          answer nobody.
        </span>
        {onClaimIdentity === null ? (
          // Naming the place is not the same as going there. The claim modal
          // cannot open over this one, so the warning opens Messaging apps
          // itself rather than leaving the user to find it.
          <button
            type="button"
            className="w-fit cursor-pointer text-foreground underline underline-offset-2"
            onClick={onOpenMessagingApps}
          >
            Open Messaging apps
          </button>
        ) : (
          <Button variant="outline" size="sm" className="self-start" onClick={onClaimIdentity}>
            Link my messaging account
          </Button>
        )}
      </div>
    </div>
  );
}
