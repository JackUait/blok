import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@blok/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

async function mountReady(
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
  await fixture.whenStable();

  return fixture;
}

describe('BlokEditorComponent recreateKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not recreate when a construction-only input changes', async () => {
    const fixture = await mountReady({ recreateKey: 'a' });

    fixture.componentRef.setInput('tools', { paragraph: {} });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(blokRegistry.instances).toHaveLength(1);
    expect(blokRegistry.instances[0].destroy).not.toHaveBeenCalled();
  });

  it('destroys and recreates when recreateKey identity changes', async () => {
    const fixture = await mountReady({ recreateKey: 'a' });

    fixture.componentRef.setInput('recreateKey', 'b');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(blokRegistry.instances).toHaveLength(2);
    expect(blokRegistry.instances[0].destroy).toHaveBeenCalledTimes(1);
  });
});
