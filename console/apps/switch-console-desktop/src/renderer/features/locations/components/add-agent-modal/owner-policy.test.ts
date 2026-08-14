import { describe, expect, it } from 'vitest';
import type { AddressingPolicy } from '@shared/core/switch-servers/switch-servers';
import { ownerOnlyPolicy, ownerRuleAgentIds } from './owner-policy';

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
