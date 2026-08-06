import { describe, expect, it } from 'vitest';
import { applyContextAffinity, matchRooms } from '@renderer/features/command-palette/search-utils';
import type { SearchItem } from '@shared/core/search';
import type { RemoteRoomSummary } from '@shared/core/switch-servers/switch-servers';

function room(over: Pick<RemoteRoomSummary, 'id' | 'name'>): RemoteRoomSummary {
  return {
    description: '',
    channelType: null,
    agentCount: 0,
    bridgeDisplayName: null,
    bridgeType: null,
    externalChannelUrl: null,
    ownerId: null,
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  } as RemoteRoomSummary;
}

const ROOMS = [
  room({ id: 'r1', name: 'switchdash search bar' }),
  room({ id: 'r2', name: 'Switch Workforce hub' }),
  room({ id: 'r3', name: 'release engineering' }),
];

describe('matchRooms', () => {
  it('returns nothing for an empty query rather than every room', () => {
    expect(matchRooms(ROOMS, '')).toEqual([]);
    expect(matchRooms(ROOMS, '   ')).toEqual([]);
  });

  it('matches case-insensitively on a substring', () => {
    expect(matchRooms(ROOMS, 'WORKFORCE').map((r) => r.id)).toEqual(['r2']);
  });

  // Rooms are matched in the renderer, so they are not subject to the trigram
  // tokenizer's three-character floor that the indexed kinds are.
  it('answers a one- and two-character query', () => {
    // 'se' matches "relea(se)" and "(se)arch"; the earlier position wins.
    expect(matchRooms(ROOMS, 'se').map((r) => r.id)).toEqual(['r3', 'r1']);
    expect(matchRooms(ROOMS, 'w').map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('ranks a name that starts with the query above one that merely contains it', () => {
    const hits = matchRooms(
      [
        room({ id: 'contains', name: 'the search bar' }),
        room({ id: 'starts', name: 'search bar' }),
      ],
      'search'
    );
    expect(hits.map((h) => h.id)).toEqual(['starts', 'contains']);
  });

  it('emits palette items that navigate by room id', () => {
    const [hit] = matchRooms(ROOMS, 'workforce');
    expect(hit).toMatchObject({
      kind: 'room',
      id: 'r2',
      title: 'Switch Workforce hub',
      locationId: null,
    });
  });

  it('caps how much of the palette rooms can take', () => {
    const many = Array.from({ length: 30 }, (_, i) => room({ id: `r${i}`, name: `room ${i}` }));
    expect(matchRooms(many, 'room').length).toBeLessThanOrEqual(8);
  });
});

describe('applyContextAffinity', () => {
  const item = (over: Partial<SearchItem> & Pick<SearchItem, 'id'>): SearchItem => ({
    kind: 'session',
    locationId: null,
    sessionId: null,
    title: over.id,
    subtitle: '',
    score: 0,
    ...over,
  });

  it('puts items from the active location first', () => {
    const ranked = applyContextAffinity(
      [
        item({ id: 'elsewhere', locationId: 'loc-2', score: -5 }),
        item({ id: 'here', locationId: 'loc-1', score: -1 }),
      ],
      { locationId: 'loc-1' }
    );
    expect(ranked.map((r) => r.id)).toEqual(['here', 'elsewhere']);
  });

  it('falls back to BM25 order, where more negative is better', () => {
    const ranked = applyContextAffinity(
      [item({ id: 'weak', score: -1 }), item({ id: 'strong', score: -9 })],
      {}
    );
    expect(ranked.map((r) => r.id)).toEqual(['strong', 'weak']);
  });

  it('does not mutate the array it is given', () => {
    const items = [item({ id: 'b', score: -1 }), item({ id: 'a', score: -9 })];
    applyContextAffinity(items, {});
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});
