import { findByRole, fireEvent, queryAllByAttribute, queryByRole, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { DatabaseAutofillRequest, DatabaseConfig, DatabaseData } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok, OutputBlockData } from '../../../../types';

let instance: Blok | undefined;
let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const autofill = vi.fn((_request: DatabaseAutofillRequest): Promise<undefined> => Promise.resolve(undefined));

const mount = async (withRow = false): Promise<void> => {
  const database: DatabaseData = {
    title: 'Basic setup',
    schema: [
      { id: 'name', name: 'Name', type: 'title', position: 'a0' },
      { id: 'status', name: 'Status', type: 'status', position: 'a1' },
      { id: 'text', name: 'Text', type: 'text', position: 'a2' },
    ],
    views: [{
      id: 'table', name: 'Table', type: 'table', position: 'a0',
      sorts: [], filters: [], visibleProperties: ['status', 'text'],
    }],
    activeViewId: 'table',
  };
  const blocks: OutputBlockData[] = [{
    id: 'db', type: 'database', data: database, content: withRow ? ['row'] : [],
  }];

  if (withRow) {
    blocks.push({
      id: 'row', type: 'database-row', parent: 'db',
      data: { position: 'a0', properties: { name: 'Keep this name', text: 'Keep this text' } },
    });
  }

  const config = { ai: { autofill } } satisfies DatabaseConfig;

  instance = new Blok({
    holder, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
    onReady: (ready) => { editor = ready; },
  });
  await instance.isReady;
  if (holder === undefined) throw new Error('Missing editor holder');
  await findByRole(holder, 'columnheader', { name: 'Text' });
};

const FOCUSABLE = 'a[href], area[href], button, input, select, textarea, iframe, summary, [contenteditable=""], [contenteditable="true"], [tabindex]';

// A browser focuses the nearest focusable ancestor on mousedown, or blurs to body when there is none.
const focusTarget = (target: Element): HTMLElement | null => {
  const found = target.closest(FOCUSABLE);

  if (!(found instanceof HTMLElement)) return null;
  if (found.matches(':disabled')) return null;

  return found;
};

// fireEvent.click never moves focus. The dialog's focus trap reacts to the focus a real press makes.
const user = {
  click: async (target: Element): Promise<void> => {
    const init = { bubbles: true, cancelable: true, composed: true, button: 0 };

    fireEvent.pointerDown(target, init);
    if (fireEvent.mouseDown(target, init)) {
      const next = focusTarget(target);

      if (next !== null) {
        next.focus();
      } else if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
    // A real press lasts a moment. The menu tears down in that gap, which is when the trap bug bites.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // jsdom cannot hit-test. If the press removed the target, the release and the click land on body, as in a browser.
    const release = target.isConnected ? target : document.body;

    fireEvent.pointerUp(release, init);
    fireEvent.mouseUp(release, init);
    fireEvent.click(release, init);
  },
  press: async (key: string): Promise<void> => {
    const active = document.activeElement ?? document.body;

    fireEvent.keyDown(active, { key, code: key, bubbles: true, cancelable: true });
    fireEvent.keyUp(document.activeElement ?? document.body, { key, code: key, bubbles: true, cancelable: true });
    await Promise.resolve();
  },
};

const savedBlocks = async (): Promise<OutputBlockData[]> => {
  if (editor === undefined) throw new Error('Missing ready editor');

  return (await editor.save()).blocks;
};

const openTextMenu = async (): Promise<void> => {
  if (holder === undefined) throw new Error('Missing editor holder');
  fireEvent.click(await findByRole(holder, 'columnheader', { name: 'Text' }));
};

const openBasic = async (): Promise<HTMLElement> => {
  await openTextMenu();
  fireEvent.click(await findByRole(document.body, 'menuitem', { name: /^AI Autofill(?:\s|$)/ }));
  fireEvent.click(await findByRole(document.body, 'menuitem', { name: /^Basic(?:\s|$)/ }));

  return findByRole(document.body, 'dialog');
};

const instructions = (dialog: HTMLElement): string => {
  const field = within(dialog).getByRole('textbox', { name: 'Instructions' });

  return (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
    ? field.value
    : field.textContent ?? '').trim();
};

const chooseParagraph = async (dialog: HTMLElement): Promise<HTMLElement> => {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Summarize' }));
  fireEvent.click(await findByRole(document.body, 'menuitem', { name: 'Paragraph' }));

  return findByRole(document.body, 'dialog');
};

const expectNoWrites = async (before: OutputBlockData[]): Promise<void> => {
  expect(await savedBlocks()).toEqual(before);
  expect(autofill).not.toHaveBeenCalled();
};

describe('Basic AI setup through the Text property menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    instance?.destroy();
    instance = undefined;
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.replaceChildren();
    Reflect.deleteProperty(document, 'elementFromPoint');
    vi.restoreAllMocks();
  });

  it('opens Basic setup without writing the existing row or active settings', async () => {
    await mount(true);
    const before = await savedBlocks();
    const dialog = await openBasic();

    await expectNoWrites(before);
    expect(within(dialog).getByRole('textbox', { name: 'Instructions' })).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: 'Basic' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('button', { name: 'Translate' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Summarize' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'On page creation None' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'On page update None' })).toBeInTheDocument();
  });

  // The dialog mounts on body, outside the editor: the popover scope gives it the editor font and preflight.
  it('mounts the setup under a data-blok-popover root', async () => {
    await mount(true);
    const dialog = await openBasic();

    const roots = queryAllByAttribute('data-blok-popover', document.body, '');

    expect(roots.some((root) => root.contains(dialog))).toBe(true);
  });

  it.each([
    ['On page creation', 'onCreate'],
    ['On page update', 'onEdit'],
  ] as const)('picking Autofill in %s shows it on the row, and Save writes it', async (label, key) => {
    await mount();
    const dialog = await chooseParagraph(await openBasic());

    // jsdom lacks it, and rectangle selection reads it on every mousedown.
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });

    await user.click(within(dialog).getByRole('button', { name: `${label} None` }));
    await user.click(await findByRole(document.body, 'menuitemcheckbox', { name: 'Autofill' }));

    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: `${label} Autofill` })).toBeInTheDocument());
    await vi.waitFor(() => expect(queryByRole(document.body, 'menuitemcheckbox', { name: 'Autofill' })).toBeNull());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    const database = (await savedBlocks()).find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const text = database?.schema.find((property) => property.id === 'text');

    expect(text?.autofill?.[key]).toBe(true);
  });

  it.each([
    ['On page creation None', 'menuitemcheckbox', 'Autofill', 'On page creation Autofill'],
    ['On page update None', 'menuitemcheckbox', 'Autofill', 'On page update Autofill'],
    ['Summarize', 'menuitem', 'Paragraph', 'Summarize'],
  ] as const)('a mouse pick in the %s menu returns focus to its trigger', async (trigger, role, item, after) => {
    await mount();
    const dialog = await openBasic();

    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });

    await user.click(within(dialog).getByRole('button', { name: trigger }));
    await user.click(await findByRole(document.body, role, { name: item }));

    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: after })).toHaveFocus());
    await vi.waitFor(() => expect(queryByRole(document.body, role, { name: item })).toBeNull());
  });

  it.each([
    ['On page creation None', 'menuitemcheckbox', 'Autofill'],
    ['Summarize', 'menuitem', 'Paragraph'],
  ] as const)('one Escape closes only the %s menu, a second closes the setup', async (trigger, role, item) => {
    await mount();
    const dialog = await openBasic();

    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });

    await user.click(within(dialog).getByRole('button', { name: trigger }));
    await findByRole(document.body, role, { name: item });
    await user.press('Escape');

    expect(dialog).toBeInTheDocument();
    await vi.waitFor(() => expect(queryByRole(document.body, role, { name: item })).toBeNull());
    expect(within(dialog).getByRole('button', { name: trigger })).toHaveFocus();

    await user.press('Escape');

    expect(dialog).not.toBeInTheDocument();
  });

  it('disables Save, Generate and Run for empty instructions in the empty-row fixture', async () => {
    await mount();
    const before = await savedBlocks();
    const dialog = await openBasic();

    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Generate' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Run AI Autofill now' })).toBeDisabled();
    expect(instructions(dialog)).toBe('');
    expect(within(dialog).getByRole('button', { name: 'On page creation None' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'On page update None' })).toBeInTheDocument();
    await expectNoWrites(before);
  });

  it('Paragraph fills a draft without saving settings or invoking the provider', async () => {
    await mount();
    const before = await savedBlocks();
    const dialog = await openBasic();

    const filled = await chooseParagraph(dialog);

    await vi.waitFor(() => expect(instructions(filled)).not.toBe(''));
    await vi.waitFor(() => expect(queryByRole(document.body, 'menuitem', { name: 'Paragraph' })).toBeNull());
    expect(within(filled).getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(within(filled).getByRole('button', { name: 'Generate' })).toBeEnabled();
    expect(within(filled).getByRole('button', { name: 'Run AI Autofill now' })).toBeDisabled();
    expect(within(filled).getByRole('button', { name: 'On page creation None' })).toBeInTheDocument();
    expect(within(filled).getByRole('button', { name: 'On page update None' })).toBeInTheDocument();
    await expectNoWrites(before);
  });

  it('Close keeps the Paragraph draft when reopened in the same editor', async () => {
    await mount();
    const before = await savedBlocks();
    const dialog = await openBasic();

    const filled = await chooseParagraph(dialog);
    await vi.waitFor(() => expect(instructions(filled)).not.toBe(''));
    const draft = instructions(filled);

    fireEvent.click(within(filled).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(filled).not.toBeInTheDocument());
    await openTextMenu();
    fireEvent.click(await findByRole(document.body, 'menuitem', { name: 'Autofill Text' }));
    const reopened = await findByRole(document.body, 'dialog');

    expect(instructions(reopened)).toBe(draft);
    expect(within(reopened).getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(within(reopened).getByRole('button', { name: 'Generate' })).toBeEnabled();
    expect(within(reopened).getByRole('button', { name: 'Run AI Autofill now' })).toBeDisabled();
    expect(within(reopened).getByRole('button', { name: 'On page creation None' })).toBeInTheDocument();
    expect(within(reopened).getByRole('button', { name: 'On page update None' })).toBeInTheDocument();
    await expectNoWrites(before);
  });

  it('confirmed Discard clears the Paragraph draft while setup stays open', async () => {
    await mount();
    const before = await savedBlocks();
    const dialog = await openBasic();

    const filled = await chooseParagraph(dialog);
    await vi.waitFor(() => expect(instructions(filled)).not.toBe(''));
    fireEvent.click(within(filled).getByRole('button', { name: 'Discard changes' }));
    const confirmation = await findByRole(document.body, 'dialog', { name: /discard.*changes/i });

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard changes' }));
    await vi.waitFor(() => expect(confirmation).not.toBeInTheDocument());
    const reset = await findByRole(document.body, 'dialog');

    expect(instructions(reset)).toBe('');
    expect(within(reset).getByRole('button', { name: 'On page creation None' })).toBeInTheDocument();
    expect(within(reset).getByRole('button', { name: 'On page update None' })).toBeInTheDocument();
    expect(within(reset).getByRole('button', { name: 'Generate' })).toBeDisabled();
    expect(within(reset).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(within(reset).getByRole('button', { name: 'Run AI Autofill now' })).toBeDisabled();
    await expectNoWrites(before);
  });
});
