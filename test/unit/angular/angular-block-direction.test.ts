/**
 * An Angular block renders its text through change detection. Its per-block
 * direction stamp has to land once the text is there, on load and on update.
 */
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  ErrorHandler,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { createAngularBlock } from '../../../packages/angular/src/createAngularBlock';
import { BLOK_BLOCK_CONTEXT, type AngularBlockRenderContext } from '../../../packages/angular/src/block-context';
import {
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  createBlockPortalRegistry,
} from '../../../packages/angular/src/block-portal-registry';

@Component({
  standalone: true,
  template: '<div contenteditable="true">{{ ctx.data().text }}</div>',
  changeDetection: ChangeDetectionStrategy.Default,
})
class NoteComponent {
  public readonly ctx = inject(BLOK_BLOCK_CONTEXT) as AngularBlockRenderContext<{ text: string }>;
}

const NoteTool = createAngularBlock<{ text: string }>({
  type: 'note',
  propSchema: { text: { default: '' } },
  component: NoteComponent,
});

const frames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

describe('per-block direction of an Angular block', () => {
  let holder: HTMLElement;
  let editor: Blok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    if (editor !== null) {
      await editor.isReady;
      editor.destroy();
      editor = null;
    }
    holder.remove();
    vi.restoreAllMocks();
  });

  const boot = async (text: string): Promise<Blok> => {
    const registry = createBlockPortalRegistry(
      TestBed.inject(EnvironmentInjector),
      TestBed.inject(ApplicationRef),
      TestBed.inject(ErrorHandler)
    );
    const instance = new Blok({
      holder,
      tools: { note: { class: NoteTool, config: { [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry } } },
      data: { blocks: [{ id: 'n', type: 'note', data: { text } }] },
    });

    await instance.isReady;
    await frames(3);

    return instance;
  };

  const content = (): Element | null => holder.querySelector('[data-blok-id="n"] [data-blok-element-content]');

  it('stamps the block from the text Angular rendered', async () => {
    editor = await boot('مرحبا');

    expect(content()?.textContent?.trim()).toBe('مرحبا');
    expect(content()?.getAttribute('dir')).toBe('rtl');
  });

  it('re-stamps after an update re-renders the text', async () => {
    editor = await boot('Hello');

    expect(content()?.getAttribute('dir')).toBe('ltr');

    await (editor as unknown as { blocks: { update: (id: string, data: Record<string, unknown>) => Promise<unknown> } }).blocks.update('n', { text: 'مرحبا' });
    await frames(3);

    expect(content()?.textContent?.trim()).toBe('مرحبا');
    expect(content()?.getAttribute('dir')).toBe('rtl');
  });
});
