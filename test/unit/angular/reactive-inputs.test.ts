import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

async function mountAndReady(
  inputs: Record<string, unknown> = {}
): Promise<ComponentFixture<BlokEditorComponent>> {
  const fixture = TestBed.createComponent(BlokEditorComponent);

  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }

  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

describe('BlokEditorComponent reactive inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs readOnly changes to editor.readOnly.set', async () => {
    const fixture = await mountAndReady({ readOnly: false });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    expect(editor.readOnly.set).toHaveBeenLastCalledWith(true);
  });

  it('coerces undefined readOnly to false', async () => {
    const fixture = await mountAndReady({ readOnly: undefined });
    const editor = blokRegistry.last;

    expect(editor.readOnly.set).toHaveBeenLastCalledWith(false);
  });

  it('does not call theme/width/placeholder setters while their inputs are undefined', async () => {
    const fixture = await mountAndReady();
    const editor = blokRegistry.last;

    expect(editor.theme.set).not.toHaveBeenCalled();
    expect(editor.width.set).not.toHaveBeenCalled();
    expect(editor.placeholder.set).not.toHaveBeenCalled();
    void fixture;
  });

  it('syncs theme/width/placeholder when defined', async () => {
    const fixture = await mountAndReady({ theme: 'dark', width: 'full', placeholder: 'Type…' });
    const editor = blokRegistry.last;

    expect(editor.theme.set).toHaveBeenCalledWith('dark');
    expect(editor.width.set).toHaveBeenCalledWith('full');
    expect(editor.placeholder.set).toHaveBeenCalledWith('Type…');
    void fixture;
  });

  it('focuses the editor when autofocus is truthy', async () => {
    const fixture = await mountAndReady({ autofocus: true });
    const editor = blokRegistry.last;

    expect(editor.focus).toHaveBeenCalled();
    void fixture;
  });

  it('syncs the readOnly object form as set(enabled, { hideControls }) without recreating', async () => {
    const fixture = await mountAndReady({ readOnly: false });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('readOnly', { hideControls: true });
    fixture.detectChanges();

    expect(editor.readOnly.set).toHaveBeenLastCalledWith(true, { hideControls: true });
    expect(blokRegistry.instances).toHaveLength(1);
  });

  it('exposes the in-place toggle capability on the live instance', async () => {
    const fixture = await mountAndReady();

    expect(fixture.componentInstance.instance()?.readOnly.togglesInPlace).toBe(true);
  });

  it('syncs hideToolbar changes to editor.toolbar.setHidden without recreating', async () => {
    const fixture = await mountAndReady({ hideToolbar: false });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('hideToolbar', true);
    fixture.detectChanges();

    expect(editor.toolbar.setHidden).toHaveBeenLastCalledWith(true);
    expect(blokRegistry.instances).toHaveLength(1);
  });

  it('does not call toolbar.setHidden while hideToolbar is undefined', async () => {
    await mountAndReady();

    expect(blokRegistry.last.toolbar.setHidden).not.toHaveBeenCalled();
  });

  it('seeds hideToolbar and inlineToolbar into the construction config', async () => {
    await mountAndReady({ hideToolbar: true, inlineToolbar: ['bold'] });

    expect(blokRegistry.last.config.hideToolbar).toBe(true);
    expect(blokRegistry.last.config.inlineToolbar).toEqual(['bold']);
  });

  it('syncs inlineToolbar changes to editor.tools.setInlineToolbar without recreating', async () => {
    const fixture = await mountAndReady({ inlineToolbar: true });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('inlineToolbar', ['bold', 'italic']);
    fixture.detectChanges();

    expect(editor.tools.setInlineToolbar).toHaveBeenLastCalledWith(['bold', 'italic']);
    expect(blokRegistry.instances).toHaveLength(1);
  });

  it('dedupes inlineToolbar arrays by content (a new same-content array is a no-op)', async () => {
    const fixture = await mountAndReady({ inlineToolbar: ['bold', 'italic'] });
    const editor = blokRegistry.last;
    const callsAfterMount = editor.tools.setInlineToolbar.mock.calls.length;

    fixture.componentRef.setInput('inlineToolbar', ['bold', 'italic']);
    fixture.detectChanges();

    expect(editor.tools.setInlineToolbar.mock.calls.length).toBe(callsAfterMount);
    expect(blokRegistry.instances).toHaveLength(1);
  });

  it('re-applies reactive props once the instance appears (input set before ready)', async () => {
    const fixture = TestBed.createComponent(BlokEditorComponent);

    fixture.componentRef.setInput('readOnly', true);
    fixture.componentRef.setInput('theme', 'dark');
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = blokRegistry.last;

    // Not ready yet → no reactive sync has run.
    expect(editor.theme.set).not.toHaveBeenCalled();

    blokRegistry.last.resolveReady();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(editor.readOnly.set).toHaveBeenLastCalledWith(true);
    expect(editor.theme.set).toHaveBeenCalledWith('dark');
  });
});
