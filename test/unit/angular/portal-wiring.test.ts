import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@blok/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokContentDirective } from '../../../src/angular/blok-content.directive';
import { createAngularBlock } from '../../../src/angular/createAngularBlock';
import { BLOK_BLOCK_CONTEXT } from '../../../src/angular/block-context';
import { getRegistry } from '../../../src/angular/registry-map';

// Assert BLOK_BLOCK_CONTEXT is defined (keeps the public surface honest)
void BLOK_BLOCK_CONTEXT;

const REGISTRY_CONFIG_KEY = '__blokAngularPortalRegistry';

@Component({ standalone: true, template: '' })
class NgBlockComponent {}

const NgBlock = createAngularBlock({
  type: 'ng-block',
  propSchema: { count: { default: 0 } },
  component: NgBlockComponent,
});

class VanillaTool {}

@Component({
  standalone: true,
  imports: [BlokContentDirective],
  template: `<div blokContent [config]="cfg"></div>`,
})
class Host {
  cfg = { tools: { 'ng-block': { class: NgBlock }, paragraph: { class: VanillaTool } } };
}

async function mountReady(): Promise<ComponentFixture<Host>> {
  const fixture = TestBed.createComponent(Host);

  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

describe('BlokContentDirective — Angular-block portal wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('threads a registry into Angular-block tool configs but leaves vanilla tools alone', async () => {
    await mountReady();
    const tools = blokRegistry.last.config.tools as Record<
      string,
      { class: unknown; config?: Record<string, unknown> }
    >;

    expect(tools['ng-block'].config?.[REGISTRY_CONFIG_KEY]).toBeDefined();
    expect(tools.paragraph.config?.[REGISTRY_CONFIG_KEY]).toBeUndefined();
  });

  it('associates the registry with the constructed editor via the registry map', async () => {
    await mountReady();
    const editor = await blokRegistry.last.isReady;

    expect(getRegistry(editor as object)).toBeDefined();
  });

  it('tears the registry down on destroy', async () => {
    const fixture = await mountReady();
    const editor = (await blokRegistry.last.isReady) as object;
    const registry = getRegistry(editor);
    const destroySpy = vi.spyOn(registry!, 'destroyAll');

    fixture.destroy();

    expect(destroySpy).toHaveBeenCalled();
    expect(getRegistry(editor)).toBeUndefined();
  });
});
