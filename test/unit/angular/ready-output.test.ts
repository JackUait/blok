import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Blok } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor (ready)="onReady($event)"></blok-editor>`,
})
class ReadyHost {
  @ViewChild(BlokEditorComponent) editor!: BlokEditorComponent;
  readyArgs: Blok[] = [];
  instanceAtReady: Blok | null = null;
  onReady(editor: Blok): void {
    this.readyArgs.push(editor);
    this.instanceAtReady = this.editor.instance();
  }
}

async function mount(): Promise<ComponentFixture<ReadyHost>> {
  const fixture = TestBed.createComponent(ReadyHost);

  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

describe('BlokEditorComponent ready output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not emit ready before isReady resolves', async () => {
    const fixture = await mount();

    expect(fixture.componentInstance.readyArgs).toHaveLength(0);
  });

  it('emits ready exactly once after the instance is populated', async () => {
    const fixture = await mount();

    blokRegistry.last.resolveReady();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.componentInstance;

    expect(host.readyArgs).toHaveLength(1);
    // Ordering law: instance() is already populated when (ready) fires.
    expect(host.instanceAtReady).toBe(host.readyArgs[0]);
  });
});
