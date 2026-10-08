import { ChangeDetectionStrategy, Component, NgZone } from '@angular/core';
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
  template: `<span data-testid="shown-title">{{ shownTitle }}</span>
    <blok-editor [tools]="tools" [data]="data" [config]="config" (ready)="editor = $event"></blok-editor>`,
})
class Host {
  tools = TOOLS;
  data: OutputData | undefined = undefined;
  config: { pageTitle?: BlokConfig['pageTitle'] } = {};
  editor: Blok | null = null;
  shownTitle = '';
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

  it('calls the onChange of the latest [config]', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const fixture = await mountReady((host) => {
      host.config = { pageTitle: { onChange: a } };
    });
    const host = fixture.componentInstance;
    const before = host.editor;

    host.config = { pageTitle: { onChange: b } };
    fixture.detectChanges();
    await fixture.whenStable();

    // A recreated editor would call b with no fix at all.
    expect(host.editor).toBe(before);
    before?.title.set('x');

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith('x', { source: 'api' });
  });

  it('calls the onIconChange of the latest [config]', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const fixture = await mountReady((host) => {
      host.config = { pageTitle: { onIconChange: a } };
    });
    const host = fixture.componentInstance;
    const before = host.editor;

    host.config = { pageTitle: { onIconChange: b } };
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.editor).toBe(before);
    before?.title.icon.set({ type: 'emoji', value: '🚀' });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not throw on a title change after pageTitle becomes null', async () => {
    const a = vi.fn();
    const fixture = await mountReady((host) => {
      host.config = { pageTitle: { onChange: a } };
    });
    const host = fixture.componentInstance;
    const before = host.editor;

    // Not in the type, but a JS host or a loose [config] can pass it.
    host.config = { pageTitle: null as unknown as BlokConfig['pageTitle'] };
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.editor).toBe(before);
    expect(() => before?.title.set('x')).not.toThrow();
    expect(() => before?.title.icon.set({ type: 'emoji', value: '🚀' })).not.toThrow();
    expect(a).not.toHaveBeenCalled();
  });

  it('hears an onChange added after mounting with pageTitle: true', async () => {
    const b = vi.fn();
    const fixture = await mountReady((host) => {
      host.config = { pageTitle: true };
    });
    const host = fixture.componentInstance;
    const before = host.editor;

    host.config = { pageTitle: { onChange: b } };
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.editor).toBe(before);
    before?.title.set('x');

    expect(b).toHaveBeenCalledTimes(1);
  });

  it('runs change detection after a title onChange from outside the zone', async () => {
    const fixture = await mountReady((host) => {
      host.config = {
        pageTitle: {
          onChange: (title: string): void => {
            host.shownTitle = title;
          },
        },
      };
    });
    const editor = fixture.componentInstance.editor;

    // The editor runs outside the zone, so this is how a typed title reaches the host.
    TestBed.inject(NgZone).runOutsideAngular(() => editor?.title.set('Plans'));
    await wait(50);

    const shown = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="shown-title"]');

    expect(shown?.textContent).toBe('Plans');
  });
});
