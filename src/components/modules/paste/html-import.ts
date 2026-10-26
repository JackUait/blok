import type { BlokConfig } from '../../../../types/configs/blok-config';
import type { OutputBlockData } from '../../../../types/data-formats/output-data';
import type { Paste } from './index';

interface ScratchEditor {
  isReady: Promise<unknown>;
  caret: { setToFirstBlock(position: 'start'): boolean };
  save(): Promise<{ blocks: OutputBlockData[] }>;
  destroy(): void;
  module: { paste: Paste };
}

/**
 * The editor config the paste pipeline reads. Everything else stays out: the
 * scratch editor must not sync, save, autofocus or call the host's onChange.
 * `uploader` is left out on purpose: an image keeps its pasted src, and no
 * upload starts for an editor that is gone before it would finish.
 */
const pasteConfigOf = (config: BlokConfig): BlokConfig => ({
  tools: config.tools,
  defaultBlock: config.defaultBlock,
  sanitizer: config.sanitizer,
  link: config.link,
  linkPaste: config.linkPaste,
  onBeforePaste: config.onBeforePaste,
  inlineToolbar: config.inlineToolbar,
  i18n: config.i18n,
  logLevel: config.logLevel,
  dataModel: config.dataModel,
  data: { blocks: [] },
  readOnly: false,
  autofocus: false,
  tabSync: false,
  pageTitle: false,
  placeholder: false,
  find: false,
  loader: false,
});

/** Only text/html: a text/plain flavour would let the URL, Markdown and text handlers claim it. */
const htmlOnlyTransfer = (html: string): DataTransfer => {
  const transfer = {
    types: ['text/html'],
    files: [],
    items: [],
    getData: (type: string): string => (type === 'text/html' ? html : ''),
    setData: (): void => undefined,
  };

  return transfer as unknown as DataTransfer;
};

const saveSelection = (): { ranges: Range[]; focused: Element | null } => {
  const selection = window.getSelection();
  const ranges = selection === null ? [] : Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());

  return { ranges, focused: document.activeElement };
};

const restoreSelection = ({ ranges, focused }: { ranges: Range[]; focused: Element | null }): void => {
  if (focused instanceof HTMLElement && focused !== document.activeElement && focused.isConnected) {
    focused.focus({ preventScroll: true });
  }
  const selection = window.getSelection();

  if (selection === null) {
    return;
  }
  selection.removeAllRanges();
  ranges.forEach(range => selection.addRange(range));
};

/**
 * Pastes `html` into the empty paragraph of a hidden editor built from the
 * same tools and paste config, and returns what it saved. This is the paste a
 * person makes, so the blocks come out the same: the same preprocessors,
 * sanitizer, tag-to-tool substitution and table-cell parsing.
 * @param config - the live editor's config
 * @param html - the HTML to paste
 */
export const pasteHtmlAsBlocks = async (config: BlokConfig, html: string): Promise<OutputBlockData[]> => {
  const kept = saveSelection();
  const holder = document.createElement('div');

  holder.setAttribute('aria-hidden', 'true');
  // Hidden content cannot take focus, so the paste's caret moves never reach the person's.
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(holder);
  // Lazy: blok.ts imports this module's own editor graph.
  const { Blok } = await import('../../../blok');
  const scratch = new Blok({ ...pasteConfigOf(config), holder }) as unknown as ScratchEditor;

  try {
    await scratch.isReady;
    scratch.caret.setToFirstBlock('start');
    // A paste writes at the window selection. Anywhere else, it would write into the person's document.
    if (!holder.contains(window.getSelection()?.anchorNode ?? null)) {
      throw new Error('The paste could not place its caret.');
    }
    await scratch.module.paste.processDataTransfer(htmlOnlyTransfer(html));

    return (await scratch.save()).blocks;
  } finally {
    scratch.destroy();
    holder.remove();
    restoreSelection(kept);
  }
};
