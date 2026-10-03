import { nanoid } from 'nanoid';

import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import { log } from '../../utils/logger';
import { persistenceVersionAccess } from '../../utils/persistence';

import { resolveTabKey } from './identity';
import type { IdSource } from './identity';
import type { TabMessage } from './messages';
import { browserTabPlatform } from './platform';
import type { LeaderLock, TabChannel, TabPlatform } from './platform';

/**
 * This tab's part in tab sync. Only `solo` and `leader` save.
 */
export type TabRole = 'solo' | 'joining' | 'leader' | 'follower';

export const JOIN_TIMEOUT_MS = 3000;

interface StartContext { loadedFromPersistence: boolean; isEmpty: boolean }

/** One live connection to the other tabs of this document. */
interface Session { key: string; channel: TabChannel; lock: LeaderLock; recordId: string }

/**
 * Keeps the open tabs of one document in sync over a BroadcastChannel. A Web
 * Lock picks the leader: it answers joining tabs and is the only tab that saves.
 */
export class TabSync extends Module {
  /** Sender id on the channel; a `state` answer is addressed to it. */
  private readonly id = nanoid();

  /**
   * ONE object for the module's life: the document store keeps primitive
   * origins forever, and echo suppression matches this exact object.
   */
  private readonly origin = { tabSync: true };

  private currentRole: TabRole = 'solo';

  private platform: TabPlatform = browserTabPlatform;

  private session: Session | null = null;

  private unlisten: (() => void) | null = null;

  private unsubscribeOutbound: (() => void) | null = null;

  private joinTimer: ReturnType<typeof setTimeout> | null = null;

  private queueAbort: AbortController | null = null;

  /** True while a tryAcquire or join runs: the lock takes one acquisition at a time. */
  private entering = false;

  /** Tab updates that arrive while adopt() swaps the document; applied after it. */
  private heldUpdates: Uint8Array[] | null = null;

  /** Any local Yjs change since start. A tab with edits never adopts another document. */
  private editedSinceStart = false;

  /** True once this tab adopted a leader's document. Task 14 resyncs those by diff. */
  private joined = false;

  private destroyed = false;

  /**
   * @param options - module options
   * @param options.config - Blok configuration
   * @param options.eventsDispatcher - common event bus
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({ config, eventsDispatcher });
  }

  public get role(): TabRole {
    return this.currentRole;
  }

  /**
   * Test seam: the platform used by start(). Defaults to browserTabPlatform.
   * @param platform - channel and lock factory
   */
  public setPlatform(platform: TabPlatform): void {
    this.platform = platform;
  }

  /**
   * Called by Core after the first render. Never throws; any failure leaves role 'solo'.
   * @param context - how the document reached this tab
   */
  public async start(context: StartContext): Promise<void> {
    if (this.session !== null || !this.isAllowed()) {
      return;
    }

    try {
      const key = this.resolveKey(context);
      const channel = key === null ? null : this.platform.channel(key);

      if (key === null || channel === null) {
        return;
      }

      const lock = this.platform.lock(key);

      if (lock === null) {
        channel.close();

        return;
      }

      this.session = { key, channel, lock, recordId: this.Blok.Saver.getDocumentRecordId() };
      this.editedSinceStart = false;
      this.unlisten = channel.onMessage((message) => this.receive(message));
      this.subscribeOutbound();
      this.Blok.BlockManager.setRemoteOriginLabel('tab');

      await this.enter();
    } catch (error) {
      log('Tab sync could not start; this tab works on its own.', 'debug', error);
      this.leave();
    }
  }

  /**
   * Re-run the join handshake (wake, or a solo tab that heard a leader).
   */
  public async resync(): Promise<void> {
    if (this.session === null || this.entering) {
      return;
    }

    // Task 14: a tab that already joined catches up by diff instead.
    if (this.joined) {
      return;
    }

    // Adopting would drop this tab's own edits.
    if (this.currentRole !== 'solo' || this.editedSinceStart) {
      return;
    }

    try {
      await this.enter();
    } catch (error) {
      log('Tab sync could not rejoin; this tab works on its own.', 'debug', error);
      this.leave();
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.teardown();
    this.setRole('solo');
  }

  /**
   * Called by the ReadOnly module on every read-only change. A read-only tab
   * never leads: it would save nothing for the editable tabs.
   * @param readOnly - the new read-only state
   */
  public toggleReadOnly(readOnly: boolean): void {
    const session = this.session;

    if (session === null) {
      return;
    }

    if (readOnly) {
      if (this.currentRole === 'leader' || this.currentRole === 'follower') {
        this.cancelQueue(session);
        this.setRole('follower');
      }

      return;
    }

    if (this.currentRole === 'follower' && this.queueAbort === null) {
      this.queueForLock(session);
    } else if (this.currentRole === 'solo' && !this.entering) {
      // Lead if nobody does; otherwise join, which keeps a tab with edits solo.
      this.enter().catch((error: unknown) => {
        log('Tab sync could not rejoin; this tab works on its own.', 'debug', error);
        this.leave();
      });
    }
  }

  /** Off with `tabSync: false` and with `collaboration`, whose server already syncs tabs. */
  private isAllowed(): boolean {
    return this.config.tabSync !== false && this.config.collaboration === undefined;
  }

  /**
   * @param context - how the document reached this tab
   */
  private resolveKey(context: StartContext): string | null {
    // Read first: the Saver mints an id lazily on the first read.
    const recordId = this.Blok.Saver.getDocumentRecordId();

    return resolveTabKey({
      documentId: this.config.documentId,
      recordId,
      idSource: this.idSource(context),
      // Task 15 restarts a minted-id tab after its first save.
      hasSaved: false,
      isEmpty: context.isEmpty,
      pathname: typeof location === 'undefined' ? '' : location.pathname,
    });
  }

  /**
   * @param context - how the document reached this tab
   */
  private idSource(context: StartContext): IdSource {
    if (this.config.documentId !== undefined) {
      return 'host';
    }
    if (this.Blok.Saver.hasMintedDocumentId()) {
      return 'minted';
    }

    return context.loadedFromPersistence ? 'persistence' : 'data';
  }

  /**
   * Lead when the lock is free, otherwise ask the leader for its document.
   * Read-only tabs never lead: a read-only leader saves nothing for the others.
   */
  private async enter(): Promise<void> {
    const session = this.session;

    if (session === null) {
      return;
    }

    this.entering = true;
    try {
      const acquired = !this.Blok.ReadOnly.isEnabled && await session.lock.tryAcquire();

      // destroy() or leave() may have run while tryAcquire was pending.
      if (this.session !== session) {
        return;
      }
      if (acquired) {
        this.setRole('leader');

        return;
      }
      this.join(session);
    } finally {
      this.entering = false;
    }
  }

  /**
   * @param session - the live session
   */
  private join(session: Session): void {
    // Held from the hello on: the leader may answer before it sees another
    // follower's edit, and that edit is never sent again.
    this.heldUpdates = [];
    this.setRole('joining');
    this.post({ kind: 'hello', from: this.id, stateVector: null });
    this.joinTimer = setTimeout(() => {
      this.joinTimer = null;
      if (this.session === session && this.currentRole === 'joining') {
        this.heldUpdates = null;
        this.setRole('solo');
      }
    }, JOIN_TIMEOUT_MS);
  }

  /**
   * Posting only; Task 14 adds the dirty-since-saved bookkeeping.
   */
  private subscribeOutbound(): void {
    this.unsubscribeOutbound = this.Blok.YjsManager.onDocUpdate((update) => {
      this.editedSinceStart = true;

      const role = this.currentRole;

      if (!this.Blok.ReadOnly.isEnabled && (role === 'leader' || role === 'follower')) {
        this.post({ kind: 'update', from: this.id, update });
      }
    });
  }

  /**
   * @param message - a decoded message from another tab
   */
  private receive(message: TabMessage): void {
    if (!this.isSameDocument()) {
      return;
    }

    switch (message.kind) {
      case 'hello':
        if (this.currentRole === 'leader') {
          this.answer(message.from, message.stateVector);
        }

        return;
      case 'state':
        if (message.to === this.id && this.currentRole === 'joining') {
          void this.onJoinState(message);
        }

        return;
      case 'update':
        this.onUpdate(message.update);

        return;
      case 'saved':
        // Task 14: a follower takes the saved version.
        this.rejoinIfClean();

        return;
    }
  }

  /**
   * @param to - the joining tab
   * @param stateVector - what it already has; null asks for everything
   */
  private answer(to: string, stateVector: Uint8Array | null): void {
    const { Saver, YjsManager } = this.Blok;

    // Typing still in the write buffer must be part of the answer.
    YjsManager.flushPendingBlockWrites();

    const update = stateVector === null ? YjsManager.encodeStateAsUpdate() : YjsManager.encodeStateAsUpdate(stateVector);

    this.post({
      kind: 'state',
      from: this.id,
      to,
      mode: stateVector === null ? 'full' : 'diff',
      recordId: Saver.getDocumentRecordId(),
      update,
      version: persistenceVersionAccess(this.config.persistence)?.get() ?? null,
    });
  }

  /**
   * @param update - a tab update
   */
  private onUpdate(update: Uint8Array): void {
    if (this.heldUpdates !== null) {
      this.heldUpdates.push(update);

      return;
    }
    if (this.currentRole === 'leader' || this.currentRole === 'follower') {
      this.Blok.YjsManager.applyRemoteUpdate(update, this.origin);

      return;
    }
    this.rejoinIfClean();
  }

  /**
   * A solo tab with no edits of its own rejoins a leader it hears (a leader
   * that was frozen during this tab's join). With edits it stays solo:
   * adopting would drop them.
   */
  private rejoinIfClean(): void {
    if (this.currentRole === 'solo' && !this.entering && !this.editedSinceStart && !this.joined) {
      void this.resync();
    }
  }

  /**
   * @param message - the leader's answer to this tab's hello
   */
  private async onJoinState(message: Extract<TabMessage, { kind: 'state' }>): Promise<void> {
    const session = this.session;

    this.clearJoinTimer();
    // Lands buffered typing while still subscribed, so it counts as an edit
    // here instead of vanishing into the Y.Doc the reset throws away.
    this.Blok.YjsManager.flushPendingBlockWrites();

    // Open tabs win only over a tab that has not been edited yet.
    if (session === null || this.editedSinceStart) {
      this.heldUpdates = null;
      this.setRole('solo');

      return;
    }

    try {
      await this.adopt(message.update);
      if (this.session !== session) {
        return;
      }
      this.Blok.Saver.adoptDocumentRecordId(message.recordId);
      session.recordId = message.recordId;
      persistenceVersionAccess(this.config.persistence)?.set(message.version);
      this.joined = true;
      this.setRole('follower');
      // Before the held updates: one of them can throw.
      this.queueForLock(session);
      this.flushHeldUpdates();
    } catch (error) {
      log('Tab sync could not take the other tab\'s document; this tab works on its own.', 'warn', error);
      this.leave();
      this.editedSinceStart = true;
    }
  }

  /**
   * Replaces this tab's document with the leader's. Task 14 extends it.
   * @param update - the leader's full state
   */
  private async adopt(update: Uint8Array): Promise<void> {
    const { BlockManager, ModificationsObserver, YjsManager } = this.Blok;

    // onJoinState already flushed the write buffer; unsubscribing keeps the
    // reset's own bookkeeping from counting as a local edit.
    this.unsubscribeOutbound?.();
    this.unsubscribeOutbound = null;
    ModificationsObserver.disable();
    try {
      // Same order as Collaboration.resetForRelineage: clear the DOM without
      // touching the document, swap to a fresh Y.Doc, then let the leader's
      // state materialise through the ordinary remote path.
      await BlockManager.clear(false, { skipYjsSync: true });
      // Left or destroyed during the clear: the document is no longer ours to swap.
      if (this.session === null) {
        return;
      }
      YjsManager.resetForRelineage();
      YjsManager.applyRemoteUpdate(update, this.origin);
    } finally {
      ModificationsObserver.discardPendingChanges();
      // After destroy the observer is torn down too; enabling would re-attach it.
      if (!this.destroyed) {
        ModificationsObserver.enable();
      }
      if (this.session !== null) {
        this.subscribeOutbound();
      }
    }
  }

  private flushHeldUpdates(): void {
    const held = this.heldUpdates ?? [];

    this.heldUpdates = null;
    held.forEach((update) => this.onUpdate(update));
  }

  /**
   * Waits for the leader to go. Never right after a failed tryAcquire: the
   * real lock stays busy for a moment after it answers false.
   * @param session - the live session
   */
  private queueForLock(session: Session): void {
    if (this.Blok.ReadOnly.isEnabled) {
      return;
    }

    const abort = new AbortController();

    this.queueAbort = abort;
    session.lock.queue(abort.signal).then(() => {
      if (this.queueAbort === abort) {
        this.queueAbort = null;
      }
      // isSameDocument() leaves when the host swapped the document meanwhile.
      if (this.session === session && this.currentRole === 'follower' && this.isSameDocument()) {
        this.setRole('leader');
      }
    }, () => {
      // Aborted or released by teardown.
    });
  }

  /**
   * Gives up the lock, held or waited for. The lock object is reusable after.
   * @param session - the live session
   */
  private cancelQueue(session: Session): void {
    this.queueAbort?.abort();
    this.queueAbort = null;
    session.lock.release();
  }

  /**
   * False, after leaving, when the host put another document in this editor.
   */
  private isSameDocument(): boolean {
    if (this.session === null) {
      return false;
    }
    if (this.Blok.Saver.getDocumentRecordId() === this.session.recordId) {
      return true;
    }
    this.leave();

    return false;
  }

  /**
   * @param message - what to send to the other tabs
   */
  private post(message: TabMessage): void {
    if (this.isSameDocument()) {
      this.session?.channel.post(message);
    }
  }

  /** Ends the session; this tab works on its own. */
  private leave(): void {
    this.teardown();
    this.setRole('solo');
  }

  private teardown(): void {
    const session = this.session;

    this.session = null;
    this.clearJoinTimer();
    this.queueAbort?.abort();
    this.queueAbort = null;
    this.heldUpdates = null;
    this.unsubscribeOutbound?.();
    this.unsubscribeOutbound = null;
    this.unlisten?.();
    this.unlisten = null;
    session?.lock.release();
    session?.channel.close();
    if (session !== null) {
      this.Blok.BlockManager.setRemoteOriginLabel('remote');
    }
  }

  private clearJoinTimer(): void {
    if (this.joinTimer !== null) {
      clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
  }

  /**
   * Sets the field BEFORE telling the observer, which reads it live.
   * @param role - the new role
   */
  private setRole(role: TabRole): void {
    if (this.currentRole === role) {
      return;
    }
    this.currentRole = role;
    this.Blok.ModificationsObserver.onRoleChanged(role);
  }
}
