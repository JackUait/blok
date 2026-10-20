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

const mount = async (
  data: OutputBlockData[],
  forms?: DatabaseConfig['forms'],
  readOnly = false,
  extra: { user?: { id: string }; config?: DatabaseConfig } = {},
): Promise<void> => {
  editor?.destroy();
  class ConfiguredDatabase extends DatabaseTool {
    constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
      super({ ...options, config: { ...extra.config, ...(forms === undefined ? {} : { forms }) } });
    }
  }

  editor = new Blok({
    holder, readOnly, dataModel: 'hierarchical',
    ...(extra.user === undefined ? {} : { user: extra.user }),
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

  // research/23 §6: the respondent's form starts with the pill; the builder does not change.
  it('a respondent sees "Submitting response anonymously" first when answers are anonymous', async () => {
    await mount(blocks({ anonymous: true }), host(), true);

    const pill = need('[data-blok-database-form-anonymous]');

    expect(pill.textContent).toBe('Submitting response anonymously');
    expect(need('[data-blok-database-form]').firstElementChild).toBe(pill);
    need('[data-blok-database-form-submit]').click();
    expect(q('[data-blok-database-form-done]')).not.toBeNull();
    expect(q('[data-blok-database-form-anonymous]')).toBeNull();
  });

  // research/23 §6: the thank-you screen offers "View my response" and "Email me a copy".
  describe('thank-you screen', () => {
    const submitAs = (name: string): void => {
      need<HTMLInputElement>('[id="blok-form-form-title"]').value = name;
      need('[data-blok-database-form-submit]').click();
    };
    const viewResponse = (): HTMLButtonElement | null => q<HTMLButtonElement>(byTestId('database-form-view-response'));
    const emailCopy = (): HTMLButtonElement | null => q<HTMLButtonElement>(byTestId('database-form-email-copy'));

    it('"View my response" opens the row the answer became', async () => {
      await mount(blocks(), host());
      submitAs('Ada');

      expect(viewResponse()?.textContent).toBe('View my response');
      viewResponse()?.click();
      await vi.waitFor(() => expect(q('[data-blok-database-drawer][data-open]')).not.toBeNull());
      expect(need<HTMLTextAreaElement>('[data-blok-database-drawer] [data-blok-database-drawer-title]').value).toBe('Ada');
    });

    it('offers no "View my response" in read-only, where Blok stores no row', async () => {
      await mount(blocks(), host(), true);
      submitAs('Ada');

      expect(q('[data-blok-database-form-done]')).not.toBeNull();
      expect(viewResponse()).toBeNull();
    });

    it('"Email me a copy" hands the submission to the host\'s emailCopy', async () => {
      const emailCopyHook = vi.fn();

      await mount(blocks({ anonymous: true }), host({ emailCopy: emailCopyHook }), true);
      submitAs('Ada');

      expect(emailCopy()?.textContent).toBe('Email me a copy');
      emailCopy()?.click();
      expect(emailCopyHook).toHaveBeenCalledWith(expect.objectContaining({
        databaseId: 'db',
        viewId: 'form',
        values: { title: 'Ada' },
        sharing: { public: false, anonymous: true, submissionAccess: 'none' },
      }));
    });

    it('offers no "Email me a copy" without the host\'s emailCopy', async () => {
      await mount(blocks(), host());
      submitAs('Ada');

      expect(q('[data-blok-database-form-done]')).not.toBeNull();
      expect(emailCopy()).toBeNull();
    });

    it('drops both after "Submit another response"', async () => {
      await mount(blocks(), host({ emailCopy: vi.fn() }));
      submitAs('Ada');
      need('[data-blok-database-form-again]').click();

      expect(viewResponse()).toBeNull();
      expect(emailCopy()).toBeNull();
    });
  });

  // research/23 §6: an anonymous answer is a row with no author; Created by reads "Anonymous".
  describe('anonymous answers', () => {
    const withAuthorColumns = (form?: FormSettings): OutputBlockData[] => blocks(form).map((block) => ({
      ...block,
      data: {
        ...(block.data as DatabaseData),
        schema: [
          ...schema,
          { id: 'who', name: 'Who', type: 'createdBy', position: 'a1' },
          { id: 'owner', name: 'Owner', type: 'person', position: 'a2', person: { default: 'createdBy' } },
        ],
      },
    }));
    const people = { list: async () => [{ id: 'u-ada', name: 'Ada' }], me: () => 'u-ada' };
    const submitAndSave = async (form?: FormSettings): Promise<OutputBlockData | undefined> => {
      await mount(withAuthorColumns(form), host(), false, { user: { id: 'u-ada' }, config: { people } });
      need<HTMLInputElement>('[id="blok-form-form-title"]').value = 'Resp';
      need('[data-blok-database-form-submit]').click();
      const saved = await editor?.save();

      return saved?.blocks.find((block) => block.type === 'database-row');
    };

    it('stores the row with no author and marks it anonymous', async () => {
      const row = await submitAndSave({ anonymous: true });

      expect(row?.createdBy).toBeUndefined();
      expect(row?.lastEditedBy).toBeUndefined();
      expect(row?.data).toEqual(expect.objectContaining({ anonymous: true }));
      expect((row?.data as { properties: Record<string, unknown> }).properties.owner ?? []).toEqual([]);
    });

    it('keeps the author of an answer that is not anonymous', async () => {
      const row = await submitAndSave();

      expect(row?.createdBy).toBe('u-ada');
      expect(row?.data).not.toHaveProperty('anonymous');
      expect((row?.data as { properties: Record<string, unknown> }).properties.owner).toEqual([{ id: 'u-ada' }]);
    });

    it('shows "Anonymous" in the row\'s Created by cell', async () => {
      await submitAndSave({ anonymous: true });
      need('[data-blok-database-tab][data-view-id="table"]').click();

      await vi.waitFor(() => expect(q('[data-blok-database-cell="createdBy"]')).not.toBeNull());
      const cell = need('[data-blok-database-cell="createdBy"]');

      expect(cell.textContent).toBe('Anonymous');
      expect(cell.querySelector('[data-blok-database-person-chip][data-anonymous]')).not.toBeNull();
    });
  });

  it('shows no anonymous pill to a respondent of a form that is not anonymous', async () => {
    await mount(blocks(), host(), true);

    expect(q('[data-blok-database-form-anonymous]')).toBeNull();
  });

  it('keeps the builder free of the anonymous pill', async () => {
    await mount(blocks({ anonymous: true }), host());

    expect(q('[data-blok-database-form-access]')).not.toBeNull();
    expect(q('[data-blok-database-form-anonymous]')).toBeNull();
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
