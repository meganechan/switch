import { CircleAlert, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import type {
  AddressingDimension,
  AddressingPolicy,
  AddressingRule,
  LinkedIdentity,
} from '@shared/core/switch-servers/switch-servers';

export type OptionItem = { id: string; label: string };

type DimKey = 'rooms' | 'room_groups' | 'users' | 'agents';

const EMPTY_RULE: AddressingRule = {
  rooms: '*',
  room_groups: '*',
  users: '*',
  agents: '*',
  owner: false,
};

/** A "Specific" dimension with an empty list matches nobody. */
function matchesNobody(dim: AddressingDimension): boolean {
  return dim !== '*' && dim.length === 0;
}

/**
 * Why a rule can never match (so it would silently never apply), or null when it
 * is effective. A context dimension (rooms / room groups) that matches nobody
 * kills the rule outright; the sender is dead only when BOTH users and agents
 * match nobody AND the rule does not admit the owner (an empty list on just one
 * kind is the intentional "none", and owner-only is the whole point of the
 * default policy).
 */
function deadRuleReason(rule: AddressingRule): string | null {
  if (matchesNobody(rule.rooms)) return 'Rooms is Specific but empty — this rule never applies.';
  if (matchesNobody(rule.room_groups)) {
    return 'Room groups is Specific but empty — this rule never applies.';
  }
  if (rule.owner !== true && matchesNobody(rule.users) && matchesNobody(rule.agents)) {
    return 'Both Users and Agents are empty — no sender can match, so this rule never applies.';
  }
  return null;
}

/** Whether a policy contains any rule that can never match. Callers disable Save
 * so an inert rule can't be persisted silently. */
export function policyHasDeadRule(policy: AddressingPolicy | null): boolean {
  return policy !== null && policy.rules.some((r) => deadRuleReason(r) !== null);
}

/** Whether any rule admits the agent's owner. Such a policy leans on the owner
 * having claimed a messaging identity, which is what the warning below checks. */
export function policyNamesOwner(policy: AddressingPolicy | null): boolean {
  return policy !== null && policy.rules.some((r) => r.owner === true);
}

/**
 * Controlled editor for an agent's scoped addressing policy (CHOO-1585). A null
 * value means "open" (anyone may address the agent); a policy value restricts to
 * senders matching a rule. Option lists (rooms / room groups / users / agents)
 * are supplied by the parent so this component stays presentational and reusable
 * across the settings page and the creation modal.
 */
export function AddressingPolicyEditor({
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
  const restricted = value !== null;
  const rules = value?.rules ?? [];
  // Which rule (by index) is currently open for editing. Loaded rules start
  // collapsed (shown as a read-only summary); a freshly added rule opens for
  // editing. Only one rule is edited at a time.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const optionsFor = (key: DimKey): OptionItem[] => {
    if (key === 'rooms') return rooms;
    if (key === 'room_groups') return roomGroups;
    if (key === 'users') return users;
    return agents;
  };

  const setRules = (next: AddressingRule[]) => onChange({ rules: next });
  const updateRule = (index: number, next: AddressingRule) =>
    setRules(rules.map((r, i) => (i === index ? next : r)));

  const addRule = () => {
    setRules([...rules, EMPTY_RULE]);
    setEditingIndex(rules.length);
  };
  const removeRule = (index: number) => {
    setRules(rules.filter((_r, i) => i !== index));
    setEditingIndex((prev) =>
      prev === null || prev === index ? null : prev > index ? prev - 1 : prev
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <Select
        value={restricted ? 'restricted' : 'open'}
        onValueChange={(next) => onChange(next === 'restricted' ? { rules } : null)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open — anyone in the room can address it</SelectItem>
          <SelectItem value="restricted">Restricted — only matching rules</SelectItem>
        </SelectContent>
      </Select>

      {restricted && policyNamesOwner(value) && linkedIdentities?.length === 0 && (
        <OwnerUnreachableWarning onClaimIdentity={onClaimIdentity} />
      )}

      {restricted && (
        <div className="flex flex-col gap-3">
          {rules.length === 0 && (
            <p className="text-destructive text-xs">
              No rules — a restricted policy with no rules means nobody can address this agent. Add
              a rule or switch back to Open.
            </p>
          )}
          {rules.map((rule, index) =>
            index === editingIndex ? (
              <div
                key={index}
                className="border-primary/50 flex flex-col gap-2 rounded-md border bg-background-2/40 p-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Editing rule {index + 1}</span>
                  {!disabled && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeRule(index)}
                      aria-label="Remove rule"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <DimensionRow
                  label="Rooms"
                  value={rule.rooms}
                  options={optionsFor('rooms')}
                  allowNone={false}
                  disabled={disabled}
                  onChange={(rooms) => updateRule(index, { ...rule, rooms })}
                />
                <DimensionRow
                  label="Room groups"
                  value={rule.room_groups}
                  options={optionsFor('room_groups')}
                  allowNone={false}
                  disabled={disabled}
                  onChange={(room_groups) => updateRule(index, { ...rule, room_groups })}
                />
                <label className="flex cursor-pointer items-start gap-2 pl-1">
                  <Checkbox
                    className="mt-0.5"
                    checked={rule.owner === true}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      updateRule(index, { ...rule, owner: checked === true })
                    }
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium">The agent&apos;s owner</span>
                    <span className="text-xs text-foreground-muted">
                      Resolved when the message arrives, so it survives connecting a new workspace
                      or the agent changing hands. Needs the owner to have linked their messaging
                      account.
                    </span>
                  </span>
                </label>
                <DimensionRow
                  label="Users"
                  value={rule.users}
                  options={optionsFor('users')}
                  allowNone
                  disabled={disabled}
                  onChange={(users) => updateRule(index, { ...rule, users })}
                />
                <DimensionRow
                  label="Agents"
                  value={rule.agents}
                  options={optionsFor('agents')}
                  allowNone
                  disabled={disabled}
                  onChange={(agents) => updateRule(index, { ...rule, agents })}
                />
                {deadRuleReason(rule) !== null && (
                  <p className="text-destructive text-xs">{deadRuleReason(rule)}</p>
                )}
                {!disabled && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={deadRuleReason(rule) !== null}
                      onClick={() => setEditingIndex(null)}
                    >
                      Apply rule
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <RuleSummary
                key={index}
                index={index}
                rule={rule}
                rooms={rooms}
                roomGroups={roomGroups}
                users={users}
                agents={agents}
                disabled={disabled}
                onEdit={() => setEditingIndex(index)}
                onRemove={() => removeRule(index)}
              />
            )
          )}
          {!disabled && (
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={editingIndex !== null}
                onClick={addRule}
              >
                Add rule
              </Button>
            </div>
          )}
        </div>
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
          This rule admits the agent&apos;s owner, but you have not linked a messaging account on
          this server — so Switch cannot tell that a message from you is from you, and the agent
          will answer nobody.
        </span>
        {onClaimIdentity === null ? (
          <span className="text-foreground-muted">
            Link your account from the server page, under “Your messaging accounts”.
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

/** Human-readable summary of one dimension for the collapsed rule view. */
function dimLabel(dim: AddressingDimension, options: OptionItem[]): string {
  if (dim === '*') return 'any';
  if (dim.length === 0) return 'none';
  return dim.map((id) => options.find((o) => o.id === id)?.label ?? id).join(', ');
}

/** Collapsed, read-only view of an applied rule — makes it obvious the rule is
 * set up (vs the bordered/highlighted editing view). */
function RuleSummary({
  index,
  rule,
  rooms,
  roomGroups,
  users,
  agents,
  disabled,
  onEdit,
  onRemove,
}: {
  index: number;
  rule: AddressingRule;
  rooms: OptionItem[];
  roomGroups: OptionItem[];
  users: OptionItem[];
  agents: OptionItem[];
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const dead = deadRuleReason(rule);
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border border-border p-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">Rule {index + 1}</span>
        <div className="flex flex-col gap-0.5 text-xs text-foreground-muted">
          <span>
            <span className="font-medium">Rooms:</span> {dimLabel(rule.rooms, rooms)}
          </span>
          <span>
            <span className="font-medium">Room groups:</span>{' '}
            {dimLabel(rule.room_groups, roomGroups)}
          </span>
          <span>
            <span className="font-medium">Owner:</span> {rule.owner === true ? 'admitted' : 'no'}
          </span>
          <span>
            <span className="font-medium">Users:</span> {dimLabel(rule.users, users)}
          </span>
          <span>
            <span className="font-medium">Agents:</span> {dimLabel(rule.agents, agents)}
          </span>
        </div>
        {dead !== null && <span className="text-destructive text-xs">{dead}</span>}
      </div>
      {!disabled && (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove rule">
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

type DimMode = 'any' | 'specific' | 'none';

function initialMode(value: AddressingDimension, allowNone: boolean): DimMode {
  if (value === '*') return 'any';
  if (value.length === 0) return allowNone ? 'none' : 'specific';
  return 'specific';
}

/**
 * One dimension of a rule. `allowNone` adds an explicit "None" mode for the
 * dimensions where excluding a whole sender kind is meaningful (users, agents);
 * context dimensions (rooms, room groups) only offer Any / Specific. The mode is
 * tracked locally so "None" and an in-progress empty "Specific" (both `[]` in
 * the model) stay distinguishable in the UI.
 */
function DimensionRow({
  label,
  value,
  options,
  allowNone,
  disabled,
  onChange,
}: {
  label: string;
  value: AddressingDimension;
  options: OptionItem[];
  allowNone: boolean;
  disabled: boolean;
  onChange: (next: AddressingDimension) => void;
}) {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<DimMode>(() => initialMode(value, allowNone));
  const ids = value === '*' ? [] : value;

  const changeMode = (next: DimMode) => {
    setMode(next);
    if (next === 'any') onChange('*');
    else if (next === 'none') onChange([]);
    else onChange(ids); // 'specific' — keep any current ids
  };

  const labelFor = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  const addId = (id: string) => {
    if (!ids.includes(id)) onChange([...ids, id]);
  };
  const removeId = (id: string) => onChange(ids.filter((x) => x !== id));

  // Manual free-text entry: add the typed value. If it matches a known option's
  // label (case-insensitive), store that option's id instead of the raw text.
  const addManual = () => {
    const raw = search.trim();
    if (!raw) return;
    const byLabel = options.find((o) => o.label.toLowerCase() === raw.toLowerCase());
    addId(byLabel ? byLabel.id : raw);
    setSearch('');
  };

  const needle = search.trim().toLowerCase();
  const matches = needle
    ? options.filter((o) => !ids.includes(o.id) && o.label.toLowerCase().includes(needle))
    : [];
  // Offer "add manual" only when the typed text isn't already an option or selected.
  const canAddManual =
    needle.length > 0 &&
    !ids.includes(search.trim()) &&
    !options.some((o) => o.label.toLowerCase() === needle || o.id.toLowerCase() === needle);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-24 text-xs font-medium text-foreground-muted">{label}</span>
        <Select value={mode} onValueChange={(m) => changeMode(m as DimMode)} disabled={disabled}>
          <SelectTrigger className="h-7 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="specific">Specific</SelectItem>
            {allowNone && <SelectItem value="none">None</SelectItem>}
          </SelectContent>
        </Select>
        {mode === 'specific' && ids.length > 0 && (
          <span className="text-xs text-foreground-muted">{ids.length} selected</span>
        )}
      </div>
      {mode === 'specific' && (
        <div className="ml-24 flex flex-col gap-2 rounded-md border border-border p-2">
          {/* Selected entries as chips, so a configured rule is obvious at a glance. */}
          {ids.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {ids.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1 pr-1">
                  <span className="max-w-[180px] truncate">{labelFor(id)}</span>
                  {!disabled && (
                    <button
                      type="button"
                      aria-label={`Remove ${labelFor(id)}`}
                      className="hover:bg-muted rounded-sm"
                      onClick={() => removeId(id)}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-foreground-muted">
              None selected yet — search to pick, or type a value and press Enter.
            </span>
          )}
          <Input
            placeholder={`Search or type a ${label.toLowerCase()} value…`}
            value={search}
            disabled={disabled}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canAddManual) {
                e.preventDefault();
                addManual();
              }
            }}
            className="h-7"
          />
          {needle.length > 0 && (
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {matches.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={disabled}
                  className="hover:text-accent-foreground rounded-sm px-1.5 py-1 text-left text-sm hover:bg-background-quaternary-1"
                  onClick={() => {
                    addId(opt.id);
                    setSearch('');
                  }}
                >
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
              {canAddManual && (
                <button
                  type="button"
                  disabled={disabled}
                  className="hover:text-accent-foreground rounded-sm px-1.5 py-1 text-left text-sm text-foreground-muted hover:bg-background-quaternary-1"
                  onClick={addManual}
                >
                  + Add “{search.trim()}”
                </button>
              )}
              {matches.length === 0 && !canAddManual && (
                <span className="px-1.5 py-1 text-xs text-foreground-muted">No matches.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
