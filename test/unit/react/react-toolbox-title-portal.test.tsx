/**
 * #37: a React block tool's toolbox LABEL can be a live ReactNode rendered in
 * the host tree, so it tracks the host's own i18n instead of forcing the host
 * to mirror strings into Blok's dictionary.
 *
 * A module-singleton tool's static `toolbox` can't reach a per-editor React
 * context. `__buildPortalToolbox(registry)` bridges that: it produces a core
 * ToolboxConfig whose title is a Blok-owned mutation-free host element, and
 * registers a portal so the ReactNode renders INTO it via the editor's shared
 * BlockPortalHost — picking up the host's i18n context. `useBlok` injects the
 * result as a per-editor `toolbox` settings override.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

import { createReactBlock } from '../../../packages/react/src/createReactBlock';
import {
  createBlockPortalRegistry,
  type BlockPortalRegistry,
} from '../../../packages/react/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/react/src/BlockPortalHost';

const makeQuote = (): ReturnType<typeof createReactBlock> =>
  createReactBlock({
    type: 'quote',
    propSchema: {},
    toolbox: {
      icon: '<svg data-testid="quote-icon"></svg>',
      title: <span data-testid="live-title">Цитата</span>,
      titleKey: 'quote',
    },
    component: () => <blockquote />,
  });

const firstEntry = (toolbox: unknown): Record<string, unknown> => {
  const value = Array.isArray(toolbox) ? toolbox[0] : toolbox;

  return value as Record<string, unknown>;
};

describe('createReactBlock ReactNode toolbox title', () => {
  let registry: BlockPortalRegistry;
  let unmountHost: () => void;

  beforeEach(() => {
    registry = createBlockPortalRegistry();
    const host = render(<BlockPortalHost registry={registry} />);

    unmountHost = host.unmount;
  });

  afterEach(() => {
    unmountHost();
    vi.restoreAllMocks();
  });

  it('exposes __buildPortalToolbox producing an HTMLElement host title', () => {
    const Quote = makeQuote() as unknown as {
      __buildPortalToolbox: (r: BlockPortalRegistry, name: string) => unknown;
    };

    const toolbox = Quote.__buildPortalToolbox(registry, 'quote');

    expect(toolbox).toBeDefined();

    const entry = firstEntry(toolbox);

    expect(entry.titleEl).toBeInstanceOf(HTMLElement);
    expect((entry.titleEl as HTMLElement).getAttribute('data-blok-mutation-free')).toBe('true');
    // The string title is dropped (a ReactElement has no core string form);
    // titleKey is preserved so multilingual search still resolves an English term.
    expect(entry.title).toBeUndefined();
    expect(entry.titleKey).toBe('quote');
    // Icon is serialized to markup as usual.
    expect(typeof entry.icon).toBe('string');
  });

  it('renders the ReactNode into the host element via the portal host', () => {
    const Quote = makeQuote() as unknown as {
      __buildPortalToolbox: (r: BlockPortalRegistry, name: string) => unknown;
    };

    let toolbox: unknown;

    // register() notifies the BlockPortalHost's external store; flush its render.
    act(() => {
      toolbox = Quote.__buildPortalToolbox(registry, 'quote');
    });

    const host = firstEntry(toolbox).titleEl as HTMLElement;

    // The live node was portaled into the Blok-owned host element.
    expect(host.querySelector('[data-testid="live-title"]')?.textContent).toBe('Цитата');
  });

  it('static toolbox drops the ReactNode title so core config stays valid', () => {
    const Quote = makeQuote() as unknown as { toolbox: unknown };

    const entry = firstEntry(Quote.toolbox);

    // A ReactElement is never a valid core title (string | HTMLElement only).
    expect(React.isValidElement(entry.title)).toBe(false);
    expect(entry.titleKey).toBe('quote');
  });

  it('returns undefined when no toolbox entry has a ReactNode title', () => {
    const Plain = createReactBlock({
      type: 'plain',
      propSchema: {},
      toolbox: { icon: '<svg></svg>', title: 'Plain', titleKey: 'plain' },
      component: () => <div />,
    }) as unknown as {
      __buildPortalToolbox: (r: BlockPortalRegistry, name: string) => unknown;
    };

    expect(Plain.__buildPortalToolbox(registry, 'plain')).toBeUndefined();
  });
});
