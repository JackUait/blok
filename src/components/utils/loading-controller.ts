import { DATA_ATTR } from '../constants/data-attributes';
import { announce } from './announcer';
import type { ResolvedLoaderConfig } from './loader-config';
import { buildLoadingSkeleton } from './loading-skeleton';
import { logLabeled } from './logger';
import { HANDOFF_DURATION, HANDOFF_STAGGER, runSkeletonHandoff } from './skeleton-handoff';

/** Once shown, shorter than this reads as a flicker. */
export const MIN_VISIBLE = 400;

/** Extra time past the handoff's own length before we stop waiting for it. */
const HANDOFF_GRACE = 250;

export class LoadingController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private skeleton: { root: HTMLElement; bars: HTMLElement[] } | null = null;
  private wait: { timer: ReturnType<typeof setTimeout>; resolve: () => void } | null = null;
  private hiding: Promise<void> | null = null;
  private shownAt = 0;
  private started = false;
  private destroyed = false;

  constructor(private readonly args: { wrapper: HTMLElement; content: HTMLElement; config: ResolvedLoaderConfig; label: string }) {}

  public get isVisible(): boolean {
    return this.skeleton !== null;
  }

  public show(): void {
    // Blok boots once per controller, so showing again during or after a hide is not supported.
    if (!this.args.config.enabled || this.started || this.hiding !== null || this.destroyed) {
      return;
    }

    this.started = true;
    this.args.wrapper.setAttribute('aria-busy', 'true');
    // onChange is wired only after the handoff, so an edit made under the skeleton would never reach the host.
    this.args.content.setAttribute('inert', '');
    // The shared region lives on body, outside the busy subtree, and is filled a task after it is cleared.
    announce(this.args.label, { politeness: 'polite' });

    this.timer = setTimeout(() => {
      this.timer = null;
      this.skeleton = buildLoadingSkeleton(this.args.config.skeleton);
      this.args.wrapper.setAttribute(DATA_ATTR.loading, '');
      this.args.wrapper.appendChild(this.skeleton.root);
      this.shownAt = performance.now();
    }, this.args.config.delay);
  }

  public hide(targets: HTMLElement[]): Promise<void> {
    if (this.hiding !== null) {
      return this.hiding;
    }

    if (!this.started || this.destroyed) {
      return Promise.resolve();
    }

    this.started = false;
    this.hiding = this.runHide(targets);

    return this.hiding;
  }

  public destroy(): void {
    this.destroyed = true;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.stopWaiting();
    this.teardown();
  }

  private async runHide(targets: HTMLElement[]): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const skeleton = this.skeleton;

    if (skeleton !== null) {
      const remaining = MIN_VISIBLE - (performance.now() - this.shownAt);

      if (remaining > 0) {
        await this.sleep(remaining);
      }

      if (this.destroyed) {
        return;
      }

      const { content, wrapper } = this.args;

      content.style.opacity = '0';
      wrapper.removeAttribute(DATA_ATTR.loading);

      try {
        // `finished` may never settle in a background tab; a stuck boot is worse than a cut animation.
        await Promise.race([
          runSkeletonHandoff({ bars: skeleton.bars, targets, content }),
          this.sleep(skeleton.bars.length * HANDOFF_STAGGER + HANDOFF_DURATION + HANDOFF_GRACE),
        ]);
      } catch (error) {
        // Render awaits this hide, so a failed animation must not fail the boot.
        logLabeled('The loading skeleton handoff failed', 'warn', error);
      } finally {
        this.stopWaiting();
        // The handoff uses fill: 'forwards', which would pin opacity and filter on the content.
        content.getAnimations?.().forEach(animation => animation.cancel());
        content.style.removeProperty('opacity');
        this.teardown();
      }

      return;
    }

    this.teardown();
  }

  /** Only one hide runs, so one wait slot is enough. destroy() resolves it early so the pending hide() settles. */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.wait = { timer: setTimeout(() => this.stopWaiting(), ms), resolve };
    });
  }

  private stopWaiting(): void {
    if (this.wait === null) {
      return;
    }

    clearTimeout(this.wait.timer);
    this.wait.resolve();
    this.wait = null;
  }

  private teardown(): void {
    this.skeleton?.root.remove();
    this.skeleton = null;
    this.args.wrapper.removeAttribute(DATA_ATTR.loading);
    this.args.wrapper.removeAttribute('aria-busy');
    this.args.content.removeAttribute('inert');
  }
}
