/**
 * The editor loads its paste pipeline on the first paste. Load it before a
 * paste whose test waits a fixed time, so the wait covers the paste and not
 * the load. The cold first paste has its own tests.
 */
export const loadPasteEngine = async (): Promise<void> => {
  await import('../../../src/components/modules/paste/engine');
};
