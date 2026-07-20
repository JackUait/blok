import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlockRenderedPayload, BlocksRenderedPayload } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry, type MockBlokRecord } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor
    (blocksRendered)="batches.push($event)"
    (blockRendered)="blocks.push($event)"
  ></blok-editor>`,
})
class EventsHost {
  batches: BlocksRenderedPayload[] = [];
  blocks: BlockRenderedPayload[] = [];
}

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor></blok-editor>`,
})
class BareHost {}

async function mountReady<T>(type: { new (): T }): Promise<ComponentFixture<T>> {
  const fixture = TestBed.createComponent(type);

  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

function handlerFor(editor: MockBlokRecord, eventName: string): (payload: unknown) => void {
  const call = editor.on.mock.calls.find((c) => c[0] === eventName);

  return call?.[1] as (payload: unknown) => void;
}

describe('BlokEditorComponent rendered events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits blocksRendered from the core blocks:rendered event', async () => {
    const fixture = await mountReady(EventsHost);
    handlerFor(blokRegistry.last, 'blocks:rendered')({ count: 3 });
    await fixture.whenStable();

    expect(fixture.componentInstance.batches).toEqual([{ count: 3 }]);
  });

  it('emits blockRendered from the core block:rendered event', async () => {
    const fixture = await mountReady(EventsHost);
    handlerFor(blokRegistry.last, 'block:rendered')({ blockId: 'abc' });
    await fixture.whenStable();

    expect(fixture.componentInstance.blocks).toEqual([{ blockId: 'abc' }]);
  });

  it('unsubscribes from rendered events on destroy', async () => {
    const fixture = await mountReady(EventsHost);
    const editor = blokRegistry.last;
    const handler = handlerFor(editor, 'blocks:rendered');

    fixture.destroy();

    expect(editor.off).toHaveBeenCalledWith('blocks:rendered', handler);
  });

  it('does not subscribe to rendered events when outputs are not observed', async () => {
    await mountReady(BareHost);
    const editor = blokRegistry.last;
    const subscribed = editor.on.mock.calls.map((c) => c[0]);

    expect(subscribed).not.toContain('blocks:rendered');
    expect(subscribed).not.toContain('block:rendered');
  });
});
