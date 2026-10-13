import type { CollabOutbox, CollabOutboxRow, QuarantineFilter } from './types';

export type BatchDelivery =
  | { state: 'acked'; serverSequence: string | null }
  | { state: 'quarantined'; reason: string }
  | { state: 'timeout' };

type Fate =
  | { state: 'pending'; lineage: string; format: number }
  | { state: 'acked'; serverSequence: string | null }
  | { state: 'quarantined'; reason: string };

/**
 * Wraps the provider's outbox to learn each row's fate. The provider reports
 * acks and quarantines only through these calls, so this is the one place a
 * headless writer can tell "durable" from "refused".
 */
export class TrackingOutbox implements CollabOutbox {
  private readonly inner: CollabOutbox;
  private readonly fates = new Map<string, Fate>();
  private readonly order: string[] = [];
  private readonly listeners = new Set<() => void>();
  // The provider's onOperationAcknowledged fires just before acknowledge().
  private nextSequence: string | null = null;

  constructor(inner: CollabOutbox) {
    this.inner = inner;
  }

  public async appendLocal(update: Uint8Array): Promise<CollabOutboxRow> {
    const row = await this.inner.appendLocal(update);

    this.fates.set(row.operationId, { state: 'pending', lineage: row.lineage, format: row.format });
    this.order.push(row.operationId);

    return row;
  }

  public oldestPending(): Promise<CollabOutboxRow | null> {
    return this.inner.oldestPending();
  }

  public async acknowledge(operationId: string): Promise<void> {
    await this.inner.acknowledge(operationId);
    if (this.fates.get(operationId)?.state === 'pending') {
      this.fates.set(operationId, { state: 'acked', serverSequence: this.nextSequence });
    }
    this.nextSequence = null;
    this.notify();
  }

  public async quarantineLineage(lineage: string, reason: string, snapshot: Uint8Array, filter?: QuarantineFilter): Promise<number> {
    const moved = await this.inner.quarantineLineage(lineage, reason, snapshot, filter);

    for (const [id, fate] of this.fates) {
      if (fate.state === 'pending' && fate.lineage === lineage && fate.format !== filter?.keepFormat) {
        this.fates.set(id, { state: 'quarantined', reason });
      }
    }
    this.notify();

    return moved;
  }

  public onCommitted(listener: () => void): () => void {
    return this.inner.onCommitted(listener);
  }

  public noteSequence(serverSequence: string): void {
    this.nextSequence = serverSequence;
  }

  public appendedCount(): number {
    return this.order.length;
  }

  public idsSince(mark: number): string[] {
    return this.order.slice(mark);
  }

  public pendingIds(): string[] {
    return this.order.filter((id) => this.fates.get(id)?.state === 'pending');
  }

  public isAcked(id: string): boolean {
    return this.fates.get(id)?.state === 'acked';
  }

  /**
   * Settles once every id is acked, or any one is quarantined.
   * The server acks in order on one socket, so the last id's sequence is the batch's highest.
   */
  public waitFor(ids: readonly string[], timeoutMs: number): Promise<BatchDelivery> {
    return new Promise((resolve) => {
      const wait: { timer: ReturnType<typeof setTimeout> | undefined } = { timer: undefined };
      const finish = (delivery: BatchDelivery): void => {
        this.listeners.delete(listener);
        if (wait.timer !== undefined) {
          clearTimeout(wait.timer);
        }
        resolve(delivery);
      };
      const check = (): boolean => {
        const fates = ids.map((id) => this.fates.get(id));
        const quarantined = fates.find((fate) => fate?.state === 'quarantined');

        if (quarantined?.state === 'quarantined') {
          finish({ state: 'quarantined', reason: quarantined.reason });

          return true;
        }
        if (fates.every((fate) => fate?.state === 'acked')) {
          const last = fates.at(-1);

          finish({ state: 'acked', serverSequence: last?.state === 'acked' ? last.serverSequence : null });

          return true;
        }

        return false;
      };
      const listener = (): void => {
        check();
      };

      if (check()) {
        return;
      }
      this.listeners.add(listener);
      wait.timer = setTimeout(() => finish({ state: 'timeout' }), timeoutMs);
    });
  }

  private notify(): void {
    [...this.listeners].forEach((listener) => listener());
  }
}
