import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@blok/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../src/angular/blok-editor.component';

@Component({
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor></blok-editor>`,
})
class SsrHost {}

describe('BlokEditorComponent SSR safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not construct the editor on the server platform', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });

    const fixture = TestBed.createComponent(SsrHost);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(blokRegistry.instances).toHaveLength(0);
  });

  it('still renders a host element on the server (stable hydration shell)', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });

    const fixture = TestBed.createComponent(SsrHost);

    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement.querySelector('div') as HTMLElement | null;

    expect(host).not.toBeNull();
  });

  it('does not throw when destroyed on the server', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });

    const fixture = TestBed.createComponent(SsrHost);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(() => fixture.destroy()).not.toThrow();
  });
});
