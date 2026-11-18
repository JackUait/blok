import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuiltInCommentsUi } from '../../../../src/tools/database/database-comments';
import { DatabaseCommentTool } from '../../../../src/tools/database-comment';
import { databaseCommentSanitize } from '../../../../src/shared/tool-descriptions/sanitize/blocks';
import { DATABASE_COMMENT_DATA } from '../../../../src/shared/tool-descriptions/database-comment';
import { sanitizeBlocks } from '../../../../src/components/utils/sanitizer';
import { createOrphanSweep } from '../../../../src/components/utils/orphan-sweep';
import type { API } from '../../../../types';
import type { DatabaseCommentData } from '../../../../types/tools/database-comment';

interface FakeBlock { id: string; name: string; parentId: string | null; data: DatabaseCommentData }

interface Upload { file: File; resolve: (asset: { url: string; fileName?: string }) => void; reject: (error: Error) => void }

/** A row `r1`, the comment blocks under it, and uploads that answer when the test says. */
const harness = (configured = true): { api: API; blocks: FakeBlock[]; uploads: Upload[]; uploadByFile: ReturnType<typeof vi.fn> } => {
  const blocks: FakeBlock[] = [];
  const uploads: Upload[] = [];
  const handle = (block: FakeBlock): unknown => ({
    id: block.id,
    name: block.name,
    call: (method: string, param: { receive: (data: DatabaseCommentData) => void }) => {
      if (method === 'readData') param.receive(structuredClone(block.data));
    },
  });
  const uploadByFile = vi.fn((file: File) => new Promise((resolve, reject) => uploads.push({ file, resolve, reject })));
  const api = {
    events: { on: vi.fn(), off: vi.fn() },
    i18n: { t: (key: string) => key },
    tools: { getBlockTools: () => [{ name: 'database-comment' }] },
    config: {},
    uploader: {
      uploadByFile,
      uploadByUrl: vi.fn(),
      isConfigured: (kind: string, method?: string) => configured && kind === 'file' && method !== 'uploadByUrl',
    },
    blocks: {
      transactWithoutCapture: (fn: () => void) => fn(),
      getChildren: (id: string) => blocks.filter((block) => block.parentId === id).map(handle),
      getById: (id: string) => (id === 'r1' ? { id: 'r1', name: 'database-row' } : (() => {
        const block = blocks.find((each) => each.id === id);

        return block === undefined ? null : handle(block);
      })()),
      insertAt: (name: string, data: DatabaseCommentData, at: { parentId: string }) => {
        const block = { id: `c${blocks.length + 1}`, name, parentId: at.parentId, data };

        blocks.push(block);

        return { id: block.id };
      },
    },
  } as unknown as API;

  return { api, blocks, uploads, uploadByFile };
};

const mount = (api: API, readOnly = false): { ui: BuiltInCommentsUi; section: HTMLElement } => {
  const ui = new BuiltInCommentsUi({
    api,
    locale: () => 'en-US',
    me: () => null,
    personName: () => undefined,
    permitted: () => true,
    readOnly: () => readOnly,
    onChange: vi.fn(),
  });
  const section = ui.section('r1');

  document.body.appendChild(section);

  return { ui, section };
};

const attachButton = (root: ParentNode): HTMLButtonElement | null => root.querySelector('[data-blok-database-comment-attach]');

const pick = (root: ParentNode, ...files: File[]): void => {
  const picker = root.querySelector<HTMLInputElement>('input[type="file"]');

  if (picker === null) throw new Error('no file picker');
  Object.defineProperty(picker, 'files', { configurable: true, value: files });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
};

const inputOf = (root: ParentNode): HTMLTextAreaElement => {
  const input = root.querySelector<HTMLTextAreaElement>('[data-blok-database-comment-input]');

  if (input === null) throw new Error('no composer');

  return input;
};

const send = (root: ParentNode): HTMLButtonElement | null => root.querySelector('[data-blok-database-comment-send]');

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const pending = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-blok-database-comment-draft-file]')];

describe('comment composer — Attach file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows Attach file only when the host uploads files', () => {
    expect(attachButton(mount(harness(false).api).section)).toBeNull();
    expect(attachButton(mount(harness(true).api).section)?.getAttribute('aria-label')).toBe('tools.database.starterAttachFile');
  });

  it('Attach file opens the file picker', () => {
    const { section } = mount(harness().api);
    const picker = section.querySelector<HTMLInputElement>('input[type="file"]');
    const open = vi.spyOn(picker as HTMLInputElement, 'click').mockImplementation(() => undefined);

    attachButton(section)?.click();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('uploads the picked file, holds Send until it lands, and the sent comment carries it', async () => {
    const { api, blocks, uploads, uploadByFile } = harness();
    const { section } = mount(api);
    const input = inputOf(section);
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' });

    input.value = 'see this';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    pick(section, file);

    expect(uploadByFile).toHaveBeenCalledWith(file, { kind: 'file', tool: 'database' });
    expect(pending(section).map((chip) => chip.textContent?.trim())).toEqual(['plan.pdf']);
    expect(pending(section)[0].getAttribute('aria-busy')).toBe('true');
    expect(send(section)?.disabled).toBe(true);

    uploads[0].resolve({ url: 'https://files.test/plan.pdf' });
    await flush();
    expect(pending(section)[0].getAttribute('aria-busy')).toBeNull();
    expect(send(section)?.disabled).toBe(false);
    send(section)?.click();

    expect(blocks[0].data).toMatchObject({ text: 'see this', attachments: [{ url: 'https://files.test/plan.pdf', name: 'plan.pdf' }] });
    expect(pending(section)).toHaveLength(0);
  });

  it('a failed upload drops its chip', async () => {
    const { api, uploads } = harness();
    const { section } = mount(api);

    pick(section, new File(['x'], 'a.txt'));
    uploads[0].reject(new Error('no'));
    await flush();

    expect(pending(section)).toHaveLength(0);
  });

  it('a chip\'s remove button takes the file out of the comment', async () => {
    const { api, blocks, uploads } = harness();
    const { section } = mount(api);
    const input = inputOf(section);

    pick(section, new File(['x'], 'a.txt'));
    uploads[0].resolve({ url: 'https://files.test/a.txt' });
    await flush();
    pending(section)[0].querySelector<HTMLButtonElement>('button')?.click();
    input.value = 'hi';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    send(section)?.click();

    expect(pending(section)).toHaveLength(0);
    expect(blocks[0].data).not.toHaveProperty('attachments');
  });

  it('an upload that lands after the box went away writes nothing', async () => {
    const { api, uploads } = harness();
    const { ui, section } = mount(api);

    pick(section, new File(['x'], 'late.txt'));
    ui.destroy();
    uploads[0].resolve({ url: 'https://files.test/late.txt' });
    await flush();

    expect(pending(section)).toHaveLength(0);
  });

  it('read-only shows no Attach file', () => {
    expect(attachButton(mount(harness().api, true).section)).toBeNull();
  });
});

describe('a comment with files', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const seeded = (attachments: unknown): HTMLElement => {
    const { api, blocks } = harness();

    blocks.push({ id: 'c1', name: 'database-comment', parentId: 'r1', data: { text: 'see', createdAt: 1, attachments } as DatabaseCommentData });

    return mount(api).section;
  };

  it('lists each file as a link under the text', () => {
    const section = seeded([{ url: 'https://files.test/plan.pdf', name: 'plan.pdf' }]);
    const link = section.querySelector<HTMLAnchorElement>('[data-blok-database-comment-file]');

    expect(link?.textContent?.trim()).toBe('plan.pdf');
    expect(link?.getAttribute('href')).toBe('https://files.test/plan.pdf');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a file with a script URL gets no link', () => {
    const section = seeded([{ url: 'javascript:alert(1)', name: 'x' }]);
    const link = section.querySelector('[data-blok-database-comment-file]');

    expect(link?.hasAttribute('href') ?? false).toBe(false);
  });
});

describe('database-comment attachments data', () => {
  it('the tool keeps only files with a url and a name', () => {
    const tool = new DatabaseCommentTool({
      data: {
        text: 'hi',
        createdAt: 1,
        attachments: [{ url: 'https://f.test/a', name: 'a' }, { url: '', name: 'b' }, { url: 'https://f.test/c' }, 'x'],
      } as unknown as DatabaseCommentData,
    } as never);

    expect(tool.save().attachments).toEqual([{ url: 'https://f.test/a', name: 'a' }]);
  });

  it('the sanitizer keeps a file name byte for byte', () => {
    const attachments = [{ url: 'https://f.test/a', name: 'Q&A <draft>.pdf' }];
    const [block] = sanitizeBlocks([{ tool: 'database-comment', data: { text: 'hi', createdAt: 1, attachments } }], databaseCommentSanitize());

    expect(block.data.attachments).toEqual(attachments);
  });

  it('the agent schema describes attachments', () => {
    expect(DATABASE_COMMENT_DATA.properties).toHaveProperty('attachments');
  });

  // No uploader.delete on comment delete: the session's orphan sweep removes a file once no saved block names it, which undo survives.
  it('the orphan sweep keeps a file a saved comment names and deletes it once the comment is gone', async () => {
    const remove = vi.fn(async () => undefined);
    const sweep = createOrphanSweep();
    const comment = { id: 'c1', type: 'database-comment', data: { text: 'see', createdAt: 1, attachments: [{ url: 'https://f.test/a.pdf', name: 'a.pdf' }] } };

    sweep.record('https://f.test/a.pdf', remove);
    await sweep.sweep({ blocks: [comment] }, sweep.beginSave());
    expect(remove).not.toHaveBeenCalled();
    await sweep.sweep({ blocks: [] }, sweep.beginSave());
    expect(remove).toHaveBeenCalledWith('https://f.test/a.pdf');
  });
});
