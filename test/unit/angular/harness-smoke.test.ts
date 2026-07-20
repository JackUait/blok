import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

/**
 * Step −1 harness gate: proves the `unit-angular` Vitest project can compile an
 * Angular `@Component` template and render it through `TestBed`/`ComponentFixture`.
 * Every later Angular adapter test depends on this being green.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  selector: 'harness-smoke',
  standalone: true,
  template: `<span data-testid="msg">harness {{ status() }}</span>`,
})
class HarnessSmokeComponent {
  readonly status = signal('ok');
}

describe('Angular test harness', () => {
  it('compiles and renders a standalone component via TestBed', () => {
    const fixture = TestBed.createComponent(HarnessSmokeComponent);

    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('[data-testid="msg"]') as HTMLElement | null;

    expect(el?.textContent).toContain('harness ok');
  });
});
