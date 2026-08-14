import { describe, expect, it } from 'vitest';
import type { AddressingPolicy } from '@shared/core/switch-servers/switch-servers';
import {
  type AddressingMode,
  addressingModeOf,
  policyNamesOwner,
  ownerOnlyPolicy,
  ownerRuleAgentIds,
  policyForMode,
} from './owner-policy';

describe('ownerOnlyPolicy', () => {
  it('admits the owner and nobody else by default', () => {
    expect(ownerOnlyPolicy([])).toEqual({
      rules: [{ rooms: '*', room_groups: '*', users: [], agents: [], owner: true }],
    });
  });

  it('grants the named agents alongside the owner', () => {
    expect(ownerOnlyPolicy(['agent-a', 'agent-b']).rules[0].agents).toEqual(['agent-a', 'agent-b']);
  });
});

describe('ownerRuleAgentIds', () => {
  it('reads back the agents granted by the default policy', () => {
    expect(ownerRuleAgentIds(ownerOnlyPolicy(['agent-a']))).toEqual(['agent-a']);
  });

  it('steps aside for an open policy', () => {
    expect(ownerRuleAgentIds(null)).toBeNull();
  });

  it('steps aside once a second rule exists', () => {
    const policy: AddressingPolicy = {
      rules: [
        ...ownerOnlyPolicy([]).rules,
        { rooms: '*', room_groups: '*', users: '*', agents: [] },
      ],
    };
    expect(ownerRuleAgentIds(policy)).toBeNull();
  });

  it('steps aside when the rule no longer names the owner', () => {
    const policy: AddressingPolicy = {
      rules: [{ rooms: '*', room_groups: '*', users: [], agents: [], owner: false }],
    };
    expect(ownerRuleAgentIds(policy)).toBeNull();
  });

  it('steps aside when the rule has been widened beyond the picker', () => {
    const scopedRooms: AddressingPolicy = {
      rules: [{ rooms: ['room-1'], room_groups: '*', users: [], agents: [], owner: true }],
    };
    const namedUsers: AddressingPolicy = {
      rules: [{ rooms: '*', room_groups: '*', users: ['user-1'], agents: [], owner: true }],
    };
    const anyAgent: AddressingPolicy = {
      rules: [{ rooms: '*', room_groups: '*', users: [], agents: '*', owner: true }],
    };
    expect(ownerRuleAgentIds(scopedRooms)).toBeNull();
    expect(ownerRuleAgentIds(namedUsers)).toBeNull();
    expect(ownerRuleAgentIds(anyAgent)).toBeNull();
  });
});

/** A rule set the two shortcuts cannot express, so it can only be "Custom rules". */
const HAND_BUILT: AddressingPolicy = {
  rules: [
    { rooms: ['room-1'], room_groups: '*', users: ['user-1'], agents: [], owner: true },
    { rooms: '*', room_groups: ['group-1'], users: [], agents: ['agent-a'] },
  ],
};

describe('policyNamesOwner', () => {
  it('is false for a policy that admits everyone', () => {
    expect(policyNamesOwner(null)).toBe(false);
    expect(policyNamesOwner({ rules: [] })).toBe(false);
  });

  it('is true for the owner-only shortcut', () => {
    expect(policyNamesOwner(ownerOnlyPolicy([]))).toBe(true);
    expect(policyNamesOwner(ownerOnlyPolicy(['agent-a']))).toBe(true);
  });

  it('is true for a hand-built rule set that names the owner', () => {
    // Not only the shape the chooser calls `owner`: what matters is whether the
    // agent has to recognise its owner at all, and this one does.
    expect(addressingModeOf(HAND_BUILT)).toBe('custom');
    expect(policyNamesOwner(HAND_BUILT)).toBe(true);
  });

  it('is false for rules that name people rather than the owner', () => {
    expect(
      policyNamesOwner({
        rules: [
          { rooms: '*', room_groups: '*', users: ['user-1'], agents: [], owner: false },
          { rooms: '*', room_groups: '*', users: [], agents: ['agent-a'] },
        ],
      })
    ).toBe(false);
  });
});

describe('addressingModeOf', () => {
  it('reads an absent policy as anyone', () => {
    expect(addressingModeOf(null)).toBe('anyone');
  });

  it('reads a policy with no rules as anyone, as switch-core does', () => {
    expect(addressingModeOf({ rules: [] })).toBe('anyone');
  });

  it('reads the owner-only shape as only-me, granted agents included', () => {
    expect(addressingModeOf(ownerOnlyPolicy([]))).toBe('owner');
    expect(addressingModeOf(ownerOnlyPolicy(['agent-a']))).toBe('owner');
  });

  it('reads a hand-edited policy as custom', () => {
    expect(addressingModeOf(HAND_BUILT)).toBe('custom');
  });
});

describe('policyForMode', () => {
  const modes: AddressingMode[] = ['owner', 'anyone', 'custom'];

  it('round-trips every mode back to itself', () => {
    for (const mode of modes) {
      expect(addressingModeOf(policyForMode(mode, null))).toBe(mode);
    }
  });

  it('round-trips a hand-built policy through custom without touching it', () => {
    expect(addressingModeOf(HAND_BUILT)).toBe('custom');
    expect(policyForMode('custom', HAND_BUILT)).toBe(HAND_BUILT);
  });

  it('opens up to anyone by dropping the policy', () => {
    expect(policyForMode('anyone', HAND_BUILT)).toBeNull();
  });

  it('replaces a hand-built policy when only-me is chosen', () => {
    expect(policyForMode('owner', HAND_BUILT)).toEqual(ownerOnlyPolicy([]));
  });

  it('keeps the granted agents when only-me is re-chosen', () => {
    expect(policyForMode('owner', ownerOnlyPolicy(['agent-a']))).toEqual(
      ownerOnlyPolicy(['agent-a'])
    );
  });

  it('seeds custom rules from what only-me expressed', () => {
    const seeded = policyForMode('custom', ownerOnlyPolicy(['agent-a']));
    expect(seeded).toEqual(ownerOnlyPolicy(['agent-a']));
  });

  it('seeds custom rules from what anyone expressed, rather than from nothing', () => {
    const seeded = policyForMode('custom', null);
    expect(seeded).toEqual({
      rules: [{ rooms: '*', room_groups: '*', users: '*', agents: '*', owner: false }],
    });
    expect(addressingModeOf(seeded)).toBe('custom');
  });
});
