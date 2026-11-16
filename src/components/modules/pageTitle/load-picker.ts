import type { PickerCode } from './icon-control';

const pickerLoad: { pending: Promise<PickerCode> | null } = { pending: null };

/**
 * The picker and its landings load on first open, so the bare editor bundle
 * does not carry them. One shared load; a failed one is dropped so the next
 * click tries again.
 */
export const loadPicker = (): Promise<PickerCode> => {
  pickerLoad.pending ??= Promise.all([
    import('../../../tools/callout/emoji-picker'),
    import('../../../tools/callout/emoji-landing'),
  ]).then(([{ EmojiPicker: Picker }, landings]) => ({ Picker, landings }), (error: unknown) => {
    pickerLoad.pending = null;
    throw error;
  });

  return pickerLoad.pending;
};
