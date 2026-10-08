import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Blok, BlokConfig, OutputData } from '@/types';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';
import { Paragraph } from '../../../src/tools/paragraph';

const TOOLS = { paragraph: { class: Paragraph } };

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor [tools]="tools" [data]="data" [config]="config" (ready)="editor = $event"></blok-editor>`,
})
class Host {
  tools = TOOLS;
  data: OutputData | undefined = undefined;
  config: { pageTitle?: BlokConfig['pageTitle'] } = {};
  editor: Blok | null = null;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fixtures: ComponentFixture<Host>[] = [];

const mountReady = async (setup: (host: Host) => void): Promise<ComponentFixture<Host>> => {
  const fixture = TestBed.createComponent(Host);

  fixtures.push(fixture);
  setup(fixture.componentInstance);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  fixture.autoDetectChanges();

  const start = Date.now();

  while (fixture.componentInstance.editor === null) {
    if (Date.now() - start > 5000) {
      throw new Error('editor never became ready');
    }
    await wait(20);
  }

  return fixture;
};

describe('BlokEditorComponent [config].pageTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    fixtures.splice(0).forEach((fixture) => fixture.destroy());
    vi.restoreAllMocks();
  });

  it('forwards pageTitle into the editor config', async () => {
    const fixture = await mountReady((host) => {
      host.config = { pageTitle: { placeholder: 'Untitled' } };
    });
    const title = (fixture.nativeElement as HTMLElement).querySelector('[data-blok-testid="page-header-title"]');

    expect(title).not.toBeNull();
    expect(title?.getAttribute('data-placeholder')).toBe('Untitled');
  });

  it('loads the title from data', async () => {
    const fixture = await mountReady((host) => {
      host.config = { pageTitle: true };
      host.data = { title: 'T', blocks: [] };
    });

    expect(fixture.componentInstance.editor?.title.get()).toBe('T');
  });
});
