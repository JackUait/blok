import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

async function settle(fixture: ComponentFixture<BlokEditorComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('BlokEditorComponent render chain', () => {
  let unhandled: unknown[] = [];
  const record = (reason: unknown): void => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
    unhandled = [];
    process.on('unhandledRejection', record);
    // zone.js (Angular's test env) re-throws an unhandled rejection as an
    // uncaught error, so both channels have to be watched.
    process.on('uncaughtException', record);
  });

  afterEach(() => {
    process.off('unhandledRejection', record);
    process.off('uncaughtException', record);
    vi.restoreAllMocks();
  });

  it('owns a failed render instead of leaving it unhandled', async () => {
    const fixture = TestBed.createComponent(BlokEditorComponent);

    fixture.componentRef.setInput('data', doc('a'));
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = blokRegistry.last;

    editor.resolveReady();
    await settle(fixture);

    editor.render.mockRejectedValue(new Error('render failed'));

    fixture.componentRef.setInput('data', doc('b'));
    await settle(fixture);

    // Node flags a rejected promise with no handler on the next macrotask turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandled).toEqual([]);
    expect(editor.render).toHaveBeenCalledTimes(1);
  });

  it('still renders the next data change after a failed one', async () => {
    const fixture = TestBed.createComponent(BlokEditorComponent);

    fixture.componentRef.setInput('data', doc('a'));
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = blokRegistry.last;

    editor.resolveReady();
    await settle(fixture);

    editor.render.mockRejectedValueOnce(new Error('render failed'));

    fixture.componentRef.setInput('data', doc('b'));
    await settle(fixture);

    const next = doc('c');

    fixture.componentRef.setInput('data', next);
    await settle(fixture);

    expect(editor.render).toHaveBeenCalledTimes(2);
    expect(editor.render).toHaveBeenLastCalledWith(next);
  });
});

describe('BlokEditorComponent content baseline across a failed render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-renders the same content the host re-sends after a failed render', async () => {
    // The baseline must name what the editor ACTUALLY shows. Advancing it before
    // the render resolves strands it on content the editor never reached, and
    // the host's retry of that same content is deduped away forever.
    const fixture = TestBed.createComponent(BlokEditorComponent);

    fixture.componentRef.setInput('data', doc('a'));
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = blokRegistry.last;

    editor.resolveReady();
    await settle(fixture);

    editor.render.mockRejectedValueOnce(new Error('render failed'));

    fixture.componentRef.setInput('data', doc('b'));
    await settle(fixture);

    // The host re-sends the content the editor failed to show (a retry, a parent
    // re-render, a refetch resolving to the same document).
    const retry = doc('b');

    fixture.componentRef.setInput('data', retry);
    await settle(fixture);

    expect(editor.render).toHaveBeenCalledTimes(2);
    expect(editor.render).toHaveBeenLastCalledWith(retry);
  });

  it('suppresses an echo of content whose render is still in flight', async () => {
    // Dropping the eager baseline must not let a mid-flight echo queue a second
    // render of the same content — that would reset the caret for zero change.
    const fixture = TestBed.createComponent(BlokEditorComponent);

    fixture.componentRef.setInput('data', doc('a'));
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = blokRegistry.last;

    editor.resolveReady();
    await settle(fixture);

    let finishRender = (): void => undefined;

    editor.render.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRender = (): void => resolve();
        })
    );

    fixture.componentRef.setInput('data', doc('b'));
    await settle(fixture);

    expect(editor.render).toHaveBeenCalledTimes(1);

    // Same content arrives again while the first render is still unresolved.
    fixture.componentRef.setInput('data', doc('b'));
    await settle(fixture);

    expect(editor.render).toHaveBeenCalledTimes(1);

    finishRender();
    await settle(fixture);

    expect(editor.render).toHaveBeenCalledTimes(1);
  });
});
