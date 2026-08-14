import { CircleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@renderer/lib/ui/badge';
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
  ownerOnlyPolicy,
  ownerRuleAgentIds,
  policyForMode,
  policyNamesOwner,
} from '@shared/core/switch-servers/owner-policy';
import type { AddressingPolicy, LinkedIdentity } from '@shared/core/switch-servers/switch-servers';
import { AddressingPolicyEditor, type OptionItem } from './addressing-policy-editor';

const MODE_LABELS: Record<AddressingMode, string> = {
  owner: 'Only me (default)',
  anyone: 'Anyone',
  custom: 'Custom rules',
};

const MODE_HINTS: Record<AddressingMode, string> = {
  owner: 'Only you can send this agent instructions, plus any agents you allow below.',
  anyone: 'Anyone in this agent’s rooms can send it instructions.',
  custom: 'Rules say exactly who can send instructions, and in which rooms.',
};

/**
 * Who may address an agent, as one choice out of three (CHOO-2137).
 *
 * The two answers people actually want — only me, or anyone — are each a
 * policy shape rather than a form to fill in; the rule editor stays available
 * behind the third choice for everything else. Shared by the creation modal and
 * the agent's settings page so a policy is changed the same way it was set.
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
   * over the current one (the add-agent dialog), which turns the warning into
   * a statement rather than an action that would discard the form. */
  onClaimIdentity: (() => void) | null;
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
  const allowedAgentIds = ownerRuleAgentIds(value) ?? [];

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
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="owner">{MODE_LABELS.owner}</SelectItem>
          <SelectItem value="anyone">{MODE_LABELS.anyone}</SelectItem>
          <SelectItem value="custom">{MODE_LABELS.custom}</SelectItem>
        </SelectContent>
      </Select>

      <span className="text-xs text-foreground-muted">{MODE_HINTS[mode]}</span>

      {policyNamesOwner(value) && linkedIdentities?.length === 0 && (
        <OwnerUnreachableWarning onClaimIdentity={onClaimIdentity} />
      )}

      {mode === 'owner' && (
        <AllowedAgentsPicker
          options={agents}
          selected={allowedAgentIds}
          disabled={disabled}
          onChange={(ids) => onChange(ownerOnlyPolicy(ids))}
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
function OwnerUnreachableWarning({ onClaimIdentity }: { onClaimIdentity: (() => void) | null }) {
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
          <span className="text-foreground-muted">
            Link your account from the server page, under “Messaging apps”.
          </span>
        ) : (
          <Button variant="outline" size="sm" className="self-start" onClick={onClaimIdentity}>
            Link my messaging account
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Agents allowed to address this agent alongside its owner — the
 * manager/orchestrator case, where one agent delegates to another and no human
 * is in the loop.
 *
 * Deliberately narrower than the rule editor: the common grant is "let these
 * agents talk to it", and expressing that through four dimensions is a lot of
 * form for one idea.
 */
function AllowedAgentsPicker({
  options,
  selected,
  disabled,
  onChange,
}: {
  options: OptionItem[];
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const remaining = options.filter((o) => !selected.includes(o.id));
  const labelFor = (id: string) => options.find((o) => o.id === id)?.label ?? id;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <span className="text-xs font-medium text-foreground-muted">Also allow these agents</span>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-[180px] truncate">{labelFor(id)}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${labelFor(id)}`}
                  className="hover:bg-muted rounded-sm"
                  onClick={() => onChange(selected.filter((x) => x !== id))}
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <Select
        value=""
        disabled={disabled || remaining.length === 0}
        onValueChange={(next) => {
          if (typeof next === 'string' && next) onChange([...selected, next]);
        }}
      >
        <SelectTrigger className="h-7 w-full">
          <SelectValue
            placeholder={
              remaining.length === 0
                ? 'No other agents on this server'
                : 'Add an agent that may address it…'
            }
          />
        </SelectTrigger>
        <SelectContent>
          {remaining.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
