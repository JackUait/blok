import type { LooseOutputData, OutputData } from '@/types';

/**
 * The controlled-content bookkeeping `useBlok` keeps for one editor: the
 * baseline it believes the editor currently reflects, plus the window of
 * payloads the editor emitted through `onSave`.
 *
 * The declarative `data` effect dedupes against both, which is only sound while
 * that effect is the ONLY thing changing the content. An imperative
 * `useBlokHandle().clear()` / `.render()` moves the editor out from under the
 * bookkeeping: without this channel, restoring a document the editor itself
 * emitted is dismissed as an echo and never rendered — the editor stays empty
 * while React state says otherwise. Registered per instance (mirrors the holder
 * / portal-registry WeakMaps) so the handle can reach it from the editor alone.
 */
export interface ContentBaseline {
  /**
   * Records `content` as what the editor now reflects and drops every remembered
   * emitted payload — content the editor emitted BEFORE an out-of-band change is
   * no longer content it holds, so it must not no-op a later controlled restore.
   * @param content - the document the editor now reflects
   */
  markRendered(content: OutputData | LooseOutputData | null): void;
}

const baselines = new WeakMap<WeakKey, ContentBaseline>();

export function setContentBaseline(editor: WeakKey, baseline: ContentBaseline): void {
  baselines.set(editor, baseline);
}

export function getContentBaseline(editor: WeakKey): ContentBaseline | undefined {
  return baselines.get(editor);
}

export function removeContentBaseline(editor: WeakKey): void {
  baselines.delete(editor);
}
