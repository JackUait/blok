import type { LooseOutputData, OutputData } from '@/types';

/**
 * The controlled-content bookkeeping `useBlok` keeps for one editor: the
 * baseline it believes the editor currently reflects.
 *
 * The reactive `data` watcher dedupes against that baseline, which is only sound
 * while the watcher is the ONLY thing changing the content. `<BlokEditor>`'s
 * exposed `render()` moves the editor out from under it: without this channel
 * the baseline still names the document shown BEFORE the imperative call, so
 * setting `data` back to that document is dismissed as an unchanged value and
 * the editor keeps showing whatever `render()` installed.
 *
 * Registered per instance (mirrors the holder / portal-registry WeakMaps) so the
 * exposed facade can reach it from the editor alone — `useBlok` returns only the
 * instance ref, never its internal state.
 */
export interface ContentBaseline {
  /**
   * Record `content` as the document the editor now reflects.
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
