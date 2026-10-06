import {
  forgetOfflinePartitions,
  inspectOfflineScope,
  type OfflinePartitionReport,
  type OfflineScopeForgetResult,
} from './offline-scope';

export const listOfflinePages = async (scope: string): Promise<readonly OfflinePartitionReport[]> =>
  (await inspectOfflineScope(scope)).partitions;

export const forgetOfflinePage = (
  scope: string,
  page: { url: string; doc: string },
  options: { discardPending: true }
): Promise<OfflineScopeForgetResult> =>
  forgetOfflinePartitions(
    scope,
    partition => partition.url === page.url && partition.doc === page.doc,
    options
  );
