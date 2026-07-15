import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@blok/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../src/angular/blok-editor.component';
import { provideBlok } from '../../../src/angular/provide-blok';

async function mountReady(
  providers: unknown[],
  inputs: Record<string, unknown> = {}
): Promise<ComponentFixture<BlokEditorComponent>> {
  TestBed.configureTestingModule({ providers: providers as never[] });

  const fixture = TestBed.createComponent(BlokEditorComponent);

  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }

  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();

  return fixture;
}

describe('BlokEditorComponent DI defaults (provideBlok)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies provideBlok defaults to the editor config', async () => {
    await mountReady([provideBlok({ theme: 'dark', minHeight: 120 })]);

    expect(blokRegistry.last.config.theme).toBe('dark');
    expect(blokRegistry.last.config.minHeight).toBe(120);
  });

  it('lets a per-instance input override a provider default', async () => {
    await mountReady([provideBlok({ theme: 'dark' })], { theme: 'light' });

    expect(blokRegistry.last.config.theme).toBe('light');
  });

  it('applies the per-instance [config] escape hatch', async () => {
    await mountReady([], { config: { minHeight: 80, defaultBlock: 'header' } });

    expect(blokRegistry.last.config.minHeight).toBe(80);
    expect(blokRegistry.last.config.defaultBlock).toBe('header');
  });

  it('lets a discrete input override the [config] object', async () => {
    await mountReady([], { config: { theme: 'dark' }, theme: 'light' });

    expect(blokRegistry.last.config.theme).toBe('light');
  });

  it('layers precedence token < [config] < discrete input', async () => {
    await mountReady([provideBlok({ theme: 'auto', minHeight: 10 })], {
      config: { theme: 'dark', minHeight: 20 },
      theme: 'light',
    });

    expect(blokRegistry.last.config.theme).toBe('light');
    expect(blokRegistry.last.config.minHeight).toBe(20);
  });

  it('merges tools registries rather than replacing them', async () => {
    await mountReady([provideBlok({ tools: { paragraph: {} } as never })], {
      tools: { header: {} } as never,
    });

    const tools = blokRegistry.last.config.tools as Record<string, unknown>;

    expect(Object.keys(tools).sort()).toEqual(['header', 'paragraph']);
  });
});
