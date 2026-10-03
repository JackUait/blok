import { nanoid } from 'nanoid';
import { mergeUpdates } from 'yjs';

import type { ModuleConfig } from '../../../types-internal/module-config';
import { I18nChanged, SettingChanged } from '../../events';
import type { I18nChangedPayload } from '../../events/I18nChanged';
import type { SettingChangedPayload } from '../../events/SettingChanged';
import { Module } from '../../__module';
import { log } from '../../utils/logger';
import { persistenceVersionAccess } from '../../utils/persistence';

import { resolveTabKey } from './identity';
import type { IdSource } from './identity';
import type { TabMessage } from './messages';
import { browserTabPlatform } from './platform';
import type { LeaderLock, TabActivity, TabChannel, TabPlatform } from './platform';
import { createSettingsChannel } from './settings-channel';
import type { SettingMessage } from './settings-channel';

/**
 * This tab's part in tab sync. Only `solo` and `leader` save.
 */
export type TabRole = 'solo' | 'joining' | 'leader' | 'follower';

export const JOIN_TIMEOUT_MS = 3000;

/** How long a follower stays visible and focused before it claims: debounces focus ping-pong. */
export const CLAIM_SETTLE_MS = 300;

/**
 * A claimant that hears no yield by then steals the lock (a frozen leader).
 * Also how long a tab that yielded waits for the claimant to take the lock.
 */
export const CLAIM_TIMEOUT_MS = 4000;

/** How long a leader asked to yield waits for its save to land. Below CLAIM_TIMEOUT_MS. */
export const YIELD_SAVE_WAIT_MS = 3000;

/** How long a new leader waits for the old leader's last request before its own first save. */
export const TAKEOVER_SETTLE_WAIT_MS = 10_000;

const SAVE_POLL_MS = 50;

interface StartContext { loadedFromPersistence: boolean; isEmpty: boolean }

/** One live connection to the other tabs of this document. */
interface Session { key: string; channel: TabChannel; lock: LeaderLock; recordId: string }

/**
 * Keeps the open tabs of one document in sync over a BroadcastChannel. A Web
 * Lock picks the leader: it answers joining tabs and is the only tab that saves.
 * The leader moves to the tab the user works in: a follower that turns visible
 * and focused claims, the leader saves and yields, the claimant steals the lock.
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

  private unsubscribeSaved: (() => void) | null = null;

  /** Waits for a minted id's save: only a saved id is safe to share. */
  private unsubscribeFirstSave: (() => void) | null = null;

  private hasSaved = false;

  private detachLifecycle: (() => void) | null = null;

  /** Stops the join's wait for in-flight block saves. */
  private cancelSettleWait: (() => void) | null = null;

  private joinTimer: ReturnType<typeof setTimeout> | null = null;

  private queueAbort: AbortController | null = null;

  /** True while a tryAcquire or join runs: the lock takes one acquisition at a time. */
  private entering = false;

  /** Tab updates that arrive while adopt() swaps the document; applied after it. */
  private heldUpdates: Uint8Array[] | null = null;

  /** Any local Yjs change since start. A tab with edits never adopts another document. */
  private editedSinceStart = false;

  /**
   * Any change, local or from another tab, since the leader's last `saved`.
   * A tab that takes over saving saves at once when it is set.
   */
  private dirtySinceSaved = false;

  /** Lets the last typing out after ReadOnly already reports enabled. */
  private flushingBeforeReadOnly = false;

  /**
   * Local updates not posted yet. One operation can write several (a render
   * clears, then fills); posted apart, other tabs see the empty doc in
   * between and each adds its own default block.
   */
  private outbox: Uint8Array[] = [];

  private outboxScheduled = false;

  /** A tab update or diff changed this tab's document. */
  private receivedTabChange = false;

  /** True from the join hello until its answer is taken; one answer per hello. */
  private waitingForState = false;

  /**
   * The leader's `saved` that came after its join answer, while this tab was
   * still adopting. Newer than the answer's version: one sender, in order.
   */
  private savedDuringJoin: { version: string | null } | null = null;

  /** Sender id of the leader this follower last heard from; only its wake hello gets an answer. */
  private leaderId: string | null = null;

  private destroyed = false;

  private activity: TabActivity | null = null;

  private unsubscribeActivity: (() => void) | null = null;

  private unsubscribeLost: (() => void) | null = null;

  /** Activity as last seen: only a change to active arms a claim. */
  private wasActive = false;

  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set while this tab's claim waits for a yield; fires the steal. */
  private claimTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Set between a takeover and the old leader's last request settling; this
   * tab holds the lock but saves nothing until then.
   */
  private awaitingSettle: { from: string; timer: ReturnType<typeof setTimeout> } | null = null;

  /** True while this leader saves before it yields; one hand-over at a time. */
  private yielding = false;

  /** After a yield: leads again if the claimant never takes the lock. */
  private handOverTimer: ReturnType<typeof setTimeout> | null = null;

  /** This tab holds the lock, as leader or as a follower that yielded. */
  private holdsLock = false;

  /** The tab that yielded to this one; its late `saved` carries the version until this tab saves. */
  private takeoverFrom: string | null = null;

  /** The last tab seen yielding; its late `saved` must not make it the leader again. */
  private yieldedBy: string | null = null;

  /** Lives apart from the document session: a failed join must not close it. */
  private settings: { channel: { close(): void }; documentKey: string | undefined } | null = null;

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
    if (this.session !== null || this.destroyed || !this.isAllowed()) {
      return;
    }

    try {
      const key = this.resolveKey(context);

      this.openSettings(key ?? undefined);

      if (key === null) {
        this.waitForFirstSave(context);

        return;
      }

      const channel = this.platform.channel(key);

      if (channel === null) {
        return;
      }

      const lock = this.platform.lock(key);

      if (lock === null) {
        channel.close();

        return;
      }

      this.session = { key, channel, lock, recordId: this.Blok.Saver.getDocumentRecordId() };
      this.stopWaitingForFirstSave();
      // No reset of editedSinceStart: a failed or edited tab must never adopt.
      this.unlisten = channel.onMessage((message) => this.receive(message));
      this.subscribeOutbound();
      this.unsubscribeSaved = persistenceVersionAccess(this.config.persistence)?.onSaved((version) => this.onSaved(version)) ?? null;
      this.Blok.BlockManager.setRemoteOriginLabel('tab');
      this.attachLifecycle();
      this.unsubscribeLost = lock.onLost(() => this.onLockLost());
      this.watchActivity();

      await this.enter();
    } catch (error) {
      log('Tab sync could not start; this tab works on its own.', 'debug', error);
      this.leave();
    }
  }

  /**
   * Catch up after a wake, or rejoin when a solo tab hears a leader.
   */
  public async resync(): Promise<void> {
    if (this.session === null || this.entering) {
      return;
    }

    if (this.currentRole === 'leader') {
      // Followers answer with what this tab missed while frozen.
      this.post({ kind: 'hello', from: this.id, stateVector: this.Blok.YjsManager.getStateVector() });
      // Lets solo tabs find this leader, and followers take its version. Not
      // while dirty: `saved` tells followers their edits are saved.
      if (!this.hasUnsavedWork()) {
        this.postSaved();
      }

      return;
    }

    if (this.currentRole === 'follower') {
      // Asks only for what this tab missed. No reset: its own unsent typing stays.
      this.post({ kind: 'hello', from: this.id, stateVector: this.Blok.YjsManager.getStateVector() });

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

  /**
   * For pagehide. Followers have no close prompt, so their last typing must
   * reach the leader now. A leader also saves what nobody saved yet.
   */
  public flushBeforeUnload(): void {
    if (this.session === null) {
      return;
    }

    // First: buffered typing sets dirtySinceSaved as it lands.
    this.Blok.YjsManager.flushPendingBlockWrites();
    this.postOutbox();
    if (this.currentRole === 'leader' && this.hasUnsavedWork()) {
      this.Blok.ModificationsObserver.flushNow();
    }
  }

  /**
   * The observer half covers an edit made while a save was in flight: that
   * save's `onSaved` clears `dirtySinceSaved` without having saved it.
   */
  private hasUnsavedWork(): boolean {
    return this.dirtySinceSaved || this.Blok.ModificationsObserver.hasUnsavedChanges;
  }

  public destroy(): void {
    // A host unmount fires no pagehide; teardown stops posting.
    this.flushBeforeUnload();
    this.destroyed = true;
    this.stopWaitingForFirstSave();
    this.settings?.channel.close();
    this.settings = null;
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
      this.postTypingBeforeReadOnly();
      this.stopClaim();
      if (this.currentRole === 'leader' || this.currentRole === 'follower') {
        this.cancelQueue(session);
        // Its edit stays unsaved here: it is saved once this tab leads again.
        this.setRole('follower', { keepPendingSave: true });
      }

      return;
    }

    if (this.currentRole === 'follower' && this.queueAbort === null) {
      this.queueForLock(session);
      this.claimIfActive();
    } else if (this.currentRole === 'solo' && !this.entering && !this.editedSinceStart) {
      // A solo tab with edits keeps saving on its own: leading would make the
      // others adopt them, and joining would drop them.
      this.enter().catch((error: unknown) => {
        log('Tab sync could not rejoin; this tab works on its own.', 'debug', error);
        this.leave();
      });
    }
  }

  /**
   * ReadOnly flips its state before it calls modules, so the outbound gate
   * is already shut; typing made while editable must still go out.
   */
  private postTypingBeforeReadOnly(): void {
    this.flushingBeforeReadOnly = true;
    try {
      this.Blok.YjsManager.flushPendingBlockWrites();
    } finally {
      this.flushingBeforeReadOnly = false;
    }
    this.postOutbox();
  }

  /** Off with `tabSync: false` and with `collaboration`, whose server already syncs tabs. */
  private isAllowed(): boolean {
    return this.config.tabSync !== false && this.config.collaboration === undefined;
  }

  /**
   * Opens the settings channel once. Reopens it when a document key turns up
   * later (a minted id after its first save), so width starts to follow.
   * @param documentKey - this tab's document key, if it has one yet
   */
  private openSettings(documentKey: string | undefined): void {
    const { tabSync } = this.config;

    if (typeof tabSync === 'object' && tabSync.settings === false) {
      return;
    }
    if (this.settings !== null && (this.settings.documentKey !== undefined || documentKey === undefined)) {
      return;
    }

    this.settings?.channel.close();
    this.settings = {
      documentKey,
      channel: createSettingsChannel({
        platform: this.platform,
        documentKey,
        on: (listener) => this.onLocalSetting(listener),
        apply: (setting) => this.applySetting(setting),
      }),
    };
  }

  /**
   * @param listener - gets each local locale, theme or width change
   */
  private onLocalSetting(listener: (setting: SettingMessage) => void): () => void {
    // I18nChanged also fires for messages-only and direction-only updates
    // (adapters re-apply their config on mount); only a new locale is sent.
    const seen: { locale: string } = { locale: this.Blok.I18n.getLocale() };
    const onLocale = ({ locale }: I18nChangedPayload): void => {
      if (locale === seen.locale) {
        return;
      }
      seen.locale = locale;
      listener({ setting: 'locale', value: locale });
    };
    const onSetting = (payload: SettingChangedPayload): void => listener(payload);

    this.eventsDispatcher.on(I18nChanged, onLocale);
    this.eventsDispatcher.on(SettingChanged, onSetting);

    return () => {
      this.eventsDispatcher.off(I18nChanged, onLocale);
      this.eventsDispatcher.off(SettingChanged, onSetting);
    };
  }

  /**
   * Theme and width use the plain setters, which never emit SettingChanged.
   * @param setting - a setting another tab changed
   */
  private applySetting(setting: SettingMessage): void {
    switch (setting.setting) {
      case 'locale':
        this.Blok.I18n.update({ locale: setting.value }).catch((error: unknown) => {
          log('Tab sync could not apply a locale from another tab.', 'debug', error);
        });
        break;
      case 'theme':
        this.Blok.ThemeManager.setMode(setting.value);
        break;
      case 'width':
        this.Blok.UI.setWidthMode(setting.value);
        break;
    }
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
      hasSaved: this.hasSaved,
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
   * A minted id joins only once it is saved, so another tab can load it.
   * Stays subscribed until a save opens a session: an empty document stays
   * unshared.
   * @param context - how the document reached this tab
   */
  private waitForFirstSave(context: StartContext): void {
    if (this.unsubscribeFirstSave !== null || this.idSource(context) !== 'minted') {
      return;
    }

    this.unsubscribeFirstSave = persistenceVersionAccess(this.config.persistence)?.onSaved(() => {
      this.hasSaved = true;
      // This tab wrote what it saved; it must lead or stay solo, never adopt.
      this.editedSinceStart = true;
      void this.start({
        loadedFromPersistence: false,
        isEmpty: this.isDocumentEmpty(),
      });
    }) ?? null;
  }

  private isDocumentEmpty(): boolean {
    return this.Blok.BlockManager.blocks.every((block) => block.isEmpty);
  }

  private stopWaitingForFirstSave(): void {
    this.unsubscribeFirstSave?.();
    this.unsubscribeFirstSave = null;
  }

  private attachLifecycle(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const onShow = (event: Event): void => {
      // Only a page back from the back/forward cache: it missed every message.
      if ('persisted' in event && event.persisted === true) {
        void this.resync();
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void this.resync();
      }
    };
    const onHide = (): void => this.flushBeforeUnload();

    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    this.detachLifecycle = () => {
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
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
      if (acquired && this.Blok.ReadOnly.isEnabled) {
        // Went read-only while asking: a read-only leader saves nothing.
        session.lock.release();
      } else if (acquired) {
        this.holdsLock = true;
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
    this.waitingForState = true;
    this.setRole('joining');
    this.post({ kind: 'hello', from: this.id, stateVector: null });
    this.joinTimer = setTimeout(() => {
      this.joinTimer = null;
      if (this.session === session && this.currentRole === 'joining') {
        this.waitingForState = false;
        this.stopSettleWait();
        this.heldUpdates = null;
        this.setRole('solo');
      }
    }, JOIN_TIMEOUT_MS);
  }

  private subscribeOutbound(): void {
    this.unsubscribeOutbound = this.Blok.YjsManager.onDocUpdate((update) => {
      this.editedSinceStart = true;
      this.dirtySinceSaved = true;

      const role = this.currentRole;

      if ((this.flushingBeforeReadOnly || !this.Blok.ReadOnly.isEnabled) && (role === 'leader' || role === 'follower')) {
        this.queueOutbound(update);
      }
    });
  }

  /**
   * Posts on a microtask, merged with the rest of the same task's updates.
   * @param update - a local update
   */
  private queueOutbound(update: Uint8Array): void {
    this.outbox.push(update);
    if (this.outboxScheduled) {
      return;
    }
    this.outboxScheduled = true;
    queueMicrotask(() => this.postOutboxAfterRender());
  }

  /** A local render() spans awaits: its clear and its blocks go out as one update. */
  private postOutboxAfterRender(): void {
    const { pendingRender } = this.Blok.Renderer;

    if (pendingRender !== null) {
      void pendingRender.then(() => this.postOutboxAfterRender());

      return;
    }
    this.postOutbox();
  }

  private postOutbox(): void {
    const updates = this.outbox;

    this.outbox = [];
    this.outboxScheduled = false;
    if (updates.length > 0) {
      this.post({ kind: 'update', from: this.id, update: updates.length === 1 ? updates[0] : mergeUpdates(updates) });
    }
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
        } else if (this.currentRole === 'follower' && message.stateVector !== null && message.from === this.leaderId) {
          // The leader woke up and asks what it missed.
          this.answer(message.from, message.stateVector);
        }

        return;
      case 'state':
        if (message.to !== this.id) {
          return;
        }
        // A diff never reaches the join: the join resets the document.
        if (message.mode === 'full' && this.currentRole === 'joining' && this.waitingForState) {
          void this.onJoinState(message);
        } else if (message.mode === 'diff' && (this.currentRole === 'follower' || this.currentRole === 'leader')) {
          this.onDiffState(message);
        }

        return;
      case 'update':
        this.onUpdate(message.update);

        return;
      case 'saved':
        this.onSavedMessage(message);

        return;
      case 'claim':
        if (this.currentRole === 'leader' && !this.yielding && !this.Blok.ReadOnly.isEnabled) {
          void this.yieldTo(message.from);
        }

        return;
      case 'yield':
        this.onYield(message);

        return;
      case 'settled':
        if (this.awaitingSettle?.from === message.from) {
          this.finishTakeover();
        }

        return;
    }
  }

  /**
   * @param message - another tab's report of a landed save
   */
  private onSavedMessage(message: Extract<TabMessage, { kind: 'saved' }>): void {
    if (this.currentRole === 'follower') {
      // A tab that yielded still reports its last save; it no longer leads.
      if (message.from !== this.yieldedBy) {
        this.leaderId = message.from;
      }
      // A successor then saves with the right If-Match.
      persistenceVersionAccess(this.config.persistence)?.set(message.version);
      this.dirtySinceSaved = false;
      if (this.awaitingSettle?.from === message.from) {
        this.finishTakeover();
      }
    } else if (this.currentRole === 'leader' && message.from === this.takeoverFrom) {
      // The old leader's save landed after it yielded; this tab saves next.
      persistenceVersionAccess(this.config.persistence)?.set(message.version);
    } else if (this.currentRole === 'joining' && !this.waitingForState) {
      this.savedDuringJoin = { version: message.version };
    } else {
      this.rejoinIfClean();
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
      try {
        this.applyTabUpdate(update);
      } catch (error) {
        this.fail('Tab sync could not apply a change from another tab; this tab works on its own.', error);

        return;
      }
      // The leader may close before it saves this; its successor must know.
      this.dirtySinceSaved = true;

      return;
    }
    this.rejoinIfClean();
  }

  /**
   * The leader's answer to this follower's wake hello.
   * @param message - a diff against this tab's state vector
   */
  private onDiffState(message: Extract<TabMessage, { kind: 'state' }>): void {
    // Every follower answers a wake hello, so most diffs are empty and must
    // not mark the leader dirty.
    const changed = { value: false };

    try {
      changed.value = this.applyTabUpdate(message.update);
    } catch (error) {
      this.fail('Tab sync could not catch up with the other tabs; this tab works on its own.', error);

      return;
    }
    // Only from the leader: a follower's version may be stale. A frozen
    // follower missed every `saved` meanwhile.
    if (this.currentRole === 'follower') {
      this.leaderId = message.from;
      persistenceVersionAccess(this.config.persistence)?.set(message.version);
    } else if (changed.value) {
      // The followers' edits in it are unsaved until this leader saves.
      this.dirtySinceSaved = true;
    }
  }

  /**
   * Applies a tab update and, when it changed the document, has the observer
   * save it: a move or an indent emits no BlockChanged, so nothing else would.
   * The observer ignores this in a follower.
   * @param update - a tab update or a diff answer
   * @returns whether the document changed
   */
  private applyTabUpdate(update: Uint8Array): boolean {
    const { YjsManager } = this.Blok;
    // Yjs emits no update for one with nothing new.
    const applied = { changed: false };
    const unsubscribe = YjsManager.onAnyDocUpdate((_update, origin) => {
      applied.changed ||= origin === this.origin;
    });

    try {
      YjsManager.applyRemoteUpdate(update, this.origin);
    } finally {
      unsubscribe();
    }
    if (applied.changed) {
      this.receivedTabChange = true;
      this.Blok.ModificationsObserver.markDirty();
    }

    return applied.changed;
  }

  /**
   * After this tab's own successful save.
   * @param version - the version the store reported
   */
  private onSaved(version: string | null): void {
    this.dirtySinceSaved = false;
    this.takeoverFrom = null;
    // A follower that saves here started that save as leader, before it
    // yielded: the new leader needs this version.
    if (this.currentRole === 'leader' || this.currentRole === 'follower') {
      this.post({ kind: 'saved', from: this.id, version });
    }
  }

  private postSaved(): void {
    this.post({ kind: 'saved', from: this.id, version: persistenceVersionAccess(this.config.persistence)?.get() ?? null });
  }

  /**
   * Leaves for good: a tab that could not apply the shared document must
   * never adopt it again on its own.
   * @param message - what to warn
   * @param error - the cause
   */
  private fail(message: string, error: unknown): void {
    // Known limit: this tab now saves solo next to the new leader; only a
    // versioned store catches the clash.
    log(message, 'warn', error);
    this.leave();
    this.editedSinceStart = true;
  }

  /**
   * A solo tab with no edits of its own rejoins a leader it hears (a leader
   * that was frozen during this tab's join). With edits it stays solo:
   * adopting would drop them.
   */
  private rejoinIfClean(): void {
    if (this.currentRole === 'solo' && !this.entering && !this.editedSinceStart) {
      void this.resync();
    }
  }

  /**
   * @param message - the leader's answer to this tab's hello
   */
  private async onJoinState(message: Extract<TabMessage, { kind: 'state' }>): Promise<void> {
    const session = this.session;

    this.waitingForState = false;
    this.savedDuringJoin = null;
    // Lands typing while still subscribed, so it counts as an edit here
    // instead of vanishing into the Y.Doc the reset throws away. The join
    // timer stays on and bounds this wait.
    await this.landLocalTyping();

    // Timed out or left while waiting.
    if (session === null || this.session !== session || this.currentRole !== 'joining') {
      return;
    }
    this.clearJoinTimer();

    // Open tabs win only over a tab that has not been edited yet.
    if (this.editedSinceStart) {
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
      persistenceVersionAccess(this.config.persistence)?.set((this.savedDuringJoin ?? message).version);
      this.savedDuringJoin = null;
      this.leaderId = message.from;
      this.setRole('follower');
      // Before the held updates: one of them can throw.
      this.queueForLock(session);
      this.flushHeldUpdates();
      this.claimIfActive();
    } catch (error) {
      this.fail('Tab sync could not take the other tab\'s document; this tab works on its own.', error);
    }
  }

  /**
   * Flushes the write buffer, waits for block.save() round trips still in
   * flight (they enqueue into the buffer when they land), then flushes again.
   */
  private async landLocalTyping(): Promise<void> {
    const { YjsManager } = this.Blok;

    YjsManager.flushPendingBlockWrites();
    const settled = await new Promise<boolean>((resolve) => {
      const unsubscribe = YjsManager.onPendingBlockWritesSettled(() => resolve(true));

      // Resolves on cancel too, so onJoinState never hangs on a timed-out wait.
      this.cancelSettleWait = () => {
        unsubscribe();
        resolve(false);
      };
    });

    this.cancelSettleWait = null;
    if (settled) {
      YjsManager.flushPendingBlockWrites();
    }
  }

  private stopSettleWait(): void {
    this.cancelSettleWait?.();
    this.cancelSettleWait = null;
  }

  /**
   * Replaces this tab's document with the leader's.
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
      this.holdsLock = this.session === session;
      // isSameDocument() leaves when the host swapped the document meanwhile.
      if (this.session === session && this.currentRole === 'follower' && this.isSameDocument()) {
        this.promote();
      }
    }, () => {
      // Aborted or released by teardown.
    });
  }

  /**
   * Leads after the lock came to this tab without a yield.
   */
  private promote(): void {
    // Role first: the observer reads it live and saves only as leader. A save
    // that promotion started already covers the changes below.
    const started = this.setRole('leader');

    // The adopted state, a wake diff or a `saved` that came before an edit
    // can all hold changes the old leader never saved. An empty document
    // nobody changed is skipped: it may be a boot doc, not the real one.
    if (started) {
      return;
    }
    if (this.editedSinceStart || this.receivedTabChange || !this.isDocumentEmpty()) {
      this.Blok.ModificationsObserver.flushNow();
    } else {
      // Tells the followers who leads now.
      this.postSaved();
    }
  }

  /**
   * Starts the settle delay when this follower is active now: it just joined
   * or became editable.
   */
  private claimIfActive(): void {
    if (this.activity?.isActive() === true) {
      this.wasActive = true;
      this.armClaim();
    }
  }

  private watchActivity(): void {
    this.activity = this.platform.activity();
    this.wasActive = this.activity?.isActive() ?? false;
    this.unsubscribeActivity = this.activity?.onChange(() => this.onActivityChange()) ?? null;
  }

  private onActivityChange(): void {
    const active = this.activity?.isActive() ?? false;
    const became = active && !this.wasActive;

    this.wasActive = active;
    if (!active) {
      this.clearSettleTimer();
    } else if (became) {
      this.armClaim();
    }
  }

  /** Read-only, solo and joining tabs never claim. */
  private canClaim(): boolean {
    return this.session !== null && this.currentRole === 'follower' && !this.Blok.ReadOnly.isEnabled && this.awaitingSettle === null;
  }

  private armClaim(): void {
    if (!this.canClaim() || this.settleTimer !== null || this.claimTimer !== null) {
      return;
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.claim();
    }, CLAIM_SETTLE_MS);
  }

  private claim(): void {
    if (this.activity?.isActive() !== true) {
      // A blur event may have read focus before it moved.
      this.wasActive = false;

      return;
    }
    if (!this.canClaim() || this.claimTimer !== null) {
      return;
    }
    // The leader must hold all of this tab's typing before it sees the claim:
    // one sender's messages arrive in order.
    this.Blok.YjsManager.flushPendingBlockWrites();
    this.postOutbox();
    this.claimTimer = setTimeout(() => {
      this.claimTimer = null;
      void this.takeOver(null);
    }, CLAIM_TIMEOUT_MS);
    this.post({ kind: 'claim', from: this.id });
  }

  private clearSettleTimer(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private clearClaimTimer(): void {
    if (this.claimTimer !== null) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }
  }

  private stopClaim(): void {
    this.clearSettleTimer();
    this.clearClaimTimer();
  }

  /**
   * @param message - a yield, to this tab or to another
   */
  private onYield(message: Extract<TabMessage, { kind: 'yield' }>): void {
    this.yieldedBy = message.from;
    if (message.to === this.id) {
      if (this.claimTimer !== null && this.canClaim()) {
        this.clearClaimTimer();
        void this.takeOver(message);
      }

      return;
    }
    if (this.currentRole === 'follower') {
      this.leaderId = message.to;
      persistenceVersionAccess(this.config.persistence)?.set(message.version);
    }
    // Another tab won; claim from it instead of stealing from it.
    if (this.claimTimer !== null) {
      this.clearClaimTimer();
      this.claimIfActive();
    }
  }

  /**
   * Takes the lock from the leader.
   * @param message - the leader's yield; null when it never answered
   */
  private async takeOver(message: Extract<TabMessage, { kind: 'yield' }> | null): Promise<void> {
    const session = this.session;

    if (session === null || !this.canClaim()) {
      return;
    }
    // steal() drops this tab's place in line.
    this.queueAbort?.abort();
    this.queueAbort = null;
    try {
      await session.lock.steal();
    } catch (error) {
      log('Tab sync could not take the lock from the other tab.', 'debug', error);
      if (this.session === session && this.currentRole === 'follower') {
        this.queueForLock(session);
      }

      return;
    }
    if (this.session !== session) {
      return;
    }
    this.holdsLock = true;
    if (!this.canClaim()) {
      // Went read-only meanwhile: a read-only leader saves nothing.
      this.holdsLock = false;
      session.lock.release();

      return;
    }
    if (message === null) {
      // The leader never answered; its state is unknown.
      this.promote();

      return;
    }
    persistenceVersionAccess(this.config.persistence)?.set(message.version);
    this.takeoverFrom = message.from;
    this.leaderId = null;
    if (!message.saving) {
      this.finishTakeover();

      return;
    }
    // Saving now would race the old leader's request with a stale If-Match.
    this.awaitingSettle = {
      from: message.from,
      timer: setTimeout(() => this.finishTakeover(), TAKEOVER_SETTLE_WAIT_MS),
    };
  }

  /**
   * Leads, and always saves once: onSave bindings in this tab are stale until
   * it does. A repeat of the old leader's last write is accepted.
   */
  private finishTakeover(): void {
    this.clearAwaitingSettle();
    if (!this.holdsLock || !this.canClaim()) {
      return;
    }
    if (!this.setRole('leader')) {
      this.Blok.ModificationsObserver.flushNow();
    }
  }

  private clearAwaitingSettle(): void {
    if (this.awaitingSettle !== null) {
      clearTimeout(this.awaitingSettle.timer);
      this.awaitingSettle = null;
    }
  }

  /**
   * Saves, posts the version, then hands the lock to the claimant.
   * @param to - the claiming tab
   */
  private async yieldTo(to: string): Promise<void> {
    const session = this.session;

    if (session === null) {
      return;
    }
    this.yielding = true;
    try {
      this.Blok.YjsManager.flushPendingBlockWrites();
      this.postOutbox();

      const saved = await this.saveBeforeYield(session);

      // Read-only or teardown meanwhile: no hand-over; the claimant steals.
      if (this.session !== session || this.currentRole !== 'leader') {
        return;
      }
      // Without persistence no `saved` goes out on its own.
      if (saved) {
        this.postSaved();
      }
      // No yieldedBy = this.id: this tab never hears its own `saved`, and
      // overwriting would forget the tab that yielded before.
      const request = this.abandonSaves();

      this.post({
        kind: 'yield',
        from: this.id,
        to,
        version: persistenceVersionAccess(this.config.persistence)?.get() ?? null,
        saving: request !== null,
      });
      this.leaderId = to;
      if (saved) {
        this.setRole('follower');
      } else {
        // The save may never land: keep the edit, as a read-only demotion does.
        this.setRole('follower', { keepPendingSave: true });
      }
      this.watchHandOver(session);
      // A request that lands posts `saved` through onSaved.
      void request?.then((landed) => {
        if (!landed && this.session === session) {
          this.post({ kind: 'settled', from: this.id, ok: false });
        }
      });
    } finally {
      this.yielding = false;
    }
  }

  /**
   * Saves what the observer holds, again for edits that land meanwhile,
   * within YIELD_SAVE_WAIT_MS.
   * @param session - the live session
   * @returns true when everything landed and nothing waits for a save
   */
  private async saveBeforeYield(session: Session): Promise<boolean> {
    const deadline = Date.now() + YIELD_SAVE_WAIT_MS;
    const { ModificationsObserver } = this.Blok;

    for (;;) {
      // The observer, not dirtySinceSaved: the write buffer lands typing in
      // the document after the save that already read it from the page.
      if (ModificationsObserver.hasPendingSave) {
        ModificationsObserver.flushNow();
      }
      if (!await this.waitForSave(session, deadline)) {
        return false;
      }
      if (!ModificationsObserver.hasPendingSave) {
        return true;
      }
      if (Date.now() >= deadline) {
        return false;
      }
    }
  }

  /**
   * Stops this tab's save queue: a demoted tab must never retry, or it would
   * write with the next leader's version over newer content.
   * @returns the request still out, resolving to whether it landed
   */
  private abandonSaves(): Promise<boolean> | null {
    return persistenceVersionAccess(this.config.persistence)?.abandon() ?? null;
  }

  /**
   * Waits for the serialization and the store save to settle.
   * @param session - the live session
   * @param deadline - when to give up
   * @returns false when the save failed or still runs at the deadline
   */
  private async waitForSave(session: Session, deadline: number): Promise<boolean> {
    const access = persistenceVersionAccess(this.config.persistence);

    for (;;) {
      const state = access?.saveState() ?? 'idle';

      if (!this.Blok.ModificationsObserver.isSaving && state !== 'saving') {
        return state === 'idle';
      }
      if (Date.now() >= deadline || this.session !== session) {
        return false;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, SAVE_POLL_MS);
      });
    }
  }

  /**
   * A claimant that closed or turned read-only never takes the lock. This tab
   * still holds it, so it leads again.
   * @param session - the live session
   */
  private watchHandOver(session: Session): void {
    this.clearHandOverTimer();
    this.handOverTimer = setTimeout(() => {
      this.handOverTimer = null;
      if (this.session === session && this.holdsLock && this.currentRole === 'follower' && !this.Blok.ReadOnly.isEnabled) {
        this.promote();
      }
    }, CLAIM_TIMEOUT_MS);
  }

  private clearHandOverTimer(): void {
    if (this.handOverTimer !== null) {
      clearTimeout(this.handOverTimer);
      this.handOverTimer = null;
    }
  }

  /**
   * Another tab stole the lock: this tab saves nothing more and waits in line.
   */
  private onLockLost(): void {
    const session = this.session;

    this.holdsLock = false;
    this.clearHandOverTimer();
    if (session === null) {
      return;
    }
    this.clearAwaitingSettle();
    if (this.currentRole === 'leader') {
      void this.abandonSaves();
      this.setRole('follower');
    }
    if (this.currentRole === 'follower' && this.queueAbort === null) {
      this.queueForLock(session);
    }
  }

  /**
   * Gives up the lock, held or waited for. The lock object is reusable after.
   * @param session - the live session
   */
  private cancelQueue(session: Session): void {
    this.queueAbort?.abort();
    this.queueAbort = null;
    this.holdsLock = false;
    this.clearHandOverTimer();
    this.clearAwaitingSettle();
    session.lock.release();
  }

  /**
   * False, after leaving, when the host put another document in this editor.
   * A host documentId names the document; the record id may change under it
   * (a render() of data without an id mints one).
   */
  private isSameDocument(): boolean {
    if (this.session === null) {
      return false;
    }
    if (this.config.documentId !== undefined || this.Blok.Saver.getDocumentRecordId() === this.session.recordId) {
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
    this.outbox = [];
    this.outboxScheduled = false;
    this.waitingForState = false;
    this.savedDuringJoin = null;
    this.leaderId = null;
    this.takeoverFrom = null;
    this.yieldedBy = null;
    this.holdsLock = false;
    this.stopClaim();
    this.clearHandOverTimer();
    this.clearAwaitingSettle();
    this.unsubscribeActivity?.();
    this.unsubscribeActivity = null;
    this.activity = null;
    this.unsubscribeLost?.();
    this.unsubscribeLost = null;
    this.stopSettleWait();
    this.unsubscribeOutbound?.();
    this.unsubscribeOutbound = null;
    this.unsubscribeSaved?.();
    this.unsubscribeSaved = null;
    this.unlisten?.();
    this.unlisten = null;
    this.detachLifecycle?.();
    this.detachLifecycle = null;
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
   * @param options - passed on to the observer
   * @param options.keepPendingSave - keep this tab's unsaved edit
   * @returns whether the observer started a save for the new role
   */
  private setRole(role: TabRole, options?: { keepPendingSave: boolean }): boolean {
    if (this.currentRole === role) {
      return false;
    }
    this.currentRole = role;
    if (role !== 'follower') {
      this.stopClaim();
    }
    if (role === 'leader') {
      this.clearHandOverTimer();
    }

    return options === undefined
      ? this.Blok.ModificationsObserver.onRoleChanged(role)
      : this.Blok.ModificationsObserver.onRoleChanged(role, options);
  }
}
