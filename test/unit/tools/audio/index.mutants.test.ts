import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockAPI, PasteEvent } from '../../../../types';
import type { MenuConfig } from '../../../../types/tools/menu-config';
import type { AudioAlignment, AudioConfig, AudioData } from '../../../../types/tools/audio';
import type * as CoverPickerModule from '../../../../src/tools/audio/cover-picker';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconCaption,
  IconCopy,
  IconDownload,
  IconImage,
  IconMusic,
  IconPlayerLoop,
  IconReplace,
  IconTrash,
} from '../../../../src/components/icons';
import { AudioTool } from '../../../../src/tools/audio';
import { openCoverPicker } from '../../../../src/tools/audio/cover-picker';
import { readTrackMetadata, resolveCover } from '../../../../src/tools/audio/metadata';
import { AudioUploadError } from '../../../../src/tools/audio/uploader';
import { attachWaveform, decodePeaks } from '../../../../src/tools/audio/waveform';

type Mock = ReturnType<typeof vi.fn>;

interface UploaderStub {
  handleFile: Mock;
  handleUrl: Mock;
}

interface ControlsCall {
  media: HTMLAudioElement;
  figure: HTMLElement;
  data: AudioData;
  onLoopChange?: (loop: boolean) => void;
  element: HTMLElement;
}

interface PickerCall {
  anchor: HTMLElement;
  trigger?: HTMLElement;
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
  onClose?: () => void;
  handle: { close: Mock; setError: Mock };
}

interface UploadCtx {
  onProgress?(percent: number): void;
}

interface MenuItem {
  icon?: string;
  title?: string;
  name?: string;
  isActive?: boolean;
  isDisabled?: boolean;
  closeOnActivate?: boolean;
  onActivate?: () => void;
  children?: { items?: MenuItem[] };
}

const captured = vi.hoisted(() => ({
  uploaders: [] as UploaderStub[],
  controls: [] as ControlsCall[],
  pickers: [] as PickerCall[],
}));

vi.mock('../../../../src/tools/audio/metadata', () => ({
  readTrackMetadata: vi.fn(),
  resolveCover: vi.fn(),
}));

vi.mock('../../../../src/tools/audio/waveform', () => ({
  decodePeaks: vi.fn(),
  attachWaveform: vi.fn(),
}));

// The transport bar is mocked so the loop channel can be driven directly and so
// controls.ts (its own storage reads and media wiring) cannot colour verdicts here.
vi.mock('../../../../src/tools/audio/controls', () => ({
  attachControls: vi.fn((options: Omit<ControlsCall, 'element'>) => {
    const element = document.createElement('div');

    element.setAttribute('data-role', 'audio-controls');
    captured.controls.push({ ...options, element });

    return { element, destroy: vi.fn() };
  }),
}));

vi.mock('../../../../src/tools/audio/cover-picker', async (importOriginal) => {
  const actual = await importOriginal<typeof CoverPickerModule>();

  return {
    ...actual,
    openCoverPicker: vi.fn((options: Omit<PickerCall, 'handle'>) => {
      const handle = { close: vi.fn(), setError: vi.fn() };

      captured.pickers.push({ ...options, handle });

      return handle;
    }),
  };
});

vi.mock('../../../../src/tools/audio/uploader', () => {
  class AudioUploadError extends Error {
    public constructor(public readonly code: string, public readonly detail?: string) {
      super(code);
    }
  }

  class Uploader {
    public handleFile = vi.fn().mockResolvedValue({ url: 'https://cdn/track.mp3', fileName: 'track.mp3' });
    public handleUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/track.mp3' });

    public constructor() {
      captured.uploaders.push(this);
    }
  }

  return { AudioUploadError, Uploader };
});

const decodePeaksMock = vi.mocked(decodePeaks);
const attachWaveformMock = vi.mocked(attachWaveform);
const readTrackMetadataMock = vi.mocked(readTrackMetadata);
const resolveCoverMock = vi.mocked(resolveCover);
const openCoverPickerMock = vi.mocked(openCoverPicker);

/** The editor's asset-kind-routed uploader — cover art goes through this. */
const uploaderApi = {
  uploadByFile: vi.fn(async (file: File) => ({ url: `https://cdn/${file.name}` })),
  uploadByUrl: vi.fn(async (url: string) => ({ url })),
  isConfigured: vi.fn(() => true),
};

const createApi = (messages: Record<string, string> = {}): API => ({
  styles: { block: 'blok-block' },
  i18n: {
    t: (key: string) => messages[key] ?? key,
    has: (key: string) => key in messages,
  },
  uploader: uploaderApi,
} as unknown as API);

const makeBlock = (): { block: BlockAPI; dispatchChange: Mock } => {
  const dispatchChange = vi.fn();
  const block = {
    id: 'a1',
    name: 'audio',
    holder: document.createElement('div'),
    dispatchChange,
  } as unknown as BlockAPI;

  return { block, dispatchChange };
};

interface Fixture {
  tool: AudioTool;
  root: HTMLElement;
  dispatchChange: Mock;
  uploader: UploaderStub;
}

const build = (
  data: Partial<AudioData> = {},
  config: AudioConfig = {},
  messages: Record<string, string> = {},
): { tool: AudioTool; dispatchChange: Mock } => {
  const { block, dispatchChange } = makeBlock();
  const tool = new AudioTool({
    data: { url: '', ...data },
    config,
    api: createApi(messages),
    block,
    readOnly: false,
  });

  return { tool, dispatchChange };
};

const mount = (
  data: Partial<AudioData> = {},
  config: AudioConfig = {},
  messages: Record<string, string> = {},
): Fixture => {
  const { tool, dispatchChange } = build(data, config, messages);
  const root = tool.render();

  document.body.appendChild(root);

  const uploader = captured.uploaders.at(-1);

  if (!uploader) {
    throw new Error('uploader instance not captured');
  }

  return { tool, root, dispatchChange, uploader };
};

const menuItems = (config: MenuConfig): MenuItem[] =>
  (Array.isArray(config) ? config : [config]) as unknown as MenuItem[];

const flatten = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((entry) => [entry, ...flatten(entry.children?.items ?? [])]);

const settingsItem = (tool: AudioTool, name: string): MenuItem => {
  const found = flatten(menuItems(tool.renderSettings())).find((entry) => entry.name === name);

  if (!found) {
    throw new Error(`no settings item named ${name}`);
  }

  return found;
};

const activate = (tool: AudioTool, name: string): void => {
  const target = settingsItem(tool, name);

  if (!target.onActivate) {
    throw new Error(`settings item ${name} cannot be activated`);
  }

  target.onActivate();
};

const audioFile = (name = 'track.mp3'): File => new File(['bytes'], name, { type: 'audio/mpeg' });

const filePaste = (file: File): PasteEvent =>
  ({ type: 'file', detail: { file } }) as unknown as PasteEvent;

const urlPaste = (url = 'https://x/y.mp3'): PasteEvent =>
  ({ type: 'pattern', detail: { data: url } }) as unknown as PasteEvent;

/** Drain every queued microtask chain (one macrotask tick). Real timers only. */
const flush = (): Promise<void> => new Promise<void>((resolve) => {
  setTimeout(resolve, 0);
});

const lastPicker = (): PickerCall => {
  const picker = captured.pickers.at(-1);

  if (!picker) {
    throw new Error('cover picker was not opened');
  }

  return picker;
};

const requireEl = (root: HTMLElement, selector: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(selector);

  if (!el) {
    throw new Error(`missing ${selector}`);
  }

  return el;
};

beforeEach(() => {
  vi.clearAllMocks();
  captured.uploaders.length = 0;
  captured.controls.length = 0;
  captured.pickers.length = 0;
  decodePeaksMock.mockResolvedValue(null);
  attachWaveformMock.mockReturnValue({ destroy: vi.fn() });
  readTrackMetadataMock.mockResolvedValue({});
  resolveCoverMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('AudioTool — stored data survives a save', () => {
  it('carries every stored field through save()', () => {
    const stored: AudioData = {
      url: 'https://cdn/a.mp3',
      caption: 'Live at the Roundhouse',
      captionVisible: true,
      title: 'Nightcall',
      artist: 'Kavinsky',
      coverUrl: 'https://cdn/cover.png',
      loop: true,
      width: 60,
      alignment: 'right',
      fileName: 'nightcall.mp3',
      mimeType: 'audio/mpeg',
      duration: 258,
      peaks: [0.1, 0.9],
    };
    const { tool } = mount(stored);

    expect(tool.save()).toStrictEqual(stored);
  });

  it('omits every field the block does not carry', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    // toStrictEqual, not toEqual: `{ caption: undefined }` and `{}` are toEqual-equal,
    // so a guard that stopped skipping absent fields would pass unnoticed.
    expect(tool.save()).toStrictEqual({ url: 'https://cdn/a.mp3' });
  });

  it('starts empty when the block is built without data', () => {
    const { block } = makeBlock();
    const tool = new AudioTool({
      data: {} as AudioData,
      config: {},
      api: createApi(),
      block,
      readOnly: false,
    });

    expect(tool.save().url).toBe('');
    expect(tool.render().getAttribute('data-state')).toBe('empty');
  });

  it('starts empty when the host hands over no data object at all', () => {
    const { block } = makeBlock();
    const tool = new AudioTool({
      data: undefined as unknown as AudioData,
      config: {},
      api: createApi(),
      block,
      readOnly: false,
    });

    expect(tool.save().url).toBe('');
  });

  it('renders a stored url straight into the player', () => {
    const { root } = mount({ url: 'https://cdn/a.mp3' });

    expect(root.getAttribute('data-blok-tool')).toBe('audio');
    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(root.querySelector('[data-role="audio-media"]')).not.toBeNull();
  });

  it('refuses to validate an empty or non-string url', () => {
    const { tool } = build();

    expect(tool.validate({ url: '' })).toBe(false);
    expect(tool.validate({ url: 'https://cdn/a.mp3' })).toBe(true);
    // Corrupted stored data that merely *has* a length must not pass as a url.
    expect(tool.validate({ url: ['a', 'b'] as unknown as string })).toBe(false);
  });
});

describe('AudioTool — static tool declarations', () => {
  it('describes itself for the toolbox', () => {
    expect(AudioTool.toolbox).toStrictEqual({
      icon: IconMusic,
      titleKey: 'audio',
      searchTerms: ['audio', 'music', 'sound', 'song', 'mp3', 'track', 'media'],
      section: 'media',
    });
  });

  it('supports read-only mode and declares the audio asset kind', () => {
    expect(AudioTool.isReadOnlySupported).toBe(true);
    expect(AudioTool.assetKind).toBe('audio');
  });
});

describe('AudioTool — paste routing', () => {
  it('ignores a paste that is neither a url pattern nor a file', () => {
    const { tool, root, uploader } = mount();
    const event = {
      type: 'tag',
      detail: { data: document.createElement('audio') },
    } as unknown as PasteEvent;

    expect(() => tool.onPaste(event)).not.toThrow();
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(uploader.handleFile).not.toHaveBeenCalled();
  });
});

describe('AudioTool — toolbar anchor', () => {
  it('has no anchor before the block is rendered', () => {
    const { tool } = build({ url: 'https://cdn/a.mp3' });

    expect(tool.getToolbarAnchorElement()).toBeUndefined();
  });

  it('has no anchor while the block still shows the picker', () => {
    const { tool } = mount();

    expect(tool.getToolbarAnchorElement()).toBeUndefined();
  });
});

describe('AudioTool — settings menu', () => {
  const localized = {
    'tools.audio.alignment': 'Ausrichtung',
    'tools.audio.alignmentLeft': 'Links',
    'tools.audio.alignmentCenter': 'Mitte',
    'tools.audio.alignmentRight': 'Rechts',
    'tools.audio.caption': 'Beschriftung',
    'tools.audio.loop': 'Schleife',
    'tools.audio.replace': 'Audio ersetzen',
    'tools.audio.coverSet': 'Cover setzen',
    'tools.audio.coverRemove': 'Cover entfernen',
    'tools.audio.download': 'Herunterladen',
    'tools.audio.copyUrl': 'URL kopieren',
  };

  it('lists every action with its English fallback copy', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });
    const items = menuItems(tool.renderSettings());

    expect(items.map((entry) => entry.name)).toStrictEqual([
      'audio-alignment',
      'audio-caption',
      'audio-loop',
      'audio-replace',
      'audio-cover-set',
      'audio-download',
      'audio-copy-url',
    ]);
    expect(items.map((entry) => entry.title)).toStrictEqual([
      'Alignment',
      'Caption',
      'Loop',
      'Replace audio',
      'Set cover image',
      'Download',
      'Copy URL',
    ]);
    expect(items.map((entry) => entry.icon)).toStrictEqual([
      IconAlignCenter,
      IconCaption,
      IconPlayerLoop,
      IconReplace,
      IconImage,
      IconDownload,
      IconCopy,
    ]);
    expect(items.map((entry) => entry.closeOnActivate)).toStrictEqual([
      undefined,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('translates every action title', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' }, {}, localized);
    const items = menuItems(tool.renderSettings());

    expect(items.map((entry) => entry.title)).toStrictEqual([
      'Ausrichtung',
      'Beschriftung',
      'Schleife',
      'Audio ersetzen',
      'Cover setzen',
      'Herunterladen',
      'URL kopieren',
    ]);
  });

  it('offers the three alignments with the stored one marked active', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });
    const children = settingsItem(tool, 'audio-alignment').children?.items ?? [];

    expect(children.map((entry) => entry.name)).toStrictEqual([
      'audio-alignment-left',
      'audio-alignment-center',
      'audio-alignment-right',
    ]);
    expect(children.map((entry) => entry.title)).toStrictEqual(['Align left', 'Align center', 'Align right']);
    expect(children.map((entry) => entry.icon)).toStrictEqual([IconAlignLeft, IconAlignCenter, IconAlignRight]);
    expect(children.map((entry) => entry.closeOnActivate)).toStrictEqual([true, true, true]);
    // No stored alignment means centred, so the centre entry is the active one.
    expect(children.map((entry) => entry.isActive)).toStrictEqual([false, true, false]);
  });

  it('translates the alignment entries', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' }, {}, localized);
    const children = settingsItem(tool, 'audio-alignment').children?.items ?? [];

    expect(children.map((entry) => entry.title)).toStrictEqual(['Links', 'Mitte', 'Rechts']);
  });

  it('shows the stored alignment on the parent entry', () => {
    const left = mount({ url: 'https://cdn/a.mp3', alignment: 'left' });

    expect(settingsItem(left.tool, 'audio-alignment').icon).toBe(IconAlignLeft);
    expect((settingsItem(left.tool, 'audio-alignment').children?.items ?? []).map((e) => e.isActive))
      .toStrictEqual([true, false, false]);

    const right = mount({ url: 'https://cdn/a.mp3', alignment: 'right' });

    expect(settingsItem(right.tool, 'audio-alignment').icon).toBe(IconAlignRight);
    expect((settingsItem(right.tool, 'audio-alignment').children?.items ?? []).map((e) => e.isActive))
      .toStrictEqual([false, false, true]);
  });

  it('falls back to the centre icon for an alignment it does not know', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3', alignment: 'justify' as unknown as AudioAlignment });

    expect(settingsItem(tool, 'audio-alignment').icon).toBe(IconAlignCenter);
    expect((settingsItem(tool, 'audio-alignment').children?.items ?? []).map((e) => e.isActive))
      .toStrictEqual([false, false, false]);
  });

  it('marks Caption and Loop inactive on a fresh block', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    expect(settingsItem(tool, 'audio-caption').isActive).toBe(false);
    expect(settingsItem(tool, 'audio-loop').isActive).toBe(false);
  });

  it('marks Caption and Loop active once they are stored', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3', caption: 'Hello', loop: true });

    expect(settingsItem(tool, 'audio-caption').isActive).toBe(true);
    expect(settingsItem(tool, 'audio-loop').isActive).toBe(true);
  });

  it('adds Remove cover only when a cover is stored', () => {
    const withCover = mount({ url: 'https://cdn/a.mp3', coverUrl: 'https://cdn/c.png' });
    const remove = settingsItem(withCover.tool, 'audio-cover-remove');

    expect(menuItems(withCover.tool.renderSettings()).map((entry) => entry.name)).toStrictEqual([
      'audio-alignment',
      'audio-caption',
      'audio-loop',
      'audio-replace',
      'audio-cover-set',
      'audio-cover-remove',
      'audio-download',
      'audio-copy-url',
    ]);
    expect(remove.icon).toBe(IconTrash);
    expect(remove.title).toBe('Remove cover');
    expect(remove.closeOnActivate).toBe(true);
  });

  it('translates Remove cover', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3', coverUrl: 'https://cdn/c.png' }, {}, localized);

    expect(settingsItem(tool, 'audio-cover-remove').title).toBe('Cover entfernen');
  });
});

describe('AudioTool — Download is scheme-gated (stored XSS)', () => {
  /** Records the anchors that were actually clicked, without navigating. */
  const captureDownloads = (): HTMLAnchorElement[] => {
    const clicked: HTMLAnchorElement[] = [];

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement): void {
      clicked.push(this);
    });

    return clicked;
  };

  it('never clicks an anchor for a stored javascript: url', () => {
    const clicked = captureDownloads();
    const { tool } = mount({ url: 'javascript:fetch("/admin", { credentials: "include" })' });

    activate(tool, 'audio-download');

    expect(clicked).toStrictEqual([]);
    expect(settingsItem(tool, 'audio-download').isDisabled).toBe(true);
  });

  it('never clicks an anchor for a stored data:text/html url', () => {
    const clicked = captureDownloads();
    const { tool } = mount({ url: 'data:text/html,<script>alert(1)</script>' });

    activate(tool, 'audio-download');

    expect(clicked).toStrictEqual([]);
    expect(settingsItem(tool, 'audio-download').isDisabled).toBe(true);
  });

  it('downloads a hosted file through a detached, opener-safe anchor', () => {
    const clicked = captureDownloads();
    const { tool } = mount({ url: 'https://cdn/track.mp3', fileName: 'nightcall.mp3' });

    expect(settingsItem(tool, 'audio-download').isDisabled).toBe(false);

    activate(tool, 'audio-download');

    const anchor = clicked[0];

    if (!anchor) {
      throw new Error('no download anchor was clicked');
    }

    // Without rel=noopener the opened tab can reach back through window.opener.
    expect(anchor.rel).toBe('noopener');
    expect(anchor.target).toBe('_blank');
    expect(anchor.href).toBe('https://cdn/track.mp3');
    expect(anchor.download).toBe('nightcall.mp3');
    // The anchor is a throwaway: leaving it behind litters the host page.
    expect(document.body.contains(anchor)).toBe(false);
  });

  it('downloads without a name when the block stored none', () => {
    const clicked = captureDownloads();
    const { tool } = mount({ url: 'https://cdn/track.mp3' });

    activate(tool, 'audio-download');

    expect(clicked[0]?.getAttribute('download')).toBe('');
  });
});

describe('AudioTool — removal', () => {
  it('revokes the blob urls it owns', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { tool } = mount({ url: 'blob:audio-1', coverUrl: 'blob:cover-1' });

    tool.removed();

    expect(revoke.mock.calls.map((call) => call[0])).toStrictEqual(['blob:audio-1', 'blob:cover-1']);
  });

  it('leaves hosted urls alone', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { tool } = mount({ url: 'https://cdn/a.mp3', coverUrl: 'https://cdn/c.png' });

    tool.removed();

    expect(revoke).not.toHaveBeenCalled();
  });

  it('cancels a pending caption collapse so a removed block stops editing the page', () => {
    vi.useFakeTimers();

    try {
      const { tool, root } = mount({ url: 'https://cdn/a.mp3', caption: 'Hello' });

      activate(tool, 'audio-caption');
      tool.removed();
      vi.advanceTimersByTime(1000);

      expect(root.querySelector('[data-role="audio-caption-row"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AudioTool — upload lifecycle', () => {
  it('swaps the picker for an upload card naming the file', async () => {
    const { tool, root, uploader } = mount({}, {}, { 'tools.image.uploadingLabel': 'Wird hochgeladen' });

    uploader.handleFile.mockImplementation(() => new Promise(() => undefined));
    tool.onPaste(filePaste(audioFile()));
    await flush();

    expect(root.getAttribute('data-state')).toBe('loading');
    expect(root.querySelector('.blok-media-empty')).toBeNull();
    expect(root.querySelector('[data-role="filename"]')?.textContent).toBe('track.mp3');
    expect(root.querySelector('.blok-image-uploading__label')?.textContent).toBe('Wird hochgeladen');
  });

  it('labels a url upload without inventing a file name', async () => {
    const { tool, root, uploader } = mount();

    uploader.handleUrl.mockImplementation(() => new Promise(() => undefined));
    tool.onPaste(urlPaste());
    await flush();

    expect(root.querySelector('.blok-image-uploading__label')?.textContent).toBe('Uploading…');
    expect(root.querySelector('[data-role="filename"]')).toBeNull();
  });

  it('moves the progress bar while a file uploads', async () => {
    const { tool, root, uploader } = mount();
    let report: ((percent: number) => void) | undefined;

    uploader.handleFile.mockImplementation((_file: File, ctx: UploadCtx) => {
      report = ctx.onProgress;

      return new Promise(() => undefined);
    });
    tool.onPaste(filePaste(audioFile()));
    await flush();
    report?.(42);

    expect(root.querySelector('[data-role="pct"]')?.textContent).toBe('42%');
  });

  it('moves the progress bar while a url uploads', async () => {
    const { tool, root, uploader } = mount();
    let report: ((percent: number) => void) | undefined;

    uploader.handleUrl.mockImplementation((_url: string, ctx: UploadCtx) => {
      report = ctx.onProgress;

      return new Promise(() => undefined);
    });
    tool.onPaste(urlPaste());
    await flush();
    report?.(42);

    expect(root.querySelector('[data-role="pct"]')?.textContent).toBe('42%');
  });

  it('ignores file progress reported after the card is gone', async () => {
    const { tool, uploader } = mount();
    let report: ((percent: number) => void) | undefined;

    uploader.handleFile.mockImplementation((_file: File, ctx: UploadCtx) => {
      report = ctx.onProgress;

      return new Promise(() => undefined);
    });
    tool.onPaste(filePaste(audioFile()));
    await flush();
    activate(tool, 'audio-replace');

    expect(() => report?.(50)).not.toThrow();
  });

  it('ignores url progress reported after the card is gone', async () => {
    const { tool, uploader } = mount();
    let report: ((percent: number) => void) | undefined;

    uploader.handleUrl.mockImplementation((_url: string, ctx: UploadCtx) => {
      report = ctx.onProgress;

      return new Promise(() => undefined);
    });
    tool.onPaste(urlPaste());
    await flush();
    activate(tool, 'audio-replace');

    expect(() => report?.(50)).not.toThrow();
  });

  it('cancels an in-flight upload back to the picker', async () => {
    const { tool, root, uploader } = mount();

    uploader.handleFile.mockImplementation(() => new Promise(() => undefined));
    tool.onPaste(filePaste(audioFile()));
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();

    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('uploads a file chosen from the picker', async () => {
    const { root, uploader } = mount();
    const input = root.querySelector<HTMLInputElement>('[data-blok-testid="file-input"]');
    const file = audioFile('chosen.mp3');

    if (!input) {
      throw new Error('no file input in the empty state');
    }

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush();

    expect(uploader.handleFile.mock.calls[0]?.[0]).toBe(file);
  });

  it('keeps the returned url, name and mime type', async () => {
    const { tool, root, uploader } = mount();

    uploader.handleFile.mockResolvedValue({ url: 'https://cdn/track.mp3', fileName: 'track.mp3' });
    tool.onPaste(filePaste(audioFile('dropped.mp3')));
    await flush();

    expect(tool.save().url).toBe('https://cdn/track.mp3');
    expect(tool.save().fileName).toBe('track.mp3');
    expect(tool.save().mimeType).toBe('audio/mpeg');
    expect(root.getAttribute('data-state')).toBe('rendered');
  });

  it('falls back to the dropped file name when the host returns none', async () => {
    const { tool, uploader } = mount({ fileName: 'old.mp3' });

    uploader.handleFile.mockResolvedValue({ url: 'https://cdn/new.mp3' });
    tool.onPaste(filePaste(audioFile('dropped.mp3')));
    await flush();

    expect(tool.save().fileName).toBe('dropped.mp3');
  });

  it('keeps the stored mime type when a url insert carries none', async () => {
    const { tool, uploader } = mount({ mimeType: 'audio/flac' });

    uploader.handleUrl.mockResolvedValue({ url: 'https://cdn/track.mp3' });
    tool.onPaste(urlPaste());
    await flush();

    expect(tool.save().mimeType).toBe('audio/flac');
  });
});

describe('AudioTool — upload failures', () => {
  const failWith = async (error: unknown, messages: Record<string, string> = {}): Promise<Fixture> => {
    const fixture = mount({}, {}, messages);

    fixture.uploader.handleFile.mockRejectedValue(error);
    fixture.tool.onPaste(filePaste(audioFile()));
    await flush();

    return fixture;
  };

  it('shows a retryable error card when the upload fails', async () => {
    const { root } = await failWith(new Error('network down'));
    const wrap = requireEl(root, '[data-role="audio-error"]');
    const retry = requireEl(root, '[data-action="replace"]');

    expect(root.getAttribute('data-state')).toBe('error');
    expect(wrap.className).toBe('blok-audio-error-state');
    expect(wrap.textContent).toContain('Upload failed');
    expect(retry.className).toBe('blok-audio-retry');
    expect((retry as HTMLButtonElement).type).toBe('button');
    expect(retry.textContent).toBe('Replace');

    retry.click();

    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('translates the error card', async () => {
    const { root } = await failWith(new Error('network down'), {
      'tools.audio.errorUploadFailed': 'Hochladen fehlgeschlagen',
      'tools.audio.errorReplace': 'Ersetzen',
    });

    expect(requireEl(root, '[data-role="audio-error"]').textContent).toContain('Hochladen fehlgeschlagen');
    expect(requireEl(root, '[data-action="replace"]').textContent).toBe('Ersetzen');
  });

  it('translates the Google Drive hint', async () => {
    const { root } = await failWith(new AudioUploadError('GOOGLE_DRIVE_NEEDS_UPLOADER'), {
      'tools.audio.errorGoogleDrive': 'Drive-Links lassen sich nicht abspielen',
    });

    expect(requireEl(root, '[data-role="audio-error"]').textContent)
      .toContain('Drive-Links lassen sich nicht abspielen');
  });

  it('translates the OneDrive hint', async () => {
    const { root } = await failWith(new AudioUploadError('ONEDRIVE_NEEDS_UPLOADER'), {
      'tools.audio.errorOneDrive': 'OneDrive-Links lassen sich nicht abspielen',
    });

    expect(requireEl(root, '[data-role="audio-error"]').textContent)
      .toContain('OneDrive-Links lassen sich nicht abspielen');
  });

  it('does not blame OneDrive for an unrelated upload error', async () => {
    const { root } = await failWith(new AudioUploadError('UPLOAD_FAILED'), {
      'tools.audio.errorOneDrive': 'OneDrive-Hinweis',
      'tools.audio.errorUploadFailed': 'Hochladen fehlgeschlagen',
    });
    const text = requireEl(root, '[data-role="audio-error"]').textContent;

    expect(text).toContain('Hochladen fehlgeschlagen');
    expect(text).not.toContain('OneDrive-Hinweis');
  });

  it('spells out both sizes when the file is too large', async () => {
    const { root } = await failWith(new AudioUploadError('FILE_TOO_LARGE', '2000 > 1000'), {
      'tools.audio.errorFileTooLarge': '{size} sprengt das Limit von {max}',
      'tools.audio.errorUploadFailed': 'Hochladen fehlgeschlagen',
    });
    const text = requireEl(root, '[data-role="audio-error"]').textContent;

    expect(root.getAttribute('data-state')).toBe('error');
    expect(text).toContain('sprengt das Limit von');
    expect(text).not.toContain('Hochladen fehlgeschlagen');
  });
});

describe('AudioTool — enrichment from the audio bytes', () => {
  const upload = async (fixture: Fixture): Promise<void> => {
    fixture.tool.onPaste(filePaste(audioFile()));
    await flush();
  };

  it('applies a title read from the file and repaints the card', async () => {
    readTrackMetadataMock.mockResolvedValue({ title: 'Nightcall' });

    const fixture = mount();

    await upload(fixture);

    expect(fixture.tool.save().title).toBe('Nightcall');
    expect(requireEl(fixture.root, '[data-role="audio-title"]').textContent).toBe('Nightcall');
    expect(fixture.dispatchChange).toHaveBeenCalledTimes(2);
  });

  it('applies an artist read from the file and repaints the card', async () => {
    readTrackMetadataMock.mockResolvedValue({ artist: 'Kavinsky' });

    const fixture = mount();

    await upload(fixture);

    expect(fixture.tool.save().artist).toBe('Kavinsky');
    expect(requireEl(fixture.root, '[data-role="audio-artist"]').textContent).toBe('Kavinsky');
    expect(fixture.dispatchChange).toHaveBeenCalledTimes(2);
  });

  it('stores embedded cover art and shows it', async () => {
    readTrackMetadataMock.mockResolvedValue({ cover: { data: new Uint8Array([1]), mimeType: 'image/png' } });
    resolveCoverMock.mockResolvedValue('https://cdn/art.png');

    const fixture = mount();

    await upload(fixture);

    expect(fixture.tool.save().coverUrl).toBe('https://cdn/art.png');
    expect(fixture.root.querySelector('[data-role="audio-cover"] img')?.getAttribute('src'))
      .toBe('https://cdn/art.png');
    expect(fixture.dispatchChange).toHaveBeenCalledTimes(2);
  });

  it('does not go looking for artwork the track does not carry', async () => {
    readTrackMetadataMock.mockResolvedValue({ title: 'Nightcall' });

    const fixture = mount();

    await upload(fixture);

    expect(resolveCoverMock).not.toHaveBeenCalled();
  });

  it('keeps the track and warns when the artwork cannot be stored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    readTrackMetadataMock.mockResolvedValue({ cover: { data: new Uint8Array([1]), mimeType: 'image/png' } });
    resolveCoverMock.mockRejectedValue(new Error('bucket refused'));

    const fixture = mount();

    await upload(fixture);

    expect(fixture.tool.save().coverUrl).toBeUndefined();
    expect(fixture.dispatchChange).toHaveBeenCalledTimes(1);
    // A silently dropped cover reads exactly like a track with no artwork.
    expect(warn.mock.calls[0]?.join(' ')).toContain("could not store the track's embedded cover art");
  });

  it('drops artwork that resolves after the track was replaced', async () => {
    let settle: (url: string) => void = () => undefined;

    readTrackMetadataMock.mockResolvedValue({ cover: { data: new Uint8Array([1]), mimeType: 'image/png' } });
    resolveCoverMock.mockReturnValue(new Promise<string>((resolve) => {
      settle = resolve;
    }));

    const fixture = mount();

    await upload(fixture);
    activate(fixture.tool, 'audio-replace');
    fixture.dispatchChange.mockClear();
    settle('https://cdn/art.png');
    await flush();

    expect(fixture.dispatchChange).not.toHaveBeenCalled();
  });

  it('drops metadata that arrives after the track was replaced', async () => {
    let settle: (meta: { title?: string }) => void = () => undefined;

    readTrackMetadataMock.mockReturnValue(new Promise((resolve) => {
      settle = resolve;
    }));

    const fixture = mount();

    await upload(fixture);
    activate(fixture.tool, 'audio-replace');
    fixture.dispatchChange.mockClear();
    settle({ title: 'Nightcall' });
    await flush();

    expect(fixture.tool.save().title).toBeUndefined();
    expect(fixture.dispatchChange).not.toHaveBeenCalled();
  });

  it('caches decoded peaks and draws the waveform', async () => {
    decodePeaksMock.mockResolvedValue({ peaks: [0.2, 0.8], duration: 9 });

    const fixture = mount();

    await upload(fixture);

    const call = attachWaveformMock.mock.calls.at(-1)?.[0];

    expect(fixture.tool.save().peaks).toStrictEqual([0.2, 0.8]);
    expect(fixture.tool.save().duration).toBe(9);
    expect(call?.peaks).toStrictEqual([0.2, 0.8]);
    expect(call?.media).toBe(fixture.root.querySelector('[data-role="audio-media"]'));
    expect(call?.mount).toBe(fixture.root.querySelector('[data-role="audio-waveform"]'));
    expect(fixture.dispatchChange).toHaveBeenCalledTimes(2);
  });

  it('ignores a decode that produced no peaks', async () => {
    decodePeaksMock.mockResolvedValue({ peaks: [], duration: 0 });

    const fixture = mount();

    await upload(fixture);

    expect(fixture.tool.save().peaks).toBeUndefined();
    expect(attachWaveformMock).not.toHaveBeenCalled();
    expect(fixture.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('drops peaks decoded for a track that was replaced', async () => {
    let settle: (decoded: { peaks: number[]; duration: number }) => void = () => undefined;

    decodePeaksMock.mockReturnValue(new Promise((resolve) => {
      settle = resolve;
    }));

    const fixture = mount();

    await upload(fixture);
    activate(fixture.tool, 'audio-replace');
    settle({ peaks: [0.9], duration: 3 });
    await flush();

    expect(fixture.tool.save().peaks).toBeUndefined();
  });
});

describe('AudioTool — enrichment of a url insert', () => {
  const insert = async (fixture: Fixture): Promise<void> => {
    fixture.tool.onPaste(urlPaste());
    await flush();
  };

  it('does not enrich from a response the host refused', async () => {
    const blob = new Blob([new Uint8Array(8)], { type: 'audio/mpeg' });

    decodePeaksMock.mockResolvedValue({ peaks: [0.5], duration: 4 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, blob: () => Promise.resolve(blob) }));

    const fixture = mount();

    await insert(fixture);

    expect(decodePeaksMock).not.toHaveBeenCalled();
    expect(fixture.tool.save().peaks).toBeUndefined();
  });

  it('decodes the fetched bytes under a default name', async () => {
    const blob = new Blob([new Uint8Array(8)], { type: 'audio/mpeg' });

    decodePeaksMock.mockResolvedValue({ peaks: [0.5], duration: 4 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }));

    const fixture = mount();

    await insert(fixture);

    const decoded = decodePeaksMock.mock.calls[0]?.[0];

    expect(decoded?.name).toBe('audio');
    expect(decoded?.size).toBe(8);
    expect(decoded?.type).toBe('audio/mpeg');
  });

  it('names the fetched bytes after the stored file name', async () => {
    const blob = new Blob([new Uint8Array(8)], { type: 'audio/mpeg' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }));

    const fixture = mount({ fileName: 'nightcall.mp3' });

    await insert(fixture);

    expect(decodePeaksMock.mock.calls[0]?.[0]?.name).toBe('nightcall.mp3');
  });

  it('drops fetched bytes for a track that was replaced meanwhile', async () => {
    let settle: (response: unknown) => void = () => undefined;
    const first = new Promise((resolve) => {
      settle = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockRejectedValue(new TypeError('blocked'));

    vi.stubGlobal('fetch', fetchMock);

    const fixture = mount();

    await insert(fixture);
    fixture.uploader.handleUrl.mockResolvedValue({ url: 'https://cdn/other.mp3' });
    await insert(fixture);
    settle({ ok: true, blob: () => Promise.resolve(new Blob([new Uint8Array(4)], { type: 'audio/mpeg' })) });
    await flush();

    expect(fixture.tool.save().url).toBe('https://cdn/other.mp3');
    expect(decodePeaksMock).not.toHaveBeenCalled();
  });
});

describe('AudioTool — player card', () => {
  it('mirrors alignment and caption visibility onto the root', () => {
    const plain = mount({ url: 'https://cdn/a.mp3' });

    expect(plain.root.getAttribute('data-align')).toBe('center');
    expect(plain.root.getAttribute('data-caption')).toBe('off');

    const dressed = mount({ url: 'https://cdn/a.mp3', alignment: 'right', caption: 'Hello' });

    expect(dressed.root.getAttribute('data-align')).toBe('right');
    expect(dressed.root.getAttribute('data-caption')).toBe('on');
  });

  it('survives setReadOnly before the block is rendered', () => {
    const { tool } = build({ url: 'https://cdn/a.mp3' });

    expect(() => tool.setReadOnly(true)).not.toThrow();
  });

  it('labels the editable lines and the cover button', () => {
    const { root } = mount({ url: 'https://cdn/a.mp3' });

    expect(requireEl(root, '[data-role="audio-title"]').getAttribute('data-placeholder')).toBe('Track title');
    expect(requireEl(root, '[data-role="audio-artist"]').getAttribute('data-placeholder')).toBe('Artist');
    expect(requireEl(root, '[data-role="audio-cover-change"]').getAttribute('aria-label')).toBe('Change cover');
  });

  it('translates the editable lines and the cover button', () => {
    const { root } = mount({ url: 'https://cdn/a.mp3' }, {}, {
      'tools.audio.titlePlaceholder': 'Titel',
      'tools.audio.artistPlaceholder': 'Interpret',
      'tools.audio.coverChange': 'Cover ändern',
    });

    expect(requireEl(root, '[data-role="audio-title"]').getAttribute('data-placeholder')).toBe('Titel');
    expect(requireEl(root, '[data-role="audio-artist"]').getAttribute('data-placeholder')).toBe('Interpret');
    expect(requireEl(root, '[data-role="audio-cover-change"]').getAttribute('aria-label')).toBe('Cover ändern');
  });

  it('draws no waveform for a track with no cached peaks', () => {
    mount({ url: 'https://cdn/a.mp3' });

    expect(attachWaveformMock).not.toHaveBeenCalled();
  });

  it('mounts the transport controls inside the card body', () => {
    const { root } = mount({ url: 'https://cdn/a.mp3' });
    const call = captured.controls.at(-1);

    if (!call) {
      throw new Error('controls were not attached');
    }

    expect(requireEl(root, '[data-role="audio-body"]').contains(call.element)).toBe(true);
  });

  it('stores a loop switched on from the controls and forgets it when switched off', () => {
    const { tool, dispatchChange } = mount({ url: 'https://cdn/a.mp3' });
    const call = captured.controls.at(-1);

    if (!call?.onLoopChange) {
      throw new Error('controls got no loop channel');
    }

    call.onLoopChange(true);

    expect(tool.save().loop).toBe(true);
    expect(dispatchChange).toHaveBeenCalledTimes(1);

    call.onLoopChange(false);

    expect(tool.save()).toStrictEqual({ url: 'https://cdn/a.mp3' });
    expect(dispatchChange).toHaveBeenCalledTimes(2);
  });

  it('stores an edited title and artist', () => {
    const { tool, root, dispatchChange } = mount({ url: 'https://cdn/a.mp3' });
    const title = requireEl(root, '[data-role="audio-title"]');
    const artist = requireEl(root, '[data-role="audio-artist"]');

    title.textContent = 'Nightcall';
    title.dispatchEvent(new Event('blur'));

    expect(tool.save().title).toBe('Nightcall');
    expect(dispatchChange).toHaveBeenCalledTimes(1);

    artist.textContent = 'Kavinsky';
    artist.dispatchEvent(new Event('blur'));

    expect(tool.save().artist).toBe('Kavinsky');
    expect(dispatchChange).toHaveBeenCalledTimes(2);
  });

  it('drops an emptied title and artist rather than saving blanks', () => {
    const { tool, root } = mount({ url: 'https://cdn/a.mp3', title: 'Nightcall', artist: 'Kavinsky' });
    const title = requireEl(root, '[data-role="audio-title"]');
    const artist = requireEl(root, '[data-role="audio-artist"]');

    title.textContent = '';
    title.dispatchEvent(new Event('blur'));
    artist.textContent = '';
    artist.dispatchEvent(new Event('blur'));

    expect(tool.save()).toStrictEqual({ url: 'https://cdn/a.mp3' });
  });

  it('reports no change when a blur leaves the text alone', () => {
    const { root, dispatchChange } = mount({ url: 'https://cdn/a.mp3', title: 'Nightcall', artist: 'Kavinsky' });

    requireEl(root, '[data-role="audio-title"]').dispatchEvent(new Event('blur'));
    requireEl(root, '[data-role="audio-artist"]').dispatchEvent(new Event('blur'));

    expect(dispatchChange).not.toHaveBeenCalled();
  });
});

describe('AudioTool — caption', () => {
  it('follows the read-only state', () => {
    const { tool, root } = mount({ url: 'https://cdn/a.mp3', caption: 'Hello' });

    expect(requireEl(root, '[data-role="audio-caption"]').getAttribute('contenteditable')).toBe('true');

    tool.setReadOnly(true);

    expect(requireEl(root, '[data-role="audio-caption"]').getAttribute('contenteditable')).toBe('false');
  });

  it('reports an edit once and ignores an unchanged blur', () => {
    const { tool, root, dispatchChange } = mount({ url: 'https://cdn/a.mp3', caption: 'Hello' });
    const caption = requireEl(root, '[data-role="audio-caption"]');

    caption.dispatchEvent(new Event('blur'));

    expect(dispatchChange).not.toHaveBeenCalled();

    caption.textContent = 'Live at the Roundhouse';
    caption.dispatchEvent(new Event('blur'));

    expect(tool.save().caption).toBe('Live at the Roundhouse');
    expect(dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('animates in without rebuilding the card', () => {
    const { tool, root, dispatchChange } = mount({ url: 'https://cdn/a.mp3' });
    const figure = root.querySelector('[data-role="audio-figure"]');

    activate(tool, 'audio-caption');

    expect(root.querySelector('[data-role="audio-caption-row"]')).not.toBeNull();
    // Same figure instance: the player was not torn down to add a caption.
    expect(root.querySelector('[data-role="audio-figure"]')).toBe(figure);
    expect(root.getAttribute('data-caption')).toBe('on');
    expect(tool.save().captionVisible).toBe(true);
    expect(dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('keeps caption text written before the opt-in switch existed', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3', caption: 'Legacy words', captionVisible: false });

    activate(tool, 'audio-caption');

    expect(tool.save().caption).toBe('Legacy words');
    expect(tool.save().captionVisible).toBe(true);
  });

  it('survives a toggle before the block is rendered', () => {
    const { tool } = build({ url: 'https://cdn/a.mp3' });

    expect(() => activate(tool, 'audio-caption')).not.toThrow();
  });

  it('reuses the collapsing row when the caption is switched back on', () => {
    vi.useFakeTimers();

    try {
      const { tool, root } = mount({ url: 'https://cdn/a.mp3', caption: 'Hello' });

      activate(tool, 'audio-caption');

      const row = root.querySelector<HTMLElement>('[data-role="audio-caption-row"]');

      expect(row?.classList.contains('is-collapsed')).toBe(true);

      activate(tool, 'audio-caption');

      expect(root.querySelectorAll('[data-role="audio-caption-row"]')).toHaveLength(1);
      expect(row?.classList.contains('is-collapsed')).toBe(false);

      // The collapse-out fallback must be cancelled, or it removes the row we just reopened.
      vi.advanceTimersByTime(1000);

      expect(root.querySelector('[data-role="audio-caption-row"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the row as soon as its fade ends', () => {
    vi.useFakeTimers();

    try {
      const { tool, root } = mount({ url: 'https://cdn/a.mp3', caption: 'Hello' });

      activate(tool, 'audio-caption');

      const row = requireEl(root, '[data-role="audio-caption-row"]');

      row.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'transform' }));

      expect(root.querySelector('[data-role="audio-caption-row"]')).not.toBeNull();

      row.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'opacity' }));

      expect(root.querySelector('[data-role="audio-caption-row"]')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a collapse finishing after the caption was switched back on', () => {
    vi.useFakeTimers();

    try {
      const { tool, root } = mount({ url: 'https://cdn/a.mp3', caption: 'Hello' });
      const row = requireEl(root, '[data-role="audio-caption-row"]');

      activate(tool, 'audio-caption');
      // Switched back on mid-collapse: the row is reopened and the fallback
      // timer cancelled, but the fade-out listener is still attached.
      activate(tool, 'audio-caption');
      row.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'opacity' }));

      expect(root.querySelector('[data-role="audio-caption-row"]')).toBeNull();

      // No row is left to collapse — the off switch must not assume one exists.
      expect(() => activate(tool, 'audio-caption')).not.toThrow();
      expect(tool.save().captionVisible).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the collapse fallback when the card is rebuilt', () => {
    vi.useFakeTimers();

    try {
      const { tool } = mount({ url: 'https://cdn/a.mp3', caption: 'Hello' });

      activate(tool, 'audio-caption');

      expect(vi.getTimerCount()).toBe(1);

      activate(tool, 'audio-loop');

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AudioTool — settings actions', () => {
  it('stores a chosen alignment and repaints', () => {
    const { tool, root, dispatchChange } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-alignment-right');

    expect(tool.save().alignment).toBe('right');
    expect(root.getAttribute('data-align')).toBe('right');
    expect(dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('ignores re-picking the alignment already in force', () => {
    const { tool, root, dispatchChange } = mount({ url: 'https://cdn/a.mp3', alignment: 'center' });
    const figure = root.querySelector('[data-role="audio-figure"]');

    activate(tool, 'audio-alignment-center');

    expect(dispatchChange).not.toHaveBeenCalled();
    expect(root.querySelector('[data-role="audio-figure"]')).toBe(figure);
  });

  it('switches loop on and off again', () => {
    const { tool, root, dispatchChange } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-loop');

    expect(tool.save().loop).toBe(true);
    expect(root.querySelector<HTMLAudioElement>('[data-role="audio-media"]')?.loop).toBe(true);
    expect(dispatchChange).toHaveBeenCalledTimes(1);

    activate(tool, 'audio-loop');

    expect(tool.save()).toStrictEqual({ url: 'https://cdn/a.mp3' });
    expect(root.querySelector<HTMLAudioElement>('[data-role="audio-media"]')?.loop).toBe(false);
    expect(dispatchChange).toHaveBeenCalledTimes(2);
  });

  it('empties the block back to the picker without losing the track details', () => {
    const { tool, root, dispatchChange } = mount({ url: 'https://cdn/a.mp3', title: 'Nightcall' });

    activate(tool, 'audio-replace');

    expect(tool.save().url).toBe('');
    expect(tool.save().title).toBe('Nightcall');
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(root.querySelector('.blok-media-empty')).not.toBeNull();
    expect(dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('copies the stored url to the clipboard', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });
    const writeText = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('navigator', { clipboard: { writeText } });
    activate(tool, 'audio-copy-url');

    expect(writeText).toHaveBeenCalledWith('https://cdn/a.mp3');
  });

  it('stays quiet when the browser exposes no clipboard', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    vi.stubGlobal('navigator', {});

    expect(() => activate(tool, 'audio-copy-url')).not.toThrow();
  });

  it('stays quiet when the clipboard cannot write text', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    vi.stubGlobal('navigator', { clipboard: {} });

    expect(() => activate(tool, 'audio-copy-url')).not.toThrow();
  });
});

describe('AudioTool — cover picker', () => {
  it('opens against the cover art', () => {
    const { tool, root } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');

    expect(openCoverPickerMock).toHaveBeenCalledTimes(1);
    expect(lastPicker().anchor).toBe(root.querySelector('[data-role="audio-cover"]'));
  });

  it('refuses to open in read-only mode', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    tool.setReadOnly(true);
    activate(tool, 'audio-cover-set');

    expect(openCoverPickerMock).not.toHaveBeenCalled();
  });

  it('does nothing when there is no rendered card to anchor to', () => {
    const { tool } = build({ url: 'https://cdn/a.mp3' });

    expect(() => activate(tool, 'audio-cover-set')).not.toThrow();
    expect(openCoverPickerMock).not.toHaveBeenCalled();
  });

  it('does nothing while the block still shows the picker', () => {
    const { tool } = mount();

    expect(() => activate(tool, 'audio-cover-set')).not.toThrow();
    expect(openCoverPickerMock).not.toHaveBeenCalled();
  });

  it('rejects a non-image file without touching the block', () => {
    const { tool, dispatchChange } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onFile(audioFile('song.mp3'));

    expect(lastPicker().handle.setError).toHaveBeenCalledWith('Choose an image file');
    expect(dispatchChange).not.toHaveBeenCalled();
  });

  it('survives a rejected file arriving after the picker closed', () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onClose?.();

    expect(() => lastPicker().onFile(audioFile('song.mp3'))).not.toThrow();
  });

  it('routes a cover file through the image pipeline', async () => {
    const { tool } = mount({ url: 'https://cdn/a.mp3' });
    const file = new File(['x'], 'art.png', { type: 'image/png' });

    activate(tool, 'audio-cover-set');
    lastPicker().onFile(file);
    await flush();

    expect(uploaderApi.uploadByFile).toHaveBeenCalledWith(file, { kind: 'image', tool: 'audio' });
    expect(tool.save().coverUrl).toBe('https://cdn/art.png');
    expect(lastPicker().handle.close).toHaveBeenCalledTimes(1);
  });

  it('routes a cover url through the image pipeline and stores what comes back', async () => {
    uploaderApi.uploadByUrl.mockResolvedValue({ url: 'https://cdn/stored.png' });

    const { tool, root } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/art.png');
    await flush();

    expect(uploaderApi.uploadByUrl).toHaveBeenCalledWith('https://origin/art.png', { kind: 'image', tool: 'audio' });
    expect(tool.save().coverUrl).toBe('https://cdn/stored.png');
    expect(root.querySelector('[data-role="audio-cover"] img')?.getAttribute('src')).toBe('https://cdn/stored.png');
    expect(lastPicker().handle.close).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed cover file upload in the picker', async () => {
    uploaderApi.uploadByFile.mockRejectedValue(new Error('bucket refused'));

    const { tool } = mount({ url: 'https://cdn/a.mp3' }, {}, { 'tools.audio.errorUploadFailed': 'Fehlgeschlagen' });

    activate(tool, 'audio-cover-set');
    lastPicker().onFile(new File(['x'], 'art.png', { type: 'image/png' }));
    await flush();

    expect(lastPicker().handle.setError).toHaveBeenCalledWith('Fehlgeschlagen');
  });

  it('surfaces a failed cover url upload in the picker', async () => {
    uploaderApi.uploadByUrl.mockRejectedValue(new Error('bucket refused'));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/art.png');
    await flush();

    expect(lastPicker().handle.setError).toHaveBeenCalledWith('Upload failed');
  });

  it('falls back to English when a cover file upload fails untranslated', async () => {
    uploaderApi.uploadByFile.mockRejectedValue(new Error('bucket refused'));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onFile(new File(['x'], 'art.png', { type: 'image/png' }));
    await flush();

    expect(lastPicker().handle.setError).toHaveBeenCalledWith('Upload failed');
  });

  it('translates a failed cover url upload', async () => {
    uploaderApi.uploadByUrl.mockRejectedValue(new Error('bucket refused'));

    const { tool } = mount({ url: 'https://cdn/a.mp3' }, {}, { 'tools.audio.errorUploadFailed': 'Fehlgeschlagen' });

    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/art.png');
    await flush();

    expect(lastPicker().handle.setError).toHaveBeenCalledWith('Fehlgeschlagen');
  });

  it('survives a cover file upload failing after the picker closed', async () => {
    let fail: (error: Error) => void = () => undefined;

    uploaderApi.uploadByFile.mockReturnValue(new Promise((_resolve, reject) => {
      fail = reject;
    }));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onFile(new File(['x'], 'art.png', { type: 'image/png' }));
    lastPicker().onClose?.();
    fail(new Error('bucket refused'));
    await flush();

    expect(tool.save().coverUrl).toBeUndefined();
  });

  it('survives a cover url upload failing after the picker closed', async () => {
    let fail: (error: Error) => void = () => undefined;

    uploaderApi.uploadByUrl.mockReturnValue(new Promise((_resolve, reject) => {
      fail = reject;
    }));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/art.png');
    lastPicker().onClose?.();
    fail(new Error('bucket refused'));
    await flush();

    expect(tool.save().coverUrl).toBeUndefined();
  });

  it('drops a cover url that resolves after the block was removed', async () => {
    let settle: (result: { url: string }) => void = () => undefined;

    uploaderApi.uploadByUrl.mockReturnValue(new Promise((resolve) => {
      settle = resolve;
    }));

    const { tool, dispatchChange } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/art.png');
    tool.removed();
    dispatchChange.mockClear();
    settle({ url: 'https://cdn/stored.png' });
    await flush();

    expect(tool.save().coverUrl).toBeUndefined();
    expect(dispatchChange).not.toHaveBeenCalled();
  });

  it('revokes a cover blob the removed block can no longer own', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let settle: (result: { url: string }) => void = () => undefined;

    uploaderApi.uploadByFile.mockReturnValue(new Promise((resolve) => {
      settle = resolve;
    }));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onFile(new File(['x'], 'art.png', { type: 'image/png' }));
    tool.removed();
    revoke.mockClear();
    settle({ url: 'blob:cover-9' });
    await flush();

    expect(revoke).toHaveBeenCalledWith('blob:cover-9');
    expect(tool.save().coverUrl).toBeUndefined();
  });

  it('leaves a hosted cover url alone when the block was removed mid-upload', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let settle: (result: { url: string }) => void = () => undefined;

    uploaderApi.uploadByFile.mockReturnValue(new Promise((resolve) => {
      settle = resolve;
    }));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onFile(new File(['x'], 'art.png', { type: 'image/png' }));
    tool.removed();
    revoke.mockClear();
    settle({ url: 'https://cdn/art.png' });
    await flush();

    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('AudioTool — a cover that lands after the picker closed', () => {
  /**
   * Runs `act` and collects the promise rejections that escape to the process.
   * jsdom never routes one to a window error event, so a `void` chain that
   * throws on a closed picker reads as success unless the process is watched.
   */
  const leakedRejections = async (act: () => Promise<void>): Promise<string[]> => {
    const leaked: string[] = [];
    const onRejection = (reason: unknown): void => {
      leaked.push(String(reason));
    };

    process.on('unhandledRejection', onRejection);

    try {
      await act();
      // Node announces a rejection only once the microtask queue drains.
      await flush();
      await flush();
    } finally {
      process.removeListener('unhandledRejection', onRejection);
    }

    return leaked;
  };

  const chooseImage = (tool: AudioTool): void => {
    activate(tool, 'audio-cover-set');
    lastPicker().onFile(new File(['x'], 'art.png', { type: 'image/png' }));
  };

  it('stores a cover file that lands after the picker closed, without leaking a rejection', async () => {
    let settle: (result: { url: string }) => void = () => undefined;

    uploaderApi.uploadByFile.mockReturnValue(new Promise((resolve) => {
      settle = resolve;
    }));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    chooseImage(tool);
    lastPicker().onClose?.();

    const leaked = await leakedRejections(async () => {
      settle({ url: 'https://cdn/stored.png' });
    });

    expect(leaked).toStrictEqual([]);
    expect(tool.save().coverUrl).toBe('https://cdn/stored.png');
  });

  it('stores a cover url that lands after the picker closed, without leaking a rejection', async () => {
    let settle: (result: { url: string }) => void = () => undefined;

    uploaderApi.uploadByUrl.mockReturnValue(new Promise((resolve) => {
      settle = resolve;
    }));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/art.png');
    lastPicker().onClose?.();

    const leaked = await leakedRejections(async () => {
      settle({ url: 'https://cdn/stored.png' });
    });

    expect(leaked).toStrictEqual([]);
    expect(tool.save().coverUrl).toBe('https://cdn/stored.png');
  });

  it('survives a cover file upload failing after the picker closed, without leaking a rejection', async () => {
    let fail: (error: Error) => void = () => undefined;

    uploaderApi.uploadByFile.mockReturnValue(new Promise((_resolve, reject) => {
      fail = reject;
    }));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    chooseImage(tool);
    lastPicker().onClose?.();

    const leaked = await leakedRejections(async () => {
      fail(new Error('bucket refused'));
    });

    expect(leaked).toStrictEqual([]);
    expect(tool.save().coverUrl).toBeUndefined();
  });

  it('survives a cover url upload failing after the picker closed, without leaking a rejection', async () => {
    let fail: (error: Error) => void = () => undefined;

    uploaderApi.uploadByUrl.mockReturnValue(new Promise((_resolve, reject) => {
      fail = reject;
    }));

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/art.png');
    lastPicker().onClose?.();

    const leaked = await leakedRejections(async () => {
      fail(new Error('bucket refused'));
    });

    expect(leaked).toStrictEqual([]);
    expect(tool.save().coverUrl).toBeUndefined();
  });
});

describe('AudioTool — a rendered menu outliving the state it was built for', () => {
  it('survives removing the cover twice through the same menu config', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { tool, dispatchChange } = mount({ url: 'https://cdn/a.mp3', coverUrl: 'blob:cover-1' });
    const removeItem = settingsItem(tool, 'audio-cover-remove');
    const fire = removeItem.onActivate;

    if (!fire) {
      throw new Error('the remove-cover item cannot be activated');
    }

    fire();
    // The toolbar holds the menu it rendered, so the item can fire again after
    // the cover it was built for is already gone.
    fire();

    expect(revoke.mock.calls.map((call) => call[0])).toStrictEqual(['blob:cover-1']);
    expect(tool.save().coverUrl).toBeUndefined();
    expect(dispatchChange).toHaveBeenCalledTimes(2);
  });
});

describe('AudioTool — cover lifetime', () => {
  const setCoverTwice = async (first: string, second: string): Promise<{ tool: AudioTool }> => {
    uploaderApi.uploadByUrl.mockResolvedValueOnce({ url: first }).mockResolvedValueOnce({ url: second });

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/one.png');
    await flush();
    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/two.png');
    await flush();

    return { tool };
  };

  it('revokes the blob cover it replaces, and nothing on the first one', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    uploaderApi.uploadByUrl.mockResolvedValue({ url: 'blob:cover-1' });

    const { tool } = mount({ url: 'https://cdn/a.mp3' });

    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/one.png');
    await flush();

    // Nothing was stored before, so there is no object url to release.
    expect(revoke).not.toHaveBeenCalled();

    uploaderApi.uploadByUrl.mockResolvedValue({ url: 'blob:cover-2' });
    activate(tool, 'audio-cover-set');
    lastPicker().onUrl('https://origin/two.png');
    await flush();

    expect(revoke).toHaveBeenCalledWith('blob:cover-1');
    expect(tool.save().coverUrl).toBe('blob:cover-2');
  });

  it('keeps a blob cover that is stored again under the same url', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await setCoverTwice('blob:cover-1', 'blob:cover-1');

    expect(revoke).not.toHaveBeenCalled();
  });

  it('does not revoke a hosted cover it replaces', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await setCoverTwice('https://cdn/one.png', 'https://cdn/two.png');

    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes a blob cover that is removed', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { tool, root, dispatchChange } = mount({ url: 'https://cdn/a.mp3', coverUrl: 'blob:cover-1' });

    activate(tool, 'audio-cover-remove');

    expect(revoke).toHaveBeenCalledWith('blob:cover-1');
    expect(tool.save().coverUrl).toBeUndefined();
    expect(root.querySelector('[data-role="audio-cover"] img')).toBeNull();
    expect(dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('does not revoke a hosted cover that is removed', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { tool } = mount({ url: 'https://cdn/a.mp3', coverUrl: 'https://cdn/c.png' });

    activate(tool, 'audio-cover-remove');

    expect(revoke).not.toHaveBeenCalled();
    expect(tool.save().coverUrl).toBeUndefined();
  });
});
