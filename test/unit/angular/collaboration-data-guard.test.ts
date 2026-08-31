import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

const COLLABORATION = {
  server: 'https://blok.example',
  collaboration: { doc: 'notes' },
};

/**
 * `collaboration` reaches the component through the `[config]` escape hatch (it
 * has no discrete input), and it must be set BEFORE the first change detection
 * so the editor is constructed with it.
 */
async function mount(
  inputs: { data?: OutputData; collaboration?: boolean } = {}
): Promise<ComponentFixture<BlokEditorComponent>> {
  const fixture = TestBed.createComponent(BlokEditorComponent);

  if (inputs.collaboration === true) {
    fixture.componentRef.setInput('config', COLLABORATION);
  }
  if (inputs.data !== undefined) {
    fixture.componentRef.setInput('data', inputs.data);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

describe('BlokEditorComponent controlled data under collaboration', () => {
  let warnings: string[] = [];

  const collaborationWarnings = (): string[] =>
    warnings.filter((message) => message.includes('collaboration is on'));

  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds data at mount without rendering or warning', async () => {
    const data = doc('seed');

    await mount({ data, collaboration: true });

    expect(blokRegistry.last.config.data).toEqual(data);
    expect(blokRegistry.last.render).not.toHaveBeenCalled();
    expect(collaborationWarnings()).toHaveLength(0);
  });

  it('skips the controlled re-render and warns once across repeated data changes', async () => {
    const fixture = await mount({ data: doc('a'), collaboration: true });
    const editor = blokRegistry.last;

    // A render the adapter must never reach: reaching it would also surface an
    // unhandled rejection, which is the bug this guard removes.
    editor.render.mockRejectedValue(
      new Error('blocks.render() is not allowed while collaboration is on')
    );

    fixture.componentRef.setInput('data', doc('b'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('data', doc('c'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).not.toHaveBeenCalled();

    const seen = collaborationWarnings();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('POST /sync/notes/reset');
  });

  it('keeps skipping (and warns) after the host drops the collaboration key', async () => {
    // `collaboration` is mount-fixed: dropping it from `[config]` cannot turn
    // the live editor into a single-player one, so the guard must decide
    // against what the editor was CONSTRUCTED with. Reading the current input
    // lets the change fall through into render(), which rejects with nothing
    // surfaced.
    const fixture = await mount({ data: doc('a'), collaboration: true });
    const editor = blokRegistry.last;

    editor.render.mockRejectedValue(
      new Error('blocks.render() is not allowed while collaboration is on')
    );

    fixture.componentRef.setInput('config', { server: 'https://blok.example' });
    fixture.componentRef.setInput('data', doc('b'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).not.toHaveBeenCalled();

    const seen = collaborationWarnings();

    expect(seen).toHaveLength(1);
    // The doc id comes from the MOUNTED config, so the reset endpoint is still
    // nameable after the key is gone.
    expect(seen[0]).toContain('POST /sync/notes/reset');
  });

  it('still re-renders on a data change when collaboration is off', async () => {
    const fixture = await mount({ data: doc('a') });
    const editor = blokRegistry.last;
    const next = doc('b');

    fixture.componentRef.setInput('data', next);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).toHaveBeenCalledTimes(1);
    expect(editor.render).toHaveBeenCalledWith(next);
    expect(collaborationWarnings()).toHaveLength(0);
  });
});
