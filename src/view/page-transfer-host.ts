import type { PageBlockPlacement } from './page-transfer';

interface PageTransferBase {
  operationId: string;
  sourcePageId: string;
  targetPageId: string;
}

export type PageTransferRequest =
  | (PageTransferBase & {
    kind: 'move-blocks' | 'reparent-page';
    rootIds: string[];
    place: PageBlockPlacement;
  })
  | (PageTransferBase & {
    kind: 'turn-into-page';
    rootIds: string[];
    pointerId: string;
  })
  | (PageTransferBase & {
    kind: 'turn-into-blocks';
    pointerId: string;
  })
  | (PageTransferBase & {
    kind: 'duplicate-page';
    pointerId: string;
    place: PageBlockPlacement;
  });

export interface PageTransferSagaStep {
  doc: string;
  lineage: string;
  sequence: string;
}

export type PageTransferDurability =
  | { kind: 'transaction'; transactionId: string }
  | { kind: 'saga'; steps: PageTransferSagaStep[] };

export interface PageTransferReceipt {
  operationId: string;
  kind: PageTransferRequest['kind'];
  sourcePageId: string;
  targetPageId: string;
  rootIds: string[];
  undoToken: string;
  durability: PageTransferDurability;
}

export interface PageTransferHost {
  mode: 'saved-transaction' | 'live-transaction' | 'live-saga';
  run(request: PageTransferRequest): Promise<PageTransferReceipt>;
}

export interface PageTransferUndoRequest {
  operationId: string;
  undoOf: PageTransferReceipt;
}

export interface PageTransferUndoReceipt {
  operationId: string;
  undoOfOperationId: string;
  undoToken: string;
  durability: PageTransferDurability;
}

export interface PageTransferUndoHost extends PageTransferHost {
  undo(request: PageTransferUndoRequest): Promise<PageTransferUndoReceipt>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFilled = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isDurable = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === 'transaction') {
    return isFilled(value.transactionId);
  }

  return value.kind === 'saga' &&
    Array.isArray(value.steps) &&
    value.steps.length > 0 &&
    Array.from(value.steps).every((step: unknown) => isRecord(step) &&
      isFilled(step.doc) && isFilled(step.lineage) && isFilled(step.sequence));
};

const isLiveMode = (mode: PageTransferHost['mode']): boolean =>
  mode === 'live-transaction' || mode === 'live-saga';

const matchingReceipt = (
  value: unknown,
  request: PageTransferRequest
): value is PageTransferReceipt => {
  if (!isRecord(value) ||
      value.operationId !== request.operationId ||
      value.kind !== request.kind ||
      value.sourcePageId !== request.sourcePageId ||
      value.targetPageId !== request.targetPageId ||
      typeof value.undoToken !== 'string' ||
      value.undoToken.length === 0 ||
      !Array.isArray(value.rootIds) ||
      !Array.from(value.rootIds).every((id: unknown) => typeof id === 'string' && id.length > 0) ||
      !isDurable(value.durability)) {
    return false;
  }

  if ('rootIds' in request) {
    return value.rootIds.length === request.rootIds.length &&
      value.rootIds.every((id: string, index: number) => id === request.rootIds[index]);
  }

  return true;
};

export async function executePageTransfer(
  host: PageTransferHost,
  request: PageTransferRequest,
  context: { collaboration: boolean }
): Promise<PageTransferReceipt> {
  if (!request.operationId.trim()) {
    throw new Error('Transfer operation ID is required');
  }
  if (context.collaboration && !isLiveMode(host.mode)) {
    throw new Error('Cross-document transfer needs a durable live document adapter');
  }

  const originalRequest = structuredClone(request);
  const receipt: unknown = await host.run(structuredClone(originalRequest));

  if (!matchingReceipt(receipt, originalRequest)) {
    throw new Error('Host did not return a matching transaction receipt');
  }

  return receipt;
}

const isDurableOriginalReceipt = (value: unknown): value is PageTransferReceipt =>
  isRecord(value) &&
  typeof value.operationId === 'string' &&
  value.operationId.length > 0 &&
  typeof value.undoToken === 'string' &&
  value.undoToken.length > 0 &&
  isDurable(value.durability);

const matchingUndoReceipt = (
  value: unknown,
  request: PageTransferUndoRequest
): value is PageTransferUndoReceipt =>
  isRecord(value) &&
  value.operationId === request.operationId &&
  value.undoOfOperationId === request.undoOf.operationId &&
  value.undoToken === request.undoOf.undoToken &&
  isDurable(value.durability);

export async function undoPageTransfer(
  host: PageTransferUndoHost,
  request: PageTransferUndoRequest,
  context: { collaboration: boolean }
): Promise<PageTransferUndoReceipt> {
  if (!request.operationId.trim()) {
    throw new Error('Undo operation ID is required');
  }
  if (context.collaboration && !isLiveMode(host.mode)) {
    throw new Error('Undo needs a durable live document adapter');
  }
  if (!isDurableOriginalReceipt(request.undoOf)) {
    throw new Error('Undo requires an original transaction receipt');
  }

  const originalRequest = structuredClone(request);
  const receipt: unknown = await host.undo(structuredClone(originalRequest));

  if (!matchingUndoReceipt(receipt, originalRequest)) {
    throw new Error('Host did not return a matching Undo transaction receipt');
  }

  return receipt;
}
