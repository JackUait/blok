/**
 * Reactive callback PRESENCE (Angular adapter).
 *
 * The component wires the core callbacks opt-in (an observed output, a
 * registered forms hook, a provided transform) and `buildConfig()` is read once,
 * at construction. Since callback presence IS the semantics in core — an
 * `onSubmit` turns Enter from "split the block" into "serialize and submit", an
 * `onSave` arms the change-observation pipeline — a `[config]` swap or a
 * `*ngIf`-gated output that appears after mount could only take effect by
 * recreating the editor.
 *
 * These tests pin the runtime path: presence flips go through
 * `editor.handlers.set(...)` on the SAME instance, in both directions.
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LiveHandlers, OutputData } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  // onEnter/onSubmit are routed through the `config` escape hatch (no dedicated
  // @Input), matching how onEnter is exposed on this adapter.
  template: `<blok-editor [config]="config"></blok-editor>`,
})
class ConfigHost {
  submitted: unknown[] = [];
  submit = (data: unknown): void => {
    this.submitted.push(data);
  };

  config: Record<string, unknown> = {};
}

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

/** Merge of every `handlers.set` payload pushed so far (last write wins). */
function appliedHandlers(): LiveHandlers {
  return blokRegistry.last.handlers.set.mock.calls.reduce<LiveHandlers>(
    (merged, [payload]) => ({ ...merged, ...(payload as LiveHandlers) }),
    {}
  );
}

describe('BlokEditorComponent reactive handler presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('arms onSubmit on the SAME instance when the config gains it', async () => {
    const fixture = await mountReady(ConfigHost);

    expect(blokRegistry.instances).toHaveLength(1);
    expect(blokRegistry.last.config.onSubmit).toBeUndefined();

    fixture.componentInstance.config = { onSubmit: fixture.componentInstance.submit };
    fixture.detectChanges();
    await fixture.whenStable();

    expect(blokRegistry.instances).toHaveLength(1);

    const applied = appliedHandlers();

    expect(typeof applied.onSubmit).toBe('function');

    const data = { blocks: [] } as OutputData;

    applied.onSubmit?.(data, {} as never);
    expect(fixture.componentInstance.submitted).toEqual([data]);
  });

  it('clears onSubmit on the SAME instance when the config drops it', async () => {
    const fixture = TestBed.createComponent(ConfigHost);

    fixture.componentInstance.config = { onSubmit: fixture.componentInstance.submit };
    fixture.detectChanges();
    await fixture.whenStable();
    blokRegistry.last.resolveReady();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(typeof blokRegistry.last.config.onSubmit).toBe('function');

    fixture.componentInstance.config = {};
    fixture.detectChanges();
    await fixture.whenStable();

    expect(blokRegistry.instances).toHaveLength(1);
    expect(appliedHandlers()).toHaveProperty('onSubmit', undefined);
  });

  it('does not re-push when presence is unchanged', async () => {
    const fixture = await mountReady(ConfigHost);

    fixture.componentInstance.config = { onSubmit: fixture.componentInstance.submit };
    fixture.detectChanges();
    await fixture.whenStable();

    const callsAfterArm = blokRegistry.last.handlers.set.mock.calls.length;

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(blokRegistry.last.handlers.set.mock.calls.length).toBe(callsAfterArm);
  });
});
