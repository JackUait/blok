import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

type CoreOnSave = (data: OutputData) => void;

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor [data]="data" (save)="saved = $event"></blok-editor>`,
})
class PersistingHost {
  data: OutputData | null = doc('a');
  saved: OutputData | null = null;
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

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('BlokEditorComponent emitted-echo window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores a STALE echo of an earlier onSave payload', async () => {
    // The ordinary persist-on-save-and-refetch ordering: two payloads are
    // emitted, and the host's write of the FIRST one resolves last. Rendering it
    // is a whole-document replace, so everything typed between the two saves
    // ceases to exist AND the editor's next save writes the rewound document
    // back over the newer one — permanent loss in the host's store.
    const fixture = await mountReady(PersistingHost);
    const editor = blokRegistry.last;
    const coreOnSave = editor.config.onSave as CoreOnSave;

    coreOnSave(doc('a1'));
    coreOnSave(doc('a12'));

    fixture.componentInstance.data = doc('a1');
    await settle(fixture);

    expect(editor.render).not.toHaveBeenCalled();
  });

  it('still renders content the editor never emitted', async () => {
    const fixture = await mountReady(PersistingHost);
    const editor = blokRegistry.last;
    const coreOnSave = editor.config.onSave as CoreOnSave;

    coreOnSave(doc('a1'));
    coreOnSave(doc('a12'));

    const external = doc('from a collaborator');

    fixture.componentInstance.data = external;
    await settle(fixture);

    expect(editor.render).toHaveBeenCalledTimes(1);
    expect(editor.render).toHaveBeenCalledWith(external);
  });

  it('drops remembered payloads once genuinely external content takes over', async () => {
    // After the host imposes its own document, a later deliberate revert to a
    // previously emitted one must render rather than be dismissed as an echo.
    const fixture = await mountReady(PersistingHost);
    const editor = blokRegistry.last;
    const coreOnSave = editor.config.onSave as CoreOnSave;

    coreOnSave(doc('a1'));
    coreOnSave(doc('a12'));

    fixture.componentInstance.data = doc('external');
    await settle(fixture);

    const revert = doc('a1');

    fixture.componentInstance.data = revert;
    await settle(fixture);

    expect(editor.render).toHaveBeenCalledTimes(2);
    expect(editor.render).toHaveBeenLastCalledWith(revert);
  });
});
