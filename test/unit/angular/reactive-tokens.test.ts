/**
 * Reactive theme tokens in the Angular adapter — parity with React/Vue.
 *
 * `style` was construction-only, so a host with a live light/dark toggle could
 * not drive Blok's theme tokens from Angular state and fell back to a global
 * stylesheet duplicating the one Blok injects. The `styleTokens` input drives
 * the runtime `editor.tokens` API instead.
 */
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

describe('BlokEditorComponent reactive tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes a changed token set through editor.tokens.set', async () => {
    const fixture = await mountAndReady({ styleTokens: { '--blok-popover-bg': '#fff' } });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('styleTokens', { '--blok-popover-bg': '#1f1f1f' });
    fixture.detectChanges();

    expect(editor.tokens.set).toHaveBeenLastCalledWith({ '--blok-popover-bg': '#1f1f1f' });
  });

  it('does not re-push an identical token set', async () => {
    const fixture = await mountAndReady({ styleTokens: { '--blok-popover-bg': '#fff' } });
    const editor = blokRegistry.last;

    const callsBefore = editor.tokens.set.mock.calls.length;

    fixture.componentRef.setInput('styleTokens', { '--blok-popover-bg': '#fff' });
    fixture.detectChanges();

    expect(editor.tokens.set.mock.calls.length).toBe(callsBefore);
  });

  it('applies an emptied token set so removed tokens stop applying', async () => {
    const fixture = await mountAndReady({ styleTokens: { '--blok-popover-bg': '#fff' } });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('styleTokens', {});
    fixture.detectChanges();

    expect(editor.tokens.set).toHaveBeenLastCalledWith({});
  });

  it('does not touch tokens while the input is undefined', async () => {
    await mountAndReady();

    expect(blokRegistry.last.tokens.set).not.toHaveBeenCalled();
  });
});
