import { Component, ElementRef, ViewChild, type Signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, afterEach } from 'vitest';

import { injectBlokReady } from '../../../packages/angular/src/useBlokReady';
import {
  registerInstance,
  unregisterInstance,
} from '../../../src/components/utils/ready-registry';

/**
 * A stand-in for a Blok facade: the readiness registry only needs an identity
 * key and a way to find the instance's wrapper element.
 */
interface FakeInstance {
  key: unknown;
  wrapper: HTMLElement;
  settle: () => void;
}

const created: FakeInstance[] = [];

/**
 * Registers a fake booting instance whose wrapper is mounted in `scope`.
 * @param scope - element the wrapper is appended to
 */
const bootInstance = (scope: Element): FakeInstance => {
  const key = {};
  const wrapper = document.createElement('div');

  scope.appendChild(wrapper);

  const instance: FakeInstance = {
    key,
    wrapper,
    settle: registerInstance(key, () => wrapper),
  };

  created.push(instance);

  return instance;
};

/**
 * Probe component: the scope div carries no Angular-rendered children, so the
 * test can append editor wrappers into it the way BlokContentDirective does.
 */
@Component({
  standalone: true,
  template: '<div #scope data-testid="scope"></div>',
})
class ProbeComponent {
  @ViewChild('scope', { static: true })
  public scopeRef!: ElementRef<HTMLElement>;

  public readonly ready: Signal<boolean> = injectBlokReady({
    within: () => this.scopeRef?.nativeElement ?? null,
    settleOn: 'rendered',
  });
}

/**
 * Drains the registry's coalesced microtask notification and Angular's change
 * detection.
 * @param fixture - the probe fixture to re-run change detection on
 */
const flush = async (fixture: ComponentFixture<ProbeComponent>): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
};

describe('injectBlokReady (Angular)', () => {
  afterEach(() => {
    created.forEach((instance) => unregisterInstance(instance.key));
    created.length = 0;
    document.body.replaceChildren();
    TestBed.resetTestingModule();
  });

  it('reports pending until the in-scope editor has its content in the DOM', async () => {
    const fixture = TestBed.createComponent(ProbeComponent);

    fixture.detectChanges();

    const scope = fixture.componentInstance.scopeRef.nativeElement;
    const instance = bootInstance(scope);

    await flush(fixture);
    expect(fixture.componentInstance.ready()).toBe(false);

    instance.settle();
    await flush(fixture);
    expect(fixture.componentInstance.ready()).toBe(false);

    instance.wrapper.setAttribute('data-blok-rendered', '');
    await flush(fixture);
    expect(fixture.componentInstance.ready()).toBe(true);
  });

  it('re-arms when a post-boot re-render clears the rendered attribute', async () => {
    const fixture = TestBed.createComponent(ProbeComponent);

    fixture.detectChanges();

    const scope = fixture.componentInstance.scopeRef.nativeElement;
    const instance = bootInstance(scope);

    instance.settle();
    instance.wrapper.setAttribute('data-blok-rendered', '');
    await flush(fixture);
    expect(fixture.componentInstance.ready()).toBe(true);

    instance.wrapper.removeAttribute('data-blok-rendered');
    await flush(fixture);
    expect(fixture.componentInstance.ready()).toBe(false);
  });

  it('ignores instances mounted outside the scope', async () => {
    const outside = document.createElement('div');

    document.body.appendChild(outside);

    const fixture = TestBed.createComponent(ProbeComponent);

    fixture.detectChanges();

    const inside = bootInstance(fixture.componentInstance.scopeRef.nativeElement);

    bootInstance(outside);

    inside.settle();
    inside.wrapper.setAttribute('data-blok-rendered', '');
    await flush(fixture);

    // The out-of-scope instance is still booting and must not hold the gate.
    expect(fixture.componentInstance.ready()).toBe(true);
  });

  it('stops reading after the component is destroyed', async () => {
    const fixture = TestBed.createComponent(ProbeComponent);

    fixture.detectChanges();

    const instance = bootInstance(fixture.componentInstance.scopeRef.nativeElement);

    await flush(fixture);
    expect(fixture.componentInstance.ready()).toBe(false);

    const { ready } = fixture.componentInstance;

    fixture.destroy();
    instance.settle();
    instance.wrapper.setAttribute('data-blok-rendered', '');
    await Promise.resolve();
    await Promise.resolve();

    expect(ready()).toBe(false);
  });
});
