import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Shared Blok runtime mock. Defined via `vi.hoisted` so the class/registry are
 * available inside the hoisted `vi.mock` factory.
 */
const mock = vi.hoisted(() => {
  const ctorConfigs: Array<Record<string, unknown>> = [];
  const destroySpies: Array<() => void> = [];

  class MockBlok {
    public isReady: Promise<MockBlok>;
    public destroy = vi.fn();

    public constructor(config: Record<string, unknown>) {
      ctorConfigs.push(config);
      destroySpies.push(this.destroy);
      // Resolve to the instance, after the constructor returns (real Blok shape).
      this.isReady = Promise.resolve(this);
    }
  }

  return { MockBlok, ctorConfigs, destroySpies };
});

vi.mock('@bloklabs/core', () => ({ Blok: mock.MockBlok }));

import { BlokContentDirective } from '../../../packages/angular/src/blok-content.directive';

@Component({
  standalone: true,
  imports: [BlokContentDirective],
  template: `<div blokContent [config]="config"></div>`,
})
class HostComponent {
  config: Record<string, unknown> = {};
}

describe('BlokContentDirective', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.ctorConfigs.length = 0;
    mock.destroySpies.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs a Blok with its host element as the holder', async () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    await fixture.whenStable();

    const hostDiv = fixture.debugElement.query(By.directive(BlokContentDirective))
      .nativeElement as HTMLElement;

    expect(mock.ctorConfigs).toHaveLength(1);
    expect(mock.ctorConfigs[0].holder).toBe(hostDiv);
  });

  it('passes the bound [config] into the Blok constructor', async () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.componentInstance.config = { readOnly: true, minHeight: 42 };
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mock.ctorConfigs[0].readOnly).toBe(true);
    expect(mock.ctorConfigs[0].minHeight).toBe(42);
  });

  it('destroys the editor when the host component is destroyed', async () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(mock.destroySpies).toHaveLength(1);

    fixture.destroy();

    expect(mock.destroySpies[0]).toHaveBeenCalledTimes(1);
  });
});
