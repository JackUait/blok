import type * as PagePickerKit from './page-picker-kit';

const state: { pending: Promise<typeof PagePickerKit> | null } = { pending: null };

/** The "@" page picker loads on the first "@". A failed load is dropped so the next "@" tries again. */
export const loadPagePickerKit = (): Promise<typeof PagePickerKit> => {
  state.pending ??= import('./page-picker-kit').catch((error: unknown) => {
    state.pending = null;
    throw error;
  });

  return state.pending;
};
