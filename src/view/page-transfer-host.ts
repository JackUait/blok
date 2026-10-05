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

export interface PageTransferReceipt {
  operationId: string;
  kind: PageTransferRequest['kind'];
  sourcePageId: string;
  targetPageId: string;
  rootIds: string[];
  undoToken: string;
  durability: { kind: 'transaction'; transactionId: string };
}

export interface PageTransferHost {
  mode: 'saved-transaction' | 'live-transaction';
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
  durability: { kind: 'transaction'; transactionId: string };
}

export interface PageTransferUndoHost extends PageTransferHost {
  undo(request: PageTransferUndoRequest): Promise<PageTransferUndoReceipt>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
      !isRecord(value.durability) ||
      value.durability.kind !== 'transaction' ||
      typeof value.durability.transactionId !== 'string' ||
      value.durability.transactionId.length === 0) {
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
  if (context.collaboration && host.mode !== 'live-transaction') {
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
  isRecord(value.durability) &&
  value.durability.kind === 'transaction' &&
  typeof value.durability.transactionId === 'string' &&
  value.durability.transactionId.length > 0;

const matchingUndoReceipt = (
  value: unknown,
  request: PageTransferUndoRequest
): value is PageTransferUndoReceipt =>
  isRecord(value) &&
  value.operationId === request.operationId &&
  value.undoOfOperationId === request.undoOf.operationId &&
  value.undoToken === request.undoOf.undoToken &&
  isRecord(value.durability) &&
  value.durability.kind === 'transaction' &&
  typeof value.durability.transactionId === 'string' &&
  value.durability.transactionId.length > 0;

export async function undoPageTransfer(
  host: PageTransferUndoHost,
  request: PageTransferUndoRequest,
  context: { collaboration: boolean }
): Promise<PageTransferUndoReceipt> {
  if (!request.operationId.trim()) {
    throw new Error('Undo operation ID is required');
  }
  if (context.collaboration && host.mode !== 'live-transaction') {
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
