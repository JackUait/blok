import { describe, expect, it } from 'vitest';

import { buildPresenceFace } from '../../../src/playground/presence-face';

import type { CollaborationParticipant } from '../../../types/events/editor-events';

const participant = (overrides: Partial<CollaborationParticipant['user']> = {},
  rest: Partial<CollaborationParticipant> = {}): CollaborationParticipant => ({
  userId: null,
  present: true,
  self: false,
  clientIds: [1],
  lastActiveAt: null,
  blockId: null,
  ...rest,
  user: {
    name: '',
    color: '#ad1a72',
    glyph: 'planet',
    label: 'Anonymous Planet',
    ...overrides,
  },
});

describe('playground presence face', () => {
  it('wears the silhouette the editor assigned a nameless participant', () => {
    const face = buildPresenceFace(participant());

    expect(face.getAttribute('data-blok-presence-glyph')).toBe('planet');
    expect(face.textContent).toBe('');
  });

  it('wears a monogram instead of a silhouette once a participant has a name', () => {
    const face = buildPresenceFace(participant({ name: 'Alice', glyph: null, label: null }));

    expect(face.hasAttribute('data-blok-presence-glyph')).toBe(false);
    expect(face.textContent).toBe('A');
  });

  it('keeps an astral first character whole', () => {
    const face = buildPresenceFace(participant({ name: '😀 Zoe', glyph: null, label: null }));

    expect(face.textContent).toBe('😀');
  });

  it('paints the participant colour', () => {
    const face = buildPresenceFace(participant({ color: '#6940a5' }));

    expect(face.style.background).toBe('rgb(105, 64, 165)');
  });

  it('names an anonymous participant by its label rather than by nothing', () => {
    const face = buildPresenceFace(participant());

    expect(face.title).toBe('Anonymous Planet');
  });

  it('names a participant no translator could label', () => {
    const face = buildPresenceFace(participant({ label: null }));

    expect(face.title).toBe('Anonymous');
  });

  it('reports how long ago a participant was last active', () => {
    const face = buildPresenceFace(participant({ name: 'Alice', glyph: null, label: null }, {
      lastActiveAt: 8_000,
    }), 20_400);

    expect(face.title).toBe('Alice · 12s ago');
  });

  it('reports no age for a participant that published none', () => {
    const face = buildPresenceFace(participant({ name: 'Alice', glyph: null, label: null }), 20_400);

    expect(face.title).toBe('Alice');
  });
});
