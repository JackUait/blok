import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BLOK_BLOCK_CONTEXT, type AngularBlockRenderContext } from '../../../packages/angular/src/block-context';

describe('BLOK_BLOCK_CONTEXT', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('is injectable and delivers the provided render context', () => {
    const ctx = { commit: vi.fn() } as unknown as AngularBlockRenderContext<unknown>;

    @Component({ standalone: true, template: '' })
    class Probe {
      readonly received = inject(BLOK_BLOCK_CONTEXT);
    }

    TestBed.configureTestingModule({
      providers: [{ provide: BLOK_BLOCK_CONTEXT, useValue: ctx }],
    });
    const fixture = TestBed.createComponent(Probe);

    expect(fixture.componentInstance.received).toBe(ctx);
  });
});
