import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAgentMarkerLayer,
  type AgentMarker,
  type AgentMarkerLayer,
} from '../../../../../src/components/modules/collaboration/agent-marker-layer';

const layers: AgentMarkerLayer[] = [];

const holderFor = (id: string): HTMLElement => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const toolRoot = document.createElement('div');

  holder.setAttribute('data-blok-id', id);
  content.setAttribute('data-blok-element-content', '');
  toolRoot.setAttribute('data-blok-tool', 'paragraph');
  toolRoot.setAttribute('contenteditable', 'true');
  toolRoot.textContent = 'hello';
  content.appendChild(toolRoot);
  holder.appendChild(content);
  document.body.appendChild(holder);

  return holder;
};

const layerFor = (
  resolveHolder: (id: string) => HTMLElement | null,
  greetForMs?: number
): AgentMarkerLayer => {
  const layer = createAgentMarkerLayer({ resolveHolder, greetForMs });

  layers.push(layer);

  return layer;
};

const markerFor = (blockId: string, key = -1): AgentMarker => ({
  key,
  blockId,
  name: 'Bot',
  color: '#0b6e99',
});

const query = (holder: HTMLElement, selector: string): HTMLElement => {
  const element = holder.querySelector<HTMLElement>(selector);

  if (element === null) {
    throw new Error(`nothing matches ${selector}`);
  }

  return element;
};

describe('agent marker layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    layers.splice(0).forEach((layer) => layer.clear());
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('appends inert decorations directly to the holder without changing its content', () => {
    const holder = holderFor('b1');
    const content = query(holder, '[data-blok-element-content]');
    const contentBefore = content.outerHTML;
    const holderAttributes = holder.getAttributeNames();
    const layer = layerFor((id) => (id === 'b1' ? holder : null));

    layer.render([markerFor('b1')]);

    expect(holder.querySelectorAll('[data-blok-agent-marker], [data-blok-agent-marker-label]')).toHaveLength(2);

    const outline = query(holder, '[data-blok-agent-marker]');
    const flag = query(holder, '[data-blok-agent-marker-label="Bot"]');

    [outline, flag].forEach((element) => {
      expect(element.parentElement).toBe(holder);
      expect(element.getAttribute('aria-hidden')).toBe('true');
      expect(element.getAttribute('contenteditable')).toBe('false');
      expect(element.textContent).toBe('');
      expect(element.children).toHaveLength(0);
      expect(element.hasAttribute('tabindex')).toBe(false);
      expect(element.style.getPropertyValue('--blok-presence-color')).toBe('#0b6e99');
    });
    expect(content.outerHTML).toBe(contentBefore);
    expect(content.parentElement).toBe(holder);
    expect(holder.getAttributeNames()).toEqual(holderAttributes);
    expect(holder.querySelector('svg')).toBeNull();
  });

  it('greets on arrival, then hides the flag after the configured duration', () => {
    const holder = holderFor('b1');
    const layer = layerFor(() => holder, 1000);

    layer.render([markerFor('b1')]);
    expect(holder.querySelector('[data-blok-agent-marker-shown]')).not.toBeNull();

    vi.advanceTimersByTime(999);
    expect(holder.querySelector('[data-blok-agent-marker-shown]')).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(holder.querySelector('[data-blok-agent-marker-shown]')).toBeNull();
    expect(holder.querySelector('[data-blok-agent-marker]')).not.toBeNull();
  });

  it('uses a three-second greeting by default', () => {
    const holder = holderFor('b1');
    const layer = layerFor(() => holder);

    layer.render([markerFor('b1')]);
    vi.advanceTimersByTime(2999);
    expect(holder.querySelector('[data-blok-agent-marker-shown]')).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(holder.querySelector('[data-blok-agent-marker-shown]')).toBeNull();
  });

  it('updates identity in place without restarting the greeting', () => {
    const holder = holderFor('b1');
    const layer = layerFor(() => holder, 1000);

    layer.render([markerFor('b1')]);

    const outline = query(holder, '[data-blok-agent-marker]');
    const flag = query(holder, '[data-blok-agent-marker-label]');

    vi.advanceTimersByTime(500);
    layer.render([{ ...markerFor('b1'), name: '<Other>', color: '#aa7733' }]);

    expect(flag.getAttribute('data-blok-agent-marker-label')).toBe('<Other>');
    expect(query(holder, '[data-blok-agent-marker]')).toBe(outline);
    expect(query(holder, '[data-blok-agent-marker-label]')).toBe(flag);
    expect(outline.style.getPropertyValue('--blok-presence-color')).toBe('#aa7733');
    expect(flag.style.getPropertyValue('--blok-presence-color')).toBe('#aa7733');
    expect(flag.textContent).toBe('');
    vi.advanceTimersByTime(500);
    expect(flag.hasAttribute('data-blok-agent-marker-shown')).toBe(false);

    layer.render([markerFor('b1')]);
    expect(flag.hasAttribute('data-blok-agent-marker-shown')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('moves to another holder without repeating the arrival greeting', () => {
    const first = holderFor('b1');
    const second = holderFor('b2');
    const layer = layerFor((id) => (id === 'b1' ? first : second));

    layer.render([markerFor('b1')]);
    layer.render([markerFor('b2')]);

    expect(first.querySelector('[data-blok-agent-marker], [data-blok-agent-marker-label]')).toBeNull();
    expect(second.querySelector('[data-blok-agent-marker]')).not.toBeNull();
    expect(second.querySelector('[data-blok-agent-marker-shown]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    layer.render([]);
    expect(document.querySelector('[data-blok-agent-marker], [data-blok-agent-marker-label]')).toBeNull();
  });

  it('replaces decorations when the same block gets a new holder', () => {
    const first = holderFor('b1');
    const replacement = holderFor('b1');
    let current = first;
    const layer = layerFor(() => current);

    layer.render([markerFor('b1')]);
    current = replacement;
    layer.render([markerFor('b1')]);

    expect(first.querySelector('[data-blok-agent-marker], [data-blok-agent-marker-label]')).toBeNull();
    expect(replacement.querySelector('[data-blok-agent-marker]')).not.toBeNull();
    expect(replacement.querySelector('[data-blok-agent-marker-shown]')).toBeNull();
  });

  it('greets an agent again after it leaves and returns', () => {
    const holder = holderFor('b1');
    const layer = layerFor(() => holder, 1000);

    layer.render([markerFor('b1')]);
    vi.advanceTimersByTime(1000);
    layer.render([]);
    layer.render([markerFor('b1')]);

    expect(holder.querySelector('[data-blok-agent-marker-shown]')).not.toBeNull();
    expect(holder.querySelectorAll('[data-blok-agent-marker]')).toHaveLength(1);
  });

  it('keeps agents sharing a holder separate and removes only the departing one', () => {
    const holder = holderFor('b1');
    const layer = layerFor(() => holder);

    layer.render([markerFor('b1', 1), { ...markerFor('b1', 2), name: 'Other' }]);
    expect(holder.querySelectorAll('[data-blok-agent-marker]')).toHaveLength(2);

    const remainingFlag = query(holder, '[data-blok-agent-marker-label="Other"]');

    layer.render([{ ...markerFor('b1', 2), name: 'Other' }]);
    expect(holder.querySelectorAll('[data-blok-agent-marker]')).toHaveLength(1);
    expect(holder.querySelector('[data-blok-agent-marker-label="Bot"]')).toBeNull();
    expect(query(holder, '[data-blok-agent-marker-label="Other"]')).toBe(remainingFlag);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('skips missing holders and removes a marker whose holder is no longer resolvable', () => {
    const holder = holderFor('b1');
    const layer = layerFor((id) => (id === 'b1' ? holder : null));

    layer.render([markerFor('gone', 1), markerFor('b1', 2)]);
    expect(document.querySelectorAll('[data-blok-agent-marker]')).toHaveLength(1);

    layer.render([markerFor('gone', 2)]);
    expect(document.querySelector('[data-blok-agent-marker], [data-blok-agent-marker-label]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears decorations and timers, and can greet again after clear', () => {
    const holder = holderFor('b1');
    const layer = layerFor(() => holder);

    layer.render([markerFor('b1')]);
    expect(vi.getTimerCount()).toBe(1);

    layer.clear();
    expect(document.querySelector('[data-blok-agent-marker], [data-blok-agent-marker-label]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    layer.clear();
    layer.render([markerFor('b1')]);
    expect(holder.querySelector('[data-blok-agent-marker-shown]')).not.toBeNull();
  });

  it('preserves focus, text selection, and scroll, and never greets on focus', () => {
    const holder = holderFor('b1');
    const toolRoot = query(holder, '[data-blok-tool]');
    const text = toolRoot.firstChild;
    const selection = window.getSelection();

    if (text === null || selection === null) {
      throw new Error('selection fixture unavailable');
    }

    toolRoot.setAttribute('tabindex', '0');
    toolRoot.focus();
    selection.setBaseAndExtent(text, 1, text, 4);
    holder.scrollTop = 70;
    holder.scrollLeft = 30;

    const layer = layerFor(() => holder, 1000);

    layer.render([markerFor('b1')]);
    expect(holder.querySelector('[data-blok-agent-marker]')).not.toBeNull();

    vi.advanceTimersByTime(1000);
    toolRoot.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    toolRoot.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    layer.render([markerFor('b1')]);

    expect(holder.querySelector('[data-blok-agent-marker-shown]')).toBeNull();
    layer.clear();
    expect(toolRoot).toHaveFocus();
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(1);
    expect(selection.focusNode).toBe(text);
    expect(selection.focusOffset).toBe(4);
    expect(selection.toString()).toBe('ell');
    expect(holder.scrollTop).toBe(70);
    expect(holder.scrollLeft).toBe(30);
  });
});
