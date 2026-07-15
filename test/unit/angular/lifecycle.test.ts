import { Component, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mock = vi.hoisted(() => {
  interface Deferred {
    isReady: Promise<unknown>;
    resolveReady: () => void;
    destroy: ReturnType<typeof vi.fn>;
  }

  const instances: Deferred[] = [];
  const ctorConfigs: Array<Record<string, unknown>> = [];

  class MockBlok {
    public isReady: Promise<unknown>;
    public destroy = vi.fn();
    private resolveFn!: (value: unknown) => void;

    public constructor(config: Record<string, unknown>) {
      ctorConfigs.push(config);
      // Deferred so tests control exactly when isReady resolves.
      this.isReady = new Promise((resolve) => {
        this.resolveFn = resolve;
      });
      instances.push({
        isReady: this.isReady,
        resolveReady: () => this.resolveFn(this),
        destroy: this.destroy,
      });
    }
  }

  return { MockBlok, instances, ctorConfigs };
});

vi.mock('@bloklabs/core', () => ({ Blok: mock.MockBlok }));

import { BlokContentDirective } from '../../../packages/angular/src/blok-content.directive';

@Component({
  standalone: true,
  imports: [BlokContentDirective],
  template: `<div blokContent (ready)="onReady($event)"></div>`,
})
class HostComponent {
  readyCount = 0;
  onReady(_editor: unknown): void {
    this.readyCount += 1;
  }
}

function getDirective(fixture: ReturnType<typeof TestBed.createComponent>): BlokContentDirective {
  return fixture.debugElement
    .query(By.directive(BlokContentDirective))
    .injector.get(BlokContentDirective);
}

describe('BlokContentDirective lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.instances.length = 0;
    mock.ctorConfigs.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the instance only after isReady resolves', async () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    await fixture.whenStable();

    const directive = getDirective(fixture);

    // Constructed, but isReady not resolved yet.
    expect(directive.instance()).toBeNull();

    mock.instances[0].resolveReady();
    await fixture.whenStable();

    expect(directive.instance()).not.toBeNull();
  });

  it('emits (ready) once after the instance is populated', async () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.readyCount).toBe(0);

    mock.instances[0].resolveReady();
    await fixture.whenStable();

    expect(fixture.componentInstance.readyCount).toBe(1);
  });

  it('destroys the editor exactly once on teardown', async () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    await fixture.whenStable();
    mock.instances[0].resolveReady();
    await fixture.whenStable();

    fixture.destroy();

    expect(mock.instances[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('ignores a late isReady resolution after destroy (stale guard)', async () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    await fixture.whenStable();

    const directive = getDirective(fixture);

    // Destroy before isReady resolves.
    fixture.destroy();
    mock.instances[0].resolveReady();
    await Promise.resolve();

    expect(directive.instance()).toBeNull();
    expect(fixture.componentInstance.readyCount).toBe(0);
    expect(mock.instances[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('constructs the editor outside the Angular zone', async () => {
    const zone = TestBed.inject(NgZone);
    const spy = vi.spyOn(zone, 'runOutsideAngular');

    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(spy).toHaveBeenCalled();
    expect(mock.ctorConfigs).toHaveLength(1);
  });
});
