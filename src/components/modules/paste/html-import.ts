import type { BlokConfig } from '../../../../types/configs/blok-config';
import type { OutputBlockData } from '../../../../types/data-formats/output-data';
import type { Paste } from './index';

interface ScratchBlock {
  readonly inputs: HTMLElement[];
  currentInput: HTMLElement | undefined;
}

interface ScratchCaret {
  setToBlock(block: ScratchBlock, position?: string, offset?: number): void;
  setToInput(input: HTMLElement, position?: string, offset?: number): void;
  set(element: HTMLElement, offset?: number): void;
  insertContentAtCaretPosition(content: string): void;
  extractFragmentFromCaretPosition(): void | DocumentFragment;
}

interface ScratchEditor {
  isReady: Promise<unknown>;
  save(): Promise<{ blocks: OutputBlockData[] }>;
  destroy(): void;
  module: {
    paste: Paste;
    caret: ScratchCaret;
    blockManager: { currentBlock: ScratchBlock | undefined; readonly blocks: ScratchBlock[] };
  };
}

// Tool settings that upload or fetch a pasted URL. The live insert renders the src it keeps.
const NETWORK_SETTINGS = ['uploader', 'uploadByUrl', 'uploadByFile', 'assets', 'endpoints'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every tool, with its upload settings removed and its GIF-to-video fetch turned off. */
const offlineTools = (tools: BlokConfig['tools']): BlokConfig['tools'] => tools === undefined ? undefined : Object.fromEntries(
  Object.entries(tools).map(([name, entry]) => {
    const settings: Record<string, unknown> = isRecord(entry) && 'class' in entry ? { ...entry } : { class: entry };
    const config = isRecord(settings.config) ? settings.config : {};

    return [name, {
      ...settings,
      config: { ...Object.fromEntries(Object.entries(config).filter(([key]) => !NETWORK_SETTINGS.includes(key))), convertGifToVideo: false },
    }];
  })
);

/**
 * The editor config the paste pipeline reads. Everything else stays out: the
 * scratch editor must not sync, save, autofocus or call the host's onChange,
 * and no upload starts for an editor that is gone before it would finish.
 */
const pasteConfigOf = (config: BlokConfig): BlokConfig => ({
  tools: offlineTools(config.tools),
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

/**
 * The scratch editor never moves the window selection or focus: they belong to
 * the person, who may type or click while the import runs. A caret move only
 * updates the scratch block state. A write at the caret pins a range in the
 * scratch block, writes, and puts the person's ranges back, all in one task, so
 * nothing the person does can land between the pin and the write.
 * @param scratch - the hidden editor
 * @param holder - its holder; a write anywhere else is refused
 */
const detachCaret = (scratch: ScratchEditor, holder: HTMLElement): void => {
  const { caret, blockManager } = scratch.module;
  const insert = caret.insertContentAtCaretPosition.bind(caret);
  const extract = caret.extractFragmentFromCaretPosition.bind(caret);

  const atScratchCaret = <T>(write: () => T): T => {
    const input = blockManager.currentBlock?.currentInput;

    if (input === undefined || !holder.contains(input)) {
      throw new Error('The paste has no caret in its own editor.');
    }
    const selection = window.getSelection();
    const kept = selection === null ? [] : Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index));
    const range = document.createRange();

    range.selectNodeContents(input);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    try {
      return write();
    } finally {
      selection?.removeAllRanges();
      kept.forEach(each => selection?.addRange(each));
    }
  };

  caret.setToBlock = (block, position) => {
    blockManager.currentBlock = block;
    // eslint-disable-next-line no-param-reassign -- the scratch block's own caret state
    block.currentInput = position === 'start' ? block.inputs[0] : block.inputs.at(-1);
  };
  caret.setToInput = (input) => {
    const block = blockManager.currentBlock;

    if (block !== undefined) {
      block.currentInput = input;
    }
  };
  caret.set = () => undefined;
  caret.insertContentAtCaretPosition = (content) => atScratchCaret(() => insert(content));
  caret.extractFragmentFromCaretPosition = () => atScratchCaret(extract);
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
  const selection = window.getSelection();
  const before = selection === null ? [] : Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index));
  const holder = document.createElement('div');

  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(holder);
  // Lazy: blok.ts imports this module's own editor graph.
  const { Blok } = await import('../../../blok');
  const scratch = new Blok({ ...pasteConfigOf(config), holder }) as unknown as ScratchEditor;

  try {
    await scratch.isReady;
    // Booting an editor clears the page selection (BlockSelection.toggleReadOnly). Put it back
    // only if it is still cleared: a caret the person placed since then is theirs.
    if (selection !== null && selection.rangeCount === 0) {
      before.filter(range => range.startContainer.isConnected).forEach(range => selection.addRange(range));
    }
    detachCaret(scratch, holder);
    const [first] = scratch.module.blockManager.blocks;

    if (first !== undefined) {
      scratch.module.caret.setToBlock(first, 'start');
    }
    await scratch.module.paste.processDataTransfer(htmlOnlyTransfer(html));

    return (await scratch.save()).blocks;
  } finally {
    scratch.destroy();
    holder.remove();
  }
};
