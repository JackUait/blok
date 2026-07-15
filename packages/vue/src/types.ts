import type { BlokConfig, Blok, EditorWidth } from '@/types';

/**
 * Configuration for the `useBlok` composable and the `<BlokEditor>` component.
 * Same as `BlokConfig` but without `holder` (managed by the adapter), plus a
 * reactive `width` prop.
 *
 * Reactive props (sync after mount without recreation):
 * - `readOnly` — calls `editor.readOnly.set(value)`
 * - `autofocus` — calls `editor.focus()` when changed to true
 * - `theme` — calls `editor.theme.set(value)`
 * - `width` — calls `editor.width.set(value)`
 * - `placeholder` — calls `editor.placeholder.set(value)`
 * - `data` — re-renders via `editor.render(value)` when content changes
 *   (deep-equal–deduped and serialized; seeds the initial content at creation)
 *
 * The `onSave` config (inherited from `BlokConfig`) is the controlled output
 * half: it fires with the full serialized `OutputData` on every content change,
 * so `data` + `onSave` (or `v-model:data`) form a controlled component.
 */
export interface UseBlokConfig extends Omit<BlokConfig, 'holder'> {
  /** Editor content width mode. Synced reactively after mount via `editor.width.set()`. */
  width?: EditorWidth;
}

/** Props for the `BlokContent` component. */
export interface BlokContentProps {
  /** The Blok editor instance returned by `useBlok`. Pass null before it is ready. */
  editor: Blok | null;
}
