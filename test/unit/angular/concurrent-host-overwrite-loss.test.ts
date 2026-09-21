import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

const SERVER = 'https://blok.example';
const WITH_COLLABORATION = { server: SERVER, collaboration: { doc: 'notes' } };

/**
 * Settles the fixture the way every Angular adapter test does: change detection
 * plus a microtask drain, twice, so signal effects that read `instance()` run.
 */
async function settle(fixture: ComponentFixture<BlokEditorComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('Angular host overwriting a live collaborative document', () => {
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

  it('does not render a stale snapshot when [config] loses the collaboration key before the editor is ready', async () => {
    const fixture = TestBed.createComponent(BlokEditorComponent);

    // Boot WITH collaboration: this is what the editor is constructed with, and
    // it is what the live session is.
    fixture.componentRef.setInput('config', WITH_COLLABORATION);
    fixture.componentRef.setInput('data', doc('shared document'));
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = blokRegistry.last;

    expect(editor.config.collaboration).toEqual({ doc: 'notes' });

    // The host rebuilds [config] while boot is still in flight — a template
    // literal recomputed by change detection, or a config signal swapped when an
    // async value lands — and this rebuild no longer carries `collaboration`.
    // The editor is NOT recreated (only `recreateKey` does that), so the session
    // is still live and collaborative.
    fixture.componentRef.setInput('config', { server: SERVER });
    fixture.detectChanges();
    await fixture.whenStable();

    editor.resolveReady();
    await settle(fixture);

    expect(blokRegistry.instances).toHaveLength(1);

    // A peer has been typing; the host's own copy of the document is older than
    // the shared one. It re-supplies it (a fetch resolving, a parent re-render).
    const stale = doc('stale host copy');

    fixture.componentRef.setInput('data', stale);
    await settle(fixture);

    // THE LOSS: the adapter pushes the host's stale copy into a live
    // collaborative editor. In production `render()` is a whole-document
    // replace — the one operation that overwrites everybody else's work.
    expect(editor.render).not.toHaveBeenCalled();
    expect(editor.render).not.toHaveBeenCalledWith(stale);
    expect(collaborationWarnings()).toHaveLength(1);
  });

  it('keeps the guard when the pre-ready [config] rebuild still carries collaboration', async () => {
    // Control for the test above: same timing, same fresh object identity, but
    // the key survives. Isolates the trigger to the key's absence at capture
    // time rather than to the rebuild itself.
    const fixture = TestBed.createComponent(BlokEditorComponent);

    fixture.componentRef.setInput('config', WITH_COLLABORATION);
    fixture.componentRef.setInput('data', doc('shared document'));
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = blokRegistry.last;

    fixture.componentRef.setInput('config', { server: SERVER, collaboration: { doc: 'notes' } });
    fixture.detectChanges();
    await fixture.whenStable();

    editor.resolveReady();
    await settle(fixture);

    fixture.componentRef.setInput('data', doc('stale host copy'));
    await settle(fixture);

    expect(editor.render).not.toHaveBeenCalled();
    expect(collaborationWarnings()).toHaveLength(1);
  });

  it('warns again for the editor created by a recreateKey bump', async () => {
    // The guard's one-warning-per-instance flag is component state, not
    // per-editor state. After a recreate the host gets no feedback at all that
    // its `data` is being ignored by a second live session.
    const fixture = TestBed.createComponent(BlokEditorComponent);

    fixture.componentRef.setInput('config', WITH_COLLABORATION);
    fixture.componentRef.setInput('data', doc('a'));
    fixture.componentRef.setInput('recreateKey', 'one');
    fixture.detectChanges();
    await fixture.whenStable();
    blokRegistry.last.resolveReady();
    await settle(fixture);

    fixture.componentRef.setInput('data', doc('b'));
    await settle(fixture);

    expect(collaborationWarnings()).toHaveLength(1);

    fixture.componentRef.setInput('recreateKey', 'two');
    fixture.detectChanges();
    await fixture.whenStable();
    blokRegistry.last.resolveReady();
    await settle(fixture);

    expect(blokRegistry.instances).toHaveLength(2);

    fixture.componentRef.setInput('data', doc('c'));
    await settle(fixture);

    expect(blokRegistry.last.render).not.toHaveBeenCalled();
    expect(collaborationWarnings()).toHaveLength(2);
  });

  it('does not render a stale snapshot through Angular forms writeValue', async () => {
    // The ControlValueAccessor half: `form.patchValue()` / `form.reset()` reach
    // the same content channel. Routed through the same pre-ready [config]
    // rebuild, so the guard is off when the form writes.
    const fixture = TestBed.createComponent(BlokEditorComponent);

    fixture.componentRef.setInput('config', WITH_COLLABORATION);
    fixture.componentRef.setInput('data', doc('shared document'));
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = blokRegistry.last;

    fixture.componentRef.setInput('config', { server: SERVER });
    fixture.detectChanges();
    await fixture.whenStable();

    editor.resolveReady();
    await settle(fixture);

    const stale = doc('stale form value');

    fixture.componentInstance.writeValue(stale);
    await settle(fixture);

    expect(editor.render).not.toHaveBeenCalled();
    expect(collaborationWarnings()).toHaveLength(1);
  });
});
