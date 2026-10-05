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
  card: NotifierOptions | null;
}

/**
 * Long enough to catch images on one page that run out of reloads together,
 * so the host is asked once for the whole batch.
 */
export const COALESCE_MS = 300;

/**
 * Keeps track of failed media and tells the user about them: a card per failed
 * image (the notifier stacks them), a toast on save, and a leave guard while uploads are lost.
 */
export class MediaFailures extends Module {
  private readonly entries = new Map<string, Entry>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private holdingLeave = false;
  private saveNotice: NotifierOptions | null = null;
  /**
   * Cards the user should see are on screen only while they are in this editor.
   */
  private readonly onScreen = new Set<NotifierOptions>();
  private presence: { wrapper: HTMLElement; observer: IntersectionObserver | null; onScreen: boolean; focused: boolean } | null = null;
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
    const card = this.liveCard(this.entries.get(input.blockId)?.card ?? null);

    // A failed Retry keeps its card: the card stays where it is in the stack.
    this.entries.set(input.blockId, { ...input, reported: new Set(card === null ? [] : [ 'fail' ]), card });
    if (card !== null && this.onScreen.has(card)) {
      this.Blok.NotifierAPI.settle(card);
    }
    this.watchPresence();
    this.syncLeaveHold();
    this.flushTimer ??= setTimeout(() => this.flushFail(), COALESCE_MS);
  }

  /**
   * Drop the failure recorded for a block, if any.
   * @param blockId - the block
   * @param options - `recovered` when the image now works, so the toast can say so
   */
  public clear(blockId: string, options: { recovered?: boolean } = {}): void {
    const entry = this.entries.get(blockId);

    if (entry === undefined) {
      return;
    }
    this.entries.delete(blockId);
    this.syncLeaveHold();
    if (entry.card !== null) {
      this.closeNotice(entry.card, options.recovered === true);
    }
    if (this.entries.size === 0 && this.saveNotice !== null) {
      this.closeNotice(this.saveNotice, false);
      this.saveNotice = null;
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
   * A failure whose card is still up is left for a later save: the card already tells the user.
   */
  public onSave(): void {
    if (this.isDestroyed || this.Blok.ReadOnly.isEnabled) {
      return;
    }
    const unseen = (entry: Entry): boolean => this.liveCard(entry.card) === null;

    if (this.takeUnreported('save', unseen).length === 0 || this.askHost('save') === false) {
      return;
    }
    if (this.saveNotice !== null) {
      this.closeNotice(this.saveNotice, false);
    }
    this.saveNotice = this.cardOptions(this.summary(), this.detail(), [ ...this.entries.values() ].map((entry) => entry.preview ?? null), {
      retry: () => this.retryAll(),
      show: () => this.showFirst(),
    });
    this.syncToasts();
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
    }, this.Blok.UI.nodes.wrapper);

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
    this.stopWatchingPresence();
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
    if (this.isDestroyed) {
      return;
    }
    const fresh = this.takeUnreported('fail');

    if (fresh.length === 0 || this.askHost('fail') === false) {
      return;
    }
    const i18n = this.Blok.I18n;

    fresh.forEach((entry) => {
      const upload = entry.kind === 'upload';
      const { blockId } = entry;
      const card = this.cardOptions(
        i18n.t(upload ? 'imageFailure.uploadFailed' : 'imageFailure.loadFailed'),
        i18n.t(upload ? 'imageFailure.uploadDetail' : 'imageFailure.loadDetail'),
        [ entry.preview ?? null ],
        {
          // Looked up on click: a repeat failure replaces the entry but keeps this card.
          retry: () => this.entries.get(blockId)?.retry(),
          show: () => this.reveal(blockId),
        }
      );

      this.entries.set(blockId, { ...entry, card });
    });
    this.syncToasts();
  }

  /**
   * Marks entries as reported for `reason`.
   * @param reason - the report reason
   * @param take - which of the new entries to mark
   * @returns the entries that were new for it
   */
  private takeUnreported(reason: Reason, take: (entry: Entry) => boolean = () => true): Entry[] {
    const fresh = [ ...this.entries.values() ].filter((entry) => !entry.reported.has(reason) && take(entry));

    fresh.forEach((entry) => entry.reported.add(reason));

    return fresh;
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
   * @param notice - a card that is going away
   * @param recovered - its image works now, so the card says so before it closes
   */
  private closeNotice(notice: NotifierOptions, recovered: boolean): void {
    if (!this.onScreen.delete(notice)) {
      return;
    }
    if (recovered) {
      this.Blok.NotifierAPI.resolve(notice, this.Blok.I18n.t('imageFailure.restored'));
    } else {
      this.Blok.NotifierAPI.dismiss(notice);
    }
  }

  /**
   * @param card - the card a failure had before it failed again
   * @returns the card, or null when the user already closed it
   */
  private liveCard(card: NotifierOptions | null): NotifierOptions | null {
    if (card === null || (this.onScreen.has(card) && this.Blok.NotifierAPI.isClosed(card))) {
      return null;
    }

    return card;
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

  private cardOptions(message: string, detail: string | undefined, thumbnails: (string | null)[], on: { retry(): void; show(): void }): NotifierOptions {
    return {
      message,
      style: 'error',
      detail,
      thumbnails,
      actions: [
        { label: this.Blok.I18n.t('imageFailure.retry'), onClick: () => on.retry(), primary: true, busyOnClick: true },
        { label: this.Blok.I18n.t('imageFailure.show'), onClick: () => on.show() },
      ],
    };
  }

  /**
   * Cards in the order they failed, then the save toast.
   */
  private notices(): NotifierOptions[] {
    const cards = [ ...this.entries.values() ].flatMap((entry) => (entry.card === null ? [] : [ entry.card ]));

    return this.saveNotice === null ? cards : [ ...cards, this.saveNotice ];
  }

  private forget(notice: NotifierOptions): void {
    if (notice === this.saveNotice) {
      this.saveNotice = null;
    }
    this.entries.forEach((entry, blockId) => {
      if (entry.card === notice) {
        this.entries.set(blockId, { ...entry, card: null });
      }
    });
  }

  /**
   * Put the cards up while the user is in this editor, take them down when they leave.
   * A card the user closed stays closed.
   */
  private syncToasts(): void {
    if (this.isDestroyed) {
      return;
    }
    const present = this.presence === null || this.presence.onScreen || this.presence.focused;

    if (present) {
      this.notices().filter((notice) => !this.onScreen.has(notice)).forEach((notice) => this.put(notice));

      return;
    }
    // Back cards first: taking the front one down first would bring each next one up just to drop it.
    this.notices().filter((notice) => this.onScreen.has(notice)).reverse().forEach((notice) => {
      this.onScreen.delete(notice);
      if (this.Blok.NotifierAPI.isClosed(notice)) {
        this.forget(notice);
      } else {
        this.Blok.NotifierAPI.dismiss(notice);
      }
    });
  }

  private put(notice: NotifierOptions): void {
    // A host notifier may throw; onSave runs inside the save chain and must not reject it.
    try {
      this.Blok.NotifierAPI.show(notice);
      this.onScreen.add(notice);
    } catch (thrown: unknown) {
      this.forget(notice);
      log('The notifier threw while showing an image failure notice.', 'warn', thrown);
    }
  }

  /**
   * "In this editor" means it is on screen or holds focus. Without IntersectionObserver
   * the editor counts as on screen, so the toast still shows.
   */
  private watchPresence(): void {
    const wrapper = this.presence === null && 'UI' in this.Blok ? this.Blok.UI.nodes.wrapper : undefined;

    if (wrapper === undefined || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const presence = { wrapper, observer: null as IntersectionObserver | null, onScreen: false, focused: wrapper.contains(document.activeElement) };

    this.presence = presence;
    document.addEventListener('focusin', this.onFocusIn, true);
    wrapper.addEventListener('focusout', this.onFocusOut);
    presence.observer = new IntersectionObserver((entries) => {
      presence.onScreen = entries[entries.length - 1].isIntersecting;
      this.syncToasts();
    });
    presence.observer.observe(wrapper);
  }

  private stopWatchingPresence(): void {
    const presence = this.presence;

    if (presence === null) {
      return;
    }
    this.presence = null;
    presence.observer?.disconnect();
    document.removeEventListener('focusin', this.onFocusIn, true);
    presence.wrapper.removeEventListener('focusout', this.onFocusOut);
  }

  /**
   * Focus that moves onto the toast itself (Retry, Show) keeps the editor's state.
   * @param event - the focus change, anywhere on the page
   */
  private readonly onFocusIn = (event: FocusEvent): void => {
    const presence = this.presence;
    const target = event.target instanceof Node ? event.target : null;

    if (presence === null || target === null) {
      return;
    }
    if (target instanceof Element && target.closest('[data-blok-testid="notifier-container"]') !== null) {
      return;
    }
    presence.focused = presence.wrapper.contains(target);
    this.syncToasts();
  };

  /**
   * Focus that goes nowhere fires no focusin, so it is caught here.
   * @param event - focus leaving an element in the editor
   */
  private readonly onFocusOut = (event: FocusEvent): void => {
    if (this.presence !== null && event.relatedTarget === null) {
      this.presence.focused = false;
      this.syncToasts();
    }
  };

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
