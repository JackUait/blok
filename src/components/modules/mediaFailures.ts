import type { ImageFailure, ImageFailureReport } from '../../../types';
import type { MediaFailureInput } from '../../../types/api/media';
import type { NotifierOptions } from '../../../types/configs/notifier';
import { BlockRemovedMutationType } from '../../../types/events/block/BlockRemoved';
import type { ModuleConfig } from '../../types-internal/module-config';
import { Module } from '../__module';
import { BlockChanged } from '../events';
import { log } from '../utils';
import { announce } from '../utils/announcer';
import { openLeaveBanner } from '../utils/leave-banner';
import { revealBlock } from '../utils/reveal-block';
import type { LeaveBanner } from '../utils/leave-banner';

type Reason = ImageFailureReport['reason'];

interface Entry extends MediaFailureInput {
  reported: Set<Reason>;
}

/**
 * Long enough to catch images on one page that run out of reloads together.
 */
export const COALESCE_MS = 300;

/**
 * Keeps track of failed media and tells the user about them: a toast when
 * they fail, a toast on save, and a leave guard while uploads are lost.
 */
export class MediaFailures extends Module {
  private readonly entries = new Map<string, Entry>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private holdingLeave = false;
  private shownToast: NotifierOptions | null = null;
  private recoveredSinceToast = 0;
  private leave: { promise: Promise<boolean>; settle(answer: boolean): void; banner: LeaveBanner } | null = null;

  /**
   * One listener per editor: a shared one would let one editor drop another's guard.
   * The browser shows its own "Leave site?" text; a page cannot set the wording.
   * @param event - the unload attempt
   */
  private readonly holdLeave = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };

  /**
   * @param options - module config
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({ config, eventsDispatcher });
    // blocks.clear() and render() skip this event; tools clear from removed() instead.
    this.eventsDispatcher.on(BlockChanged, ({ event }) => {
      if (event.type === BlockRemovedMutationType) {
        this.clear(event.detail.target.id);
      }
    });
  }

  /**
   * Record a failure. Replaces an earlier one for the same block.
   * @param input - what failed
   */
  public report(input: MediaFailureInput): void {
    if (this.isDestroyed) {
      return;
    }
    this.entries.set(input.blockId, { ...input, reported: new Set() });
    this.syncLeaveHold();
    this.flushTimer ??= setTimeout(() => this.flushFail(), COALESCE_MS);
  }

  /**
   * Drop the failure recorded for a block, if any.
   * @param blockId - the block
   * @param options - `recovered` when the image now works, so the toast can say so
   */
  public clear(blockId: string, options: { recovered?: boolean } = {}): void {
    if (!this.entries.delete(blockId)) {
      return;
    }
    this.syncLeaveHold();
    if (options.recovered === true) {
      this.recoveredSinceToast += 1;
    }
    if (this.entries.size === 0 && this.shownToast !== null) {
      this.closeToast(options.recovered === true);
    }
    if (this.leave === null) {
      return;
    }
    if (this.entries.size === 0) {
      this.settleLeave(true);
    } else {
      this.leave.banner.update(this.summary());
    }
  }

  /**
   * @returns every current failure, in the order they were reported
   */
  public list(): ImageFailure[] {
    return [ ...this.entries.values() ].map((entry) => this.toPublic(entry));
  }

  /**
   * Called after each real save. Toasts failures not yet reported on save.
   */
  public onSave(): void {
    if (this.isDestroyed || this.Blok.ReadOnly.isEnabled || !this.takeUnreported('save')) {
      return;
    }
    this.notify('save', this.summary());
  }

  /**
   * Ask before an in-app navigation.
   * @returns true to leave, false to stay
   */
  public confirmLeave(): Promise<boolean> {
    if (this.leave !== null) {
      return this.leave.promise;
    }
    if (this.isDestroyed || this.Blok.ReadOnly.isEnabled || this.entries.size === 0 || this.askHost('leave') === false) {
      return Promise.resolve(true);
    }

    const i18n = this.Blok.I18n;
    const answer: { resolve: (value: boolean) => void } = { resolve: () => undefined };
    const promise = new Promise<boolean>((resolve) => {
      answer.resolve = resolve;
    });
    const banner = openLeaveBanner(this.summary(), {
      title: i18n.t('imageFailure.bannerTitle'),
      retry: i18n.t('imageFailure.retry'),
      show: i18n.t('imageFailure.show'),
      stay: i18n.t('imageFailure.stay'),
      leave: i18n.t('imageFailure.leaveAnyway'),
    }, {
      onRetry: () => this.retryAll(),
      onShow: () => {
        this.settleLeave(false);
        this.showFirst();
      },
      onStay: () => this.settleLeave(false),
      onLeave: () => this.settleLeave(true),
    });

    this.leave = { promise, settle: answer.resolve, banner };

    return promise;
  }

  /**
   * Release timers and the unload listener.
   */
  public destroy(): void {
    this.settleLeave(true);
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.entries.clear();
    this.syncLeaveHold();
  }

  private settleLeave(answer: boolean): void {
    const leave = this.leave;

    if (leave === null) {
      return;
    }
    this.leave = null;
    leave.banner.close();
    leave.settle(answer);
  }

  private flushFail(): void {
    this.flushTimer = null;
    if (this.isDestroyed || !this.takeUnreported('fail')) {
      return;
    }
    const all = [ ...this.entries.values() ];
    const [ only ] = all;
    const single = only.kind === 'upload' ? 'imageFailure.uploadFailed' : 'imageFailure.loadFailed';
    const message = all.length === 1
      ? this.Blok.I18n.t(single)
      : this.Blok.I18n.t('imageFailure.failedMany', { count: all.length });

    this.notify('fail', message);
  }

  /**
   * Marks every entry as reported for `reason`.
   * @param reason - the report reason
   * @returns true when at least one entry was new for it
   */
  private takeUnreported(reason: Reason): boolean {
    const fresh = [ ...this.entries.values() ].filter((entry) => !entry.reported.has(reason));

    fresh.forEach((entry) => entry.reported.add(reason));

    return fresh.length > 0;
  }

  /**
   * "Won't be saved: n · Won't display: m", with zero parts left out.
   */
  private summary(): string {
    const all = [ ...this.entries.values() ];
    const lost = all.filter((entry) => entry.kind === 'upload').length;
    const broken = all.length - lost;
    const parts: string[] = [];

    if (lost > 0) {
      parts.push(this.Blok.I18n.t('imageFailure.notSaved', { count: lost }));
    }
    if (broken > 0) {
      parts.push(this.Blok.I18n.t('imageFailure.notDisplayed', { count: broken }));
    }

    return parts.join(' · ');
  }

  /**
   * @param recovered - the last failure went away because the image now works
   */
  private closeToast(recovered: boolean): void {
    const toast = this.shownToast;

    if (toast === null) {
      return;
    }
    this.shownToast = null;
    if (!recovered) {
      this.Blok.NotifierAPI.dismiss(toast);

      return;
    }
    const message = this.recoveredSinceToast > 1
      ? this.Blok.I18n.t('imageFailure.restoredMany', { count: this.recoveredSinceToast })
      : this.Blok.I18n.t('imageFailure.restored');

    this.Blok.NotifierAPI.resolve(toast, message);
  }

  /**
   * The shared reason line, or undefined when failures differ in kind.
   */
  private detail(): string | undefined {
    const kinds = new Set([ ...this.entries.values() ].map((entry) => entry.kind));

    if (kinds.size !== 1) {
      return undefined;
    }

    return this.Blok.I18n.t(kinds.has('upload') ? 'imageFailure.uploadDetail' : 'imageFailure.loadDetail');
  }

  private notify(reason: Reason, message: string): void {
    if (this.askHost(reason) === false) {
      return;
    }
    // A host notifier may throw; onSave runs inside the save chain and must not reject it.
    const options: NotifierOptions = {
      message,
      style: 'error',
      detail: this.detail(),
      thumbnails: [ ...this.entries.values() ].map((entry) => entry.preview ?? null),
      actions: [
        { label: this.Blok.I18n.t('imageFailure.retry'), onClick: () => this.retryAll(), primary: true, busyOnClick: true },
        { label: this.Blok.I18n.t('imageFailure.show'), onClick: () => this.showFirst() },
      ],
    };

    try {
      this.Blok.NotifierAPI.show(options);
      this.shownToast = options;
      this.recoveredSinceToast = 0;
    } catch (thrown: unknown) {
      log('The notifier threw while showing an image failure notice.', 'warn', thrown);
    }
  }

  /**
   * @param reason - why the host is asked
   * @returns the host's answer, or undefined when it threw
   */
  private askHost(reason: Reason): boolean | void {
    const handler = this.config.onImageFailure;

    if (handler === undefined) {
      return undefined;
    }
    try {
      return handler({ reason, failures: this.list() });
    } catch (thrown: unknown) {
      log('`onImageFailure` threw. Blok showed its own notice instead.', 'warn', thrown);

      return undefined;
    }
  }

  private retryAll(): void {
    [ ...this.entries.values() ].forEach((entry) => entry.retry());
  }

  private showFirst(): void {
    const first = this.entries.keys().next();

    if (first.done !== true) {
      this.reveal(first.value);
    }
  }

  /**
   * Centre the failed block and spotlight it once it is in view. Unlike
   * scrollToBlock, it does not select the block: a selection tint does not show on an error card.
   * @param blockId - the failed block
   */
  private reveal(blockId: string): void {
    const block = this.Blok.BlockManager.getBlockById(blockId);

    if (block === undefined) {
      return;
    }
    revealBlock(block.holder, block.pluginsContent);
    announce(this.Blok.I18n.t('a11y.navigatedToBlock'));
  }

  private toPublic(entry: Entry): ImageFailure {
    return {
      blockId: entry.blockId,
      tool: entry.tool,
      kind: entry.kind,
      url: entry.url,
      retry: () => entry.retry(),
      scrollTo: () => this.reveal(entry.blockId),
    };
  }

  private syncLeaveHold(): void {
    // `this.Blok` is still empty while modules are being constructed.
    const readOnly = 'ReadOnly' in this.Blok && this.Blok.ReadOnly.isEnabled;
    const should = !this.isDestroyed && !readOnly && [ ...this.entries.values() ].some((entry) => entry.kind === 'upload');

    if (should === this.holdingLeave) {
      return;
    }
    this.holdingLeave = should;
    if (should) {
      window.addEventListener('beforeunload', this.holdLeave);
    } else {
      window.removeEventListener('beforeunload', this.holdLeave);
    }
  }
}
