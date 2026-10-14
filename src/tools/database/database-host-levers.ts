import type { RowWriteObserver } from './database-backend-sync';
import type {
  DatabaseAI,
  DatabaseAutomationAction,
  DatabaseAutomationContext,
  DatabaseAutomations,
  DatabaseAutomationTrigger,
  DatabaseSavedAutomations,
  PropertyDefinition,
  PropertyValue,
} from './types';

/** What the levers need from the tool. */
export interface HostLeverTarget {
  databaseId: string;
  isDestroyed(): boolean;
  canTriggerAutomations?(): boolean;
  savedAutomations?(): DatabaseSavedAutomations | undefined;
  schema(): PropertyDefinition[];
  /** The row's stored values, or undefined once the row is gone. */
  rowValues(rowId: string): Record<string, PropertyValue> | undefined;
  /** A host value: saved, but not an undo step. False when the row is gone or writes are refused. */
  writeHostValues(rowId: string, changes: Record<string, PropertyValue>): boolean;
  addRow(properties: Record<string, PropertyValue>): boolean;
  matchesView(rowId: string, viewId: string): boolean;
  /** A fill of this cell started or ended: its "Thinking…" shows or goes. */
  fillingChanged?(rowId: string, propertyId: string): void;
}

/** Autofill on edit waits for typing to settle, as the adapter sync does. */
const AUTOFILL_EDIT_DELAY_MS = 500;

// The ALL window uses edit time, not settlement time.
const SAVED_ALL_WINDOW_MS = 3000;

/**
 * Automations and AI autofill. Both start from the tool's local row writes
 * (the backend sync's call sites), so a peer, undo or redo starts nothing.
 */
export class DatabaseHostLevers implements RowWriteObserver {
  /** Above zero while a lever writes: those writes start nothing (Notion: automations never chain). */
  private quiet = 0;
  private pageAddedSuppressedFor: string | undefined;
  private readonly editTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per row and property: typing fires one trigger once it settles, with the last value. */
  private readonly triggerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly savedMatches = new Map<string, Map<string, number>>();
  /** Fills in flight per row and property. */
  private readonly filling = new Map<string, number>();
  /** Per row and property: the latest fill. An older one's answer is dropped. */
  private readonly latestFill = new Map<string, number>();
  private fillSeq = 0;

  constructor(
    private readonly target: HostLeverTarget,
    private readonly automations: DatabaseAutomations | undefined,
    private readonly ai: DatabaseAI | undefined
  ) {}

  created(params: { id: string; properties: Record<string, PropertyValue> }): void {
    if (this.quiet > 0) return;
    if (params.id !== this.pageAddedSuppressedFor) this.fire({ type: 'pageAdded', rowId: params.id, properties: params.properties });
    const fill = this.target.schema().filter((property) => property.autofill?.onCreate === true);

    // The tool reads the new row back from its block after this call returns.
    if (this.ai !== undefined && fill.length > 0) {
      queueMicrotask(() => fill.forEach((property) => this.autofill(params.id, property)));
    }
  }

  updated(params: { rowId: string; properties: Record<string, PropertyValue> }): void {
    if (this.quiet > 0) return;
    const changed = Object.keys(params.properties);

    changed.forEach((propertyId) => this.fireSettled({
      type: 'propertyEdited',
      rowId: params.rowId,
      propertyId,
      value: params.properties[propertyId],
    }));
    this.target.schema()
      .filter((property) => property.autofill?.onEdit === true && !changed.includes(property.id)
        && (property.autofill.onEditProperties === undefined || changed.some((id) => property.autofill?.onEditProperties?.includes(id) === true)))
      .forEach((property) => this.autofillSoon(params.rowId, property.id));
  }

  /** A local edit of the row's page body (never a peer, undo or redo: the tool checks). */
  bodyEdited(rowId: string): void {
    if (this.quiet > 0) return;
    this.target.schema()
      .filter((property) => property.autofill?.onEditContent === true)
      .forEach((property) => this.autofillSoon(rowId, property.id));
  }

  /** "Run now": fills each row, with `settings` in place of the saved ones when given. */
  autofillRows(property: PropertyDefinition, rowIds: string[], settings = property.autofill): void {
    rowIds.forEach((rowId) => this.autofill(rowId, property, settings));
  }

  /** The cell's "Autofill" button: one row, the saved settings. */
  autofillCell(rowId: string, property: PropertyDefinition): void {
    this.autofill(rowId, property);
  }

  isFilling(rowId: string, propertyId: string): boolean {
    return this.filling.has(`${rowId}\u0000${propertyId}`);
  }

  withoutPageAdded<T>(rowId: string, write: () => T): T {
    const previous = this.pageAddedSuppressedFor;

    this.pageAddedSuppressedFor = rowId;
    try {
      return write();
    } finally {
      this.pageAddedSuppressedFor = previous;
    }
  }

  destroy(): void {
    this.editTimers.forEach((timer) => clearTimeout(timer));
    this.editTimers.clear();
    this.triggerTimers.forEach((timer) => clearTimeout(timer));
    this.triggerTimers.clear();
    this.savedMatches.clear();
    this.filling.clear();
    this.latestFill.clear();
  }

  private fireSettled(trigger: Extract<DatabaseAutomationTrigger, { type: 'propertyEdited' }>): void {
    const key = `${trigger.rowId}\u0000${trigger.propertyId}`;
    const occurredAt = Date.now();

    clearTimeout(this.triggerTimers.get(key));
    this.triggerTimers.delete(key);
    if (this.automations === undefined && this.target.savedAutomations?.() === undefined) return;
    if (this.target.canTriggerAutomations?.() === false) return;
    this.triggerTimers.set(key, setTimeout(() => {
      this.triggerTimers.delete(key);
      this.fire(trigger, occurredAt);
    }, AUTOFILL_EDIT_DELAY_MS));
  }

  private quietly<T>(write: () => T): T {
    this.quiet += 1;
    try {
      return write();
    } finally {
      this.quiet -= 1;
    }
  }

  private fire(trigger: DatabaseAutomationTrigger, occurredAt = Date.now()): void {
    const hook = this.automations;

    if ((hook === undefined && this.target.savedAutomations?.() === undefined)
      || this.target.canTriggerAutomations?.() === false) return;
    // After the write that fired it, so the host reads the new state and its own writes never nest in ours.
    queueMicrotask(() => {
      if (this.target.isDestroyed() || this.target.canTriggerAutomations?.() === false) return;
      try {
        this.fireSaved(trigger, occurredAt);
      } catch {
        // A failing automation must not break the edit that fired it.
      }
      if (hook === undefined) return;
      try {
        void Promise.resolve(hook.onTrigger(trigger, this.context())).catch(() => undefined);
      } catch {
        // A failing automation must not break the edit that fired it.
      }
    });
  }

  private fireSaved(trigger: DatabaseAutomationTrigger, occurredAt: number): void {
    const saved = this.target.savedAutomations?.();

    if (saved?.version !== 1 || this.target.rowValues(trigger.rowId) === undefined) return;
    saved.definitions.forEach((definition) => {
      if (definition.status !== 'active') return;
      const matches = definition.triggers.filter((rule) => rule.type === 'pageAdded'
        ? trigger.type === 'pageAdded'
        : trigger.type === 'propertyEdited' && rule.propertyId === trigger.propertyId);

      if (matches.length === 0) return;
      const key = `${definition.id}\u0000${trigger.rowId}`;

      if (definition.scope.type === 'view' && !this.target.matchesView(trigger.rowId, definition.scope.viewId)) {
        this.savedMatches.delete(key);
        return;
      }
      if (definition.triggerMode === 'all') {
        const timestamps = this.savedMatches.get(key) ?? new Map<string, number>();

        this.savedMatches.set(key, timestamps);
        timestamps.forEach((at, id) => {
          if (occurredAt - at > SAVED_ALL_WINDOW_MS) timestamps.delete(id);
        });
        matches.forEach((rule) => timestamps.set(rule.id, occurredAt));
        if (!definition.triggers.every((rule) => timestamps.has(rule.id))) return;
        this.savedMatches.delete(key);
      }
      this.quietly(() => {
        definition.actions.forEach((action) => {
          if (action.type !== 'editProperty' || action.target !== 'triggerRow') return;
          this.run({
            type: 'editProperty',
            rowId: trigger.rowId,
            propertyId: action.propertyId,
            value: action.value,
          });
        });
      });
    });
  }

  private context(): DatabaseAutomationContext {
    return {
      databaseId: this.target.databaseId,
      matchesView: (rowId, viewId) => this.target.matchesView(rowId, viewId),
      run: (action) => (this.target.isDestroyed() ? false : this.quietly(() => this.run(action))),
    };
  }

  private run(action: DatabaseAutomationAction): boolean {
    switch (action.type) {
      case 'editProperty':
        return this.target.writeHostValues(action.rowId, { [action.propertyId]: action.value });
      case 'editPages':
        return action.rowIds.map((rowId) => this.target.writeHostValues(rowId, { [action.propertyId]: action.value })).every(Boolean);
      case 'addPage':
        return this.target.addRow(action.properties);
      // Blok sends nothing out: the host runs these itself.
      case 'sendNotification':
      case 'sendMail':
      case 'sendWebhook':
      case 'sendSlack':
        return false;
    }
  }

  private autofillSoon(rowId: string, propertyId: string): void {
    if (this.ai === undefined) return;
    const key = `${rowId}\u0000${propertyId}`;

    clearTimeout(this.editTimers.get(key));
    this.editTimers.set(key, setTimeout(() => {
      this.editTimers.delete(key);
      const property = this.target.schema().find((p) => p.id === propertyId);

      if (property !== undefined) this.autofill(rowId, property);
    }, AUTOFILL_EDIT_DELAY_MS));
  }

  private autofill(rowId: string, property: PropertyDefinition, settings = property.autofill): void {
    const ai = this.ai;
    const values = this.target.rowValues(rowId);

    if (ai === undefined || settings === undefined || values === undefined) return;
    const before = JSON.stringify(values[property.id] ?? null);
    const key = `${rowId}\u0000${property.id}`;
    const mine = ++this.fillSeq;
    const saved = (): boolean => this.target.schema().find((p) => p.id === property.id)?.autofill !== undefined;
    // Generate runs an unsaved draft: only a fill that had saved settings stops when they go.
    const hadSaved = saved();

    const ended = { done: false };
    const end = (): void => {
      if (ended.done) return;
      ended.done = true;
      const left = (this.filling.get(key) ?? 1) - 1;

      if (left > 0) this.filling.set(key, left);
      else {
        this.filling.delete(key);
        this.latestFill.delete(key);
      }
    };
    const changed = (): void => {
      if (!this.target.isDestroyed()) this.target.fillingChanged?.(rowId, property.id);
    };

    this.filling.set(key, (this.filling.get(key) ?? 0) + 1);
    this.target.fillingChanged?.(rowId, property.id);
    const request = (() => {
      try {
        return ai.autofill({ databaseId: this.target.databaseId, rowId, propertyId: property.id, settings, values });
      } catch {
        return undefined;
      }
    })();

    if (request === undefined) {
      end();
      changed();

      return;
    }
    // Only a request the host took supersedes the ones still running.
    this.latestFill.set(key, mine);
    void request
      .then((result) => {
        const latest = this.latestFill.get(key) === mine;

        // Before the write, so its redraw shows the value, not "Thinking…".
        end();
        const now = this.target.rowValues(rowId);

        // A newer fill of this cell, a person who edited the value, or a deleted AI Autofill wins over this answer.
        if (!latest || result === null || result === undefined || this.target.isDestroyed() || now === undefined
          || JSON.stringify(now[property.id] ?? null) !== before || (hadSaved && !saved())) return;
        this.quietly(() => this.target.writeHostValues(rowId, { [property.id]: result }));
      })
      .catch(() => undefined)
      .finally(() => {
        end();
        changed();
      });
  }
}
