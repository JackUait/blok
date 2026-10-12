import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentPresence, type AgentPresenceOptions } from '../../../../../src/components/modules/api/agent-presence';
import { createCaretLayer } from '../../../../../src/components/modules/collaboration/presence-carets';
import { agentColorFor } from '../../../../../src/components/modules/collaboration/presence';
import type { ChangedSet } from '../../../../../types/agent';

interface FakeBlock { holder: HTMLElement; input: HTMLElement }

const blocks = new Map<string, FakeBlock>();

const addBlock = (id: string, text = 'hello world'): FakeBlock => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const input = document.createElement('div');

  holder.setAttribute('data-blok-id', id);
  content.setAttribute('data-blok-element-content', '');
  input.setAttribute('contenteditable', 'true');
  input.textContent = text;
  content.appendChild(input);
  holder.appendChild(content);
  document.body.appendChild(holder);
  blocks.set(id, { holder, input });

  return { holder, input };
};

const holderOf = (id: string): HTMLElement => {
  const block = blocks.get(id);

  if (block === undefined) {
    throw new Error(`No block ${id}.`);
  }

  return block.holder;
};

const stubRangeRect = (left: number): void => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
    left, top: 0, height: 18, right: left, bottom: 18, width: 0, x: left, y: 0, toJSON: () => ({}),
  });
};

const resolveInputs = (id: string): HTMLElement[] => {
  const block = blocks.get(id);

  return block === undefined ? [] : [block.input];
};

const options = (overrides: Partial<AgentPresenceOptions> = {}): AgentPresenceOptions => ({
  host: document.body,
  resolveHolder: (id) => blocks.get(id)?.holder ?? null,
  resolveInputs,
  inputIndexFor: (_id, field) => (field === 'text' ? 0 : null),
  isHidden: () => false,
  publish: vi.fn(),
  scrollTo: vi.fn(),
  ...overrides,
});

const NONE: ChangedSet = { created: [], updated: [], moved: [], removed: [] };
const AGENT = { id: 'bot', name: 'Bot' };
const DRAWN = '[data-blok-presence-caret], [data-blok-agent-marker]';

const reset = (): void => {
  vi.restoreAllMocks();
  blocks.clear();
  document.body.innerHTML = '';
};

describe('agent presence — test 5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRangeRect(10);
  });

  afterEach(reset);

  it('draws exactly one named caret in the block lastRange names', () => {
    const { holder } = addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 2, end: 2 } });

    expect(holder.querySelectorAll('[data-blok-presence-caret]')).toHaveLength(1);
    expect(holder.querySelector('[data-blok-presence-caret-label="Bot"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-agent-marker]')).toBeNull();
    presence.stop();
  });

  it('with no lastRange, marks the last created block at block level', () => {
    addBlock('b1');
    const { holder } = addBlock('b2');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1', 'b2'] } });

    expect(holder.querySelector('[data-blok-agent-marker]')).not.toBeNull();
    expect(holderOf('b1').querySelector('[data-blok-agent-marker]')).toBeNull();
    expect(document.querySelector('[data-blok-presence-caret]')).toBeNull();
    presence.stop();
  });

  it('an unmapped field gives a block-level marker', () => {
    const { holder } = addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'caption', start: 0, end: 1 } });

    expect(holder.querySelector('[data-blok-agent-marker]')).not.toBeNull();
    expect(document.querySelector('[data-blok-presence-caret]')).toBeNull();
    presence.stop();
  });

  it('a page-only batch draws nothing', () => {
    addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: NONE });

    expect(document.querySelector(DRAWN)).toBeNull();
    presence.stop();
  });

  it('hideControls hides it', () => {
    addBlock('b1');
    const presence = createAgentPresence(options({ isHidden: () => true }));

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 0, end: 0 } });

    expect(document.querySelector(DRAWN)).toBeNull();
    presence.stop();
  });

  it('stop removes it, and a show after stop draws nothing', () => {
    addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1'] } });
    expect(document.querySelector(DRAWN)).not.toBeNull();

    presence.stop();
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    expect(document.querySelector(DRAWN)).toBeNull();
  });

  it('leaves the collaboration caret layer alone', () => {
    addBlock('b1');
    const { holder: peerHolder } = addBlock('peer');
    const collab = createCaretLayer({ resolveHolder: (id) => blocks.get(id)?.holder ?? null, resolveInputs });

    collab.render([{ clientId: 7, name: 'Ann', color: '#0b6e99', caret: { blockId: 'peer', inputIndex: 0, anchor: 1, head: 1 } }]);

    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 1, end: 1 } });
    presence.stop();

    expect(peerHolder.querySelectorAll('[data-blok-presence-caret]')).toHaveLength(1);
    collab.clear();
  });

  it('gates the name and the colour', () => {
    const { holder } = addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start({ id: 'bot', name: `  ${'x'.repeat(40)}  `, color: 'red' }, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    const flag = holder.querySelector<HTMLElement>('[data-blok-agent-marker-label]');

    expect(flag?.getAttribute('data-blok-agent-marker-label')).toBe('x'.repeat(32));
    expect(flag?.style.getPropertyValue('--blok-presence-color')).toBe(agentColorFor('bot'));
    presence.stop();
  });

  it('re-measures the caret when the user types in the editor', () => {
    const { holder } = addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 2, end: 2 } });
    expect(holder.querySelector<HTMLElement>('[data-blok-presence-caret]')?.style.left).toBe('10px');

    stubRangeRect(40);
    document.body.dispatchEvent(new Event('input'));

    expect(holder.querySelector<HTMLElement>('[data-blok-presence-caret]')?.style.left).toBe('40px');
    presence.stop();
  });
});

describe('agent colour and name helpers', () => {
  it('agentColorFor is stable and comes from the palette', async () => {
    const { PRESENCE_PALETTE } = await import('../../../../../src/components/modules/collaboration/presence');
    const palette: readonly string[] = PRESENCE_PALETTE;

    expect(agentColorFor('bot')).toBe(agentColorFor('bot'));
    expect(palette).toContain(agentColorFor('bot'));
  });

  it('capPresenceName cuts by code point, not by UTF-16 unit', async () => {
    const { capPresenceName } = await import('../../../../../src/components/modules/collaboration/presence');

    expect(capPresenceName(`${'a'.repeat(31)}😀😀`)).toBe(`${'a'.repeat(31)}😀`);
    expect(capPresenceName(42)).toBe('');
  });
});

describe('agent presence — pulse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRangeRect(10);
  });

  afterEach(reset);

  it('pulses created, updated and moved holders, never removed ones', () => {
    ['a', 'b', 'c', 'd'].forEach((id) => addBlock(id));
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { created: ['a'], updated: ['b', 'a'], moved: ['c'], removed: ['d'] } });

    expect(['a', 'b', 'c'].filter((id) => holderOf(id).classList.contains('blok-block--target'))).toEqual(['a', 'b', 'c']);
    expect(holderOf('d').classList.contains('blok-block--target')).toBe(false);
    presence.stop();
  });

  it('caps a huge batch at MAX_PULSES and skips ids with no holder', async () => {
    const { MAX_PULSES } = await import('../../../../../src/components/modules/api/agent-presence');
    const ids = Array.from({ length: 60 }, (_, index) => `b${index}`);

    ids.forEach((id) => addBlock(id));

    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });

    expect(() => presence.show({ changed: { ...NONE, created: ['missing', ...ids] } })).not.toThrow();
    expect(document.querySelectorAll('.blok-block--target')).toHaveLength(50);
    expect(MAX_PULSES).toBe(50);
    expect(holderOf('b0').classList.contains('blok-block--target')).toBe(true);
    presence.stop();
  });

  it('a show after stop pulses nothing', () => {
    addBlock('a');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.stop();
    presence.show({ changed: { ...NONE, created: ['a'] } });

    expect(holderOf('a').classList.contains('blok-block--target')).toBe(false);
  });
});

describe('agent presence — follow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRangeRect(10);
  });

  afterEach(reset);

  const batch = (id: string): { changed: ChangedSet } => ({ changed: { ...NONE, created: [id] } });

  it('follow: false never scrolls', () => {
    addBlock('b1');
    const scrollTo = vi.fn();
    const presence = createAgentPresence(options({ scrollTo }));

    presence.start(AGENT, { follow: false });
    presence.show(batch('b1'));

    expect(scrollTo).not.toHaveBeenCalled();
    presence.stop();
  });

  it('follow: true scrolls to the agent block and keeps following through scroll events', () => {
    addBlock('b1');
    addBlock('b2');
    const scrollTo = vi.fn();
    const presence = createAgentPresence(options({ scrollTo }));

    presence.start(AGENT, { follow: true });
    presence.show(batch('b1'));
    window.dispatchEvent(new Event('scroll'));
    presence.show(batch('b2'));

    expect(scrollTo.mock.calls).toEqual([['b1'], ['b2']]);
    presence.stop();
  });

  it.each(['wheel', 'touchmove', 'keydown', 'pointerdown'])('%s stops following for the rest of the turn', (type) => {
    addBlock('b1');
    addBlock('b2');
    const scrollTo = vi.fn();
    const presence = createAgentPresence(options({ scrollTo }));

    presence.start(AGENT, { follow: true });
    presence.show(batch('b1'));
    window.dispatchEvent(new Event(type));
    presence.show(batch('b2'));

    expect(scrollTo.mock.calls).toEqual([['b1']]);
    presence.stop();
  });

  it('a new turn follows again after a stopped one', () => {
    addBlock('b1');
    const scrollTo = vi.fn();
    const presence = createAgentPresence(options({ scrollTo }));

    presence.start(AGENT, { follow: true });
    window.dispatchEvent(new Event('wheel'));
    presence.stop();
    presence.start(AGENT, { follow: true });
    presence.show(batch('b1'));

    expect(scrollTo).toHaveBeenCalledWith('b1');
    presence.stop();
  });

  it('a batch after stop does not scroll', () => {
    addBlock('b1');
    const scrollTo = vi.fn();
    const presence = createAgentPresence(options({ scrollTo }));

    presence.start(AGENT, { follow: true });
    presence.stop();
    presence.show(batch('b1'));

    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('agent presence — agentCursor publish (test 25)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRangeRect(10);
  });

  afterEach(reset);

  it('publishes the range in data-field terms, then null on stop', () => {
    addBlock('b1');
    const publish = vi.fn();
    const presence = createAgentPresence(options({ publish }));

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 2, end: 5 } });
    presence.stop();

    expect(publish.mock.calls).toEqual([
      [{ actorId: 'bot', name: 'Bot', color: agentColorFor('bot'), blockId: 'b1', field: 'text', start: 2, end: 5 }],
      [null],
    ]);
  });

  it('a block-level batch publishes no field or offsets', () => {
    addBlock('b1');
    const publish = vi.fn();
    const presence = createAgentPresence(options({ publish }));

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    expect(publish).toHaveBeenCalledExactlyOnceWith({ actorId: 'bot', name: 'Bot', color: agentColorFor('bot'), blockId: 'b1' });
    presence.stop();
  });

  it('publishes while hidden: drawing is gated, presence is not', () => {
    addBlock('b1');
    const publish = vi.fn();
    const presence = createAgentPresence(options({ publish, isHidden: () => true }));

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    expect(publish).toHaveBeenCalledTimes(1);
    presence.stop();
  });

  it('never publishes after stop, and stop without a publish sends no null', () => {
    const publish = vi.fn();
    const presence = createAgentPresence(options({ publish }));

    presence.start(AGENT, { follow: false });
    presence.stop();
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    expect(publish).not.toHaveBeenCalled();
  });
});
