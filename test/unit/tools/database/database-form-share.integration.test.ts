import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseConfig, DatabaseData, FormSettings, PropertyDefinition } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok, OutputBlockData } from '../../../../types';

let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const byTestId = (id: string): string => `[data-blok-testid="${id}"]`;
const need = <T extends Element = HTMLElement>(selector: string): T => {
  const element = q<T>(selector);

  if (element === null) throw new Error(`Missing ${selector}`);

  return element;
};
const escape = (): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

const schema: PropertyDefinition[] = [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }];

const blocks = (form?: FormSettings): OutputBlockData[] => [{
  id: 'db', type: 'database', content: [],
  data: {
    schema,
    views: [
      {
        id: 'form', name: 'Form', type: 'form', position: 'a0', sorts: [], filters: [], visibleProperties: [],
        properties: [{ id: 'title', visible: true }], ...(form === undefined ? {} : { form }),
      },
      { id: 'table', name: 'Table', type: 'table', position: 'a1', sorts: [], filters: [], visibleProperties: [] },
    ],
    activeViewId: 'form',
  } satisfies DatabaseData,
}];

const mount = async (data: OutputBlockData[], forms?: DatabaseConfig['forms'], readOnly = false): Promise<void> => {
  editor?.destroy();
  class ConfiguredDatabase extends DatabaseTool {
    constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
      super({ ...options, config: forms === undefined ? {} : { forms } });
    }
  }

  editor = new Blok({
    holder, readOnly, dataModel: 'hierarchical',
    tools: { database: ConfiguredDatabase, 'database-row': DatabaseRowTool },
    data: { blocks: data },
  }) as unknown as PublicBlok;
  await editor.isReady;
  await vi.waitFor(() => expect(q('[data-blok-database-form]')).not.toBeNull());
};

const savedForm = async (): Promise<FormSettings | undefined> => {
  const saved = await editor?.save();

  return (saved?.blocks.find((block) => block.id === 'db')?.data as DatabaseData).views.find((view) => view.id === 'form')?.form;
};

const host = (extra: Partial<NonNullable<DatabaseConfig['forms']>> = {}): NonNullable<DatabaseConfig['forms']> => ({
  onSubmit: vi.fn(),
  workspaceName: 'Personal',
  link: () => 'https://forms.example.test/f/123',
  ...extra,
});

const shareShown = (): boolean => {
  const button = q(byTestId('database-toolbar-share-form'));

  return button !== null && button.closest('[hidden]') === null;
};

const share = (): HTMLElement => {
  need(byTestId('database-toolbar-share-form')).click();

  return need(byTestId('database-form-share'));
};

describe('form Share panel (research/19 §3d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    escape();
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('the builder says who can fill out the form, with "Change" opening the Share panel', async () => {
    await mount(blocks(), host());

    expect(need('[data-blok-database-form-access]').textContent).toContain('Only members at Personal can fill out this form.');
    need(byTestId('database-form-access-change')).click();
    expect(q(byTestId('database-form-share'))).not.toBeNull();
  });

  it('"Share form" sits in the toolbar of a form view only', async () => {
    await mount(blocks(), host());

    expect(need(byTestId('database-toolbar-share-form')).textContent).toBe('Share form');
    need('[data-blok-database-tab][data-view-id="table"]').click();
    await vi.waitFor(() => expect(q('[data-blok-database-form]')).toBeNull());
    expect(shareShown()).toBe(false);
  });

  it('lists the measured rows and defaults: workspace, anonymous off, no access, the host\'s link', async () => {
    const panel = (await mount(blocks(), host()), share());

    expect(need(byTestId('database-form-share-who')).textContent).toContain('Who can fill out');
    expect(need(byTestId('database-form-share-who')).textContent).toContain('Anyone at Personal with link');
    expect(need(byTestId('database-form-share-anonymous')).getAttribute('aria-checked')).toBe('false');
    expect(need(byTestId('database-form-share-anonymous')).textContent).toContain('Anonymous responses');
    expect(need(byTestId('database-form-share-access')).textContent).toContain('Access to submission');
    expect(need(byTestId('database-form-share-access')).textContent).toContain('No access');
    const link = need<HTMLInputElement>(byTestId('database-form-share-link'));

    expect(link.readOnly).toBe(true);
    expect(link.value).toBe('https://forms.example.test/f/123');
    expect(panel.textContent).toContain('Copy form link');
  });

  it('"Copy form link" copies the host\'s link', async () => {
    const writeText = vi.fn(async () => undefined);

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await mount(blocks(), host());
    share();
    need(byTestId('database-form-share-copy')).click();

    expect(writeText).toHaveBeenCalledWith('https://forms.example.test/f/123');
  });

  it('"Who can fill out" offers the workspace, Public and Closed; No access closes the form', async () => {
    await mount(blocks(), host());
    share();
    need(byTestId('database-form-share-who')).click();

    expect(need(byTestId('database-form-share-who-workspace')).getAttribute('aria-checked')).toBe('true');
    expect(need(byTestId('database-form-share-who-public')).textContent).toBe('Anyone on the web with linkPublic');
    expect(need(byTestId('database-form-share-who-closed')).textContent).toBe('No accessClosed');
    need(byTestId('database-form-share-who-closed')).click();
    escape();
    escape();

    expect(await savedForm()).toEqual({ closed: true });
    await vi.waitFor(() => expect(need('[data-blok-database-form-access]').textContent).toContain('No one can fill out this form.'));
    expect(q(byTestId('database-form-access-change'))).not.toBeNull();
  });

  it('"Anyone on the web with link" stores public', async () => {
    await mount(blocks({ closed: true }), host());
    share();
    need(byTestId('database-form-share-who')).click();
    need(byTestId('database-form-share-who-public')).click();
    escape();
    escape();

    expect(await savedForm()).toEqual({ public: true });
    await vi.waitFor(() => expect(need('[data-blok-database-form-access]').textContent).toContain('Anyone with the link can fill out this form.'));
  });

  it('stores anonymous responses and access to submission, and hands both to the host on submit', async () => {
    const forms = host();

    await mount(blocks(), forms);
    share();
    need(byTestId('database-form-share-anonymous')).click();
    need(byTestId('database-form-share-access')).click();
    expect([...document.querySelectorAll(`${byTestId('database-form-share')} [data-blok-testid^="database-form-share-access-"]`)]
      .map((row) => row.textContent?.trim())).toEqual(['No access', 'Can view', 'Can comment', 'Can edit', 'Full access']);
    need(byTestId('database-form-share-access-comment')).click();
    escape();
    escape();

    expect(await savedForm()).toEqual({ anonymous: true, submissionAccess: 'comment' });
    await vi.waitFor(() => expect(q(byTestId('database-form-share'))).toBeNull());
    need<HTMLInputElement>('[id="blok-form-form-title"]').value = 'Ada';
    need('[data-blok-database-form-submit]').click();

    expect(forms.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      sharing: { public: false, anonymous: true, submissionAccess: 'comment' },
    }));
  });

  it('without a forms host, only closing the form is offered, under a generic workspace label', async () => {
    await mount(blocks());

    expect(need('[data-blok-database-form-access]').textContent).toContain('Only workspace members can fill out this form.');
    share();
    expect(need(byTestId('database-form-share-who')).textContent).toContain('Anyone in the workspace with link');
    expect(q(byTestId('database-form-share-anonymous'))).toBeNull();
    expect(q(byTestId('database-form-share-access'))).toBeNull();
    expect(q(byTestId('database-form-share-link'))).toBeNull();
    need(byTestId('database-form-share-who')).click();
    expect(q(byTestId('database-form-share-who-public'))).toBeNull();
    expect(q(byTestId('database-form-share-who-closed'))).not.toBeNull();
  });

  it('a respondent in read-only sees no access bar and no Share form', async () => {
    await mount(blocks(), host(), true);

    expect(q('[data-blok-database-form-access]')).toBeNull();
    expect(shareShown()).toBe(false);
  });

  it('Escape leaves an option page first, then closes the panel', async () => {
    await mount(blocks(), host());
    share();
    need(byTestId('database-form-share-who')).click();
    escape();

    expect(q(byTestId('database-form-share-who-workspace'))).toBeNull();
    expect(q(byTestId('database-form-share'))).not.toBeNull();
    escape();
    expect(q(byTestId('database-form-share'))).toBeNull();
  });
});
