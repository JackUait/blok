import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Shared Blok runtime mock (hoisted so it's reachable inside the `vi.mock`
 * factory). Records every constructor config so we can assert what reached core.
 */
const mock = vi.hoisted(() => {
  const ctorConfigs: Array<Record<string, unknown>> = [];

  class MockBlok {
    public isReady: Promise<MockBlok>;
    public destroy = vi.fn();

    public constructor(config: Record<string, unknown>) {
      ctorConfigs.push(config);
      this.isReady = Promise.resolve(this);
    }
  }

  return { MockBlok, ctorConfigs };
});

vi.mock('@blok/core', () => ({ Blok: mock.MockBlok }));

import { BlokContentDirective } from '../../../packages/angular/src/blok-content.directive';
import { provideBlok } from '../../../packages/angular/src/provide-blok';

@Component({
  standalone: true,
  imports: [BlokContentDirective],
  template: `<div blokContent [config]="config"></div>`,
})
class HostComponent {
  config: Record<string, unknown> = {};
}

/** Mounts the directive escape hatch directly under the given DI providers. */
async function mount(
  providers: unknown[],
  config: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  TestBed.configureTestingModule({ providers: providers as never[] });

  const fixture = TestBed.createComponent(HostComponent);

  fixture.componentInstance.config = config;
  fixture.detectChanges();
  await fixture.whenStable();

  return mock.ctorConfigs[0];
}

describe('BlokContentDirective honors provideBlok defaults (escape hatch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.ctorConfigs.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies an injected default when the [config] omits it', async () => {
    const config = await mount([provideBlok({ theme: 'dark', minHeight: 120 })]);

    expect(config.theme).toBe('dark');
    expect(config.minHeight).toBe(120);
  });

  it('lets the per-instance [config] override the injected default', async () => {
    const config = await mount([provideBlok({ theme: 'dark' })], { theme: 'light' });

    expect(config.theme).toBe('light');
  });

  it('merges tools registries (default + instance) instead of replacing', async () => {
    const config = await mount([provideBlok({ tools: { paragraph: {} } as never })], {
      tools: { header: {} },
    });

    const tools = config.tools as Record<string, unknown>;

    expect(Object.keys(tools).sort()).toEqual(['header', 'paragraph']);
  });

  it('passes [config] through untouched when no provider is present', async () => {
    const config = await mount([], { theme: 'light' });

    expect(config.theme).toBe('light');
  });
});
