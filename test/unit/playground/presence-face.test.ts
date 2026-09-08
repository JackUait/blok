import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onHover } from '../../../src/components/utils/tooltip';
import { buildPresenceFace } from '../../../src/playground/presence-face';

import type { CollaborationParticipant } from '../../../types/events/editor-events';

vi.mock('../../../src/components/utils/tooltip', () => ({ onHover: vi.fn() }));

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

/** What the face registered as its hover text. */
const hoverText = (): unknown => vi.mocked(onHover).mock.calls[0]?.[1];

describe('playground presence face', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('names a participant through Blok tooltip rather than the browser one', () => {
    const face = buildPresenceFace(participant({ name: 'Alice', glyph: null, label: null }));

    expect(vi.mocked(onHover).mock.calls[0]?.[0]).toBe(face);
    expect(hoverText()).toBe('Alice');
    expect(face.hasAttribute('title')).toBe(false);
  });

  it('names an anonymous participant by its label rather than by nothing', () => {
    buildPresenceFace(participant());

    expect(hoverText()).toBe('Anonymous Planet');
  });

  it('names a participant no translator could label', () => {
    buildPresenceFace(participant({ label: null }));

    expect(hoverText()).toBe('Anonymous');
  });

  it('reports how long ago a participant was last active', () => {
    buildPresenceFace(participant({ name: 'Alice', glyph: null, label: null }, {
      lastActiveAt: 8_000,
    }), 20_400);

    expect(hoverText()).toBe('Alice · 12s ago');
  });

  it('reports no age for a participant that published none', () => {
    buildPresenceFace(participant({ name: 'Alice', glyph: null, label: null }), 20_400);

    expect(hoverText()).toBe('Alice');
  });

  it('reaches assistive tech, which never sees a hover', () => {
    const face = buildPresenceFace(participant());

    expect(face.getAttribute('aria-label')).toBe('Anonymous Planet');
  });
});
