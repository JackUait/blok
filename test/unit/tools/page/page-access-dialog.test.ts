import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTool } from '../../../../src/tools/page';
import type { PageConfig, PageData, PageInfo } from '../../../../src/tools/page/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const translations: Record<string, string> = {
  'tools.page.unresolved': 'Page',
  'tools.page.noAccess': 'No access',
  'tools.page.missing': 'Page not found',
  'tools.page.accessDialogTitle': 'You cannot open this page',
  'tools.page.accessDialogBody': 'Ask the page owner for access.',
  'tools.page.accessDialogClose': 'Close',
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const makeTool = (config: PageConfig, data: PageData = { pageId: 'private' }, readOnly = false): PageTool =>
  new PageTool({
    api: {
      i18n: { t: (key: string) => translations[key] ?? key, has: () => true },
    } as unknown as API,
    block: { dispatchChange: vi.fn() } as never,
    config,
    data,
    readOnly,
    origin: 'load',
  } satisfies BlockToolConstructorOptions<PageData, PageConfig>);

const mount = async (tool: PageTool): Promise<HTMLElement> => {
  const root = tool.render();

  document.body.append(root);
  tool.rendered();
  await flush();

  return root;
};

const linkOf = (root: HTMLElement): HTMLAnchorElement => {
  const link = root.querySelector<HTMLAnchorElement>('[data-blok-testid="page-link"]');

  if (link === null) {
    throw new Error('Page link not rendered');
  }

  return link;
};

const dialogOf = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');

describe('Page access denial', () => {
  const tools: PageTool[] = [];
  const track = (tool: PageTool): PageTool => {
    tools.push(tool);

    return tool;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    tools.splice(0).forEach((tool) => tool.destroy());
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows a lock and no restricted title or icon for a denied page', async () => {
    const href = vi.fn(() => '/pages/private');
    const root = await mount(track(makeTool(
      { resolve: () => ({ access: 'none', title: 'Private plan', icon: { type: 'emoji', value: '🔐' } }), href },
      { pageId: 'private', cache: { title: 'Old secret', icon: { type: 'emoji', value: '🔑' } } }
    )));
    const link = linkOf(root);
    const icon = root.querySelector<HTMLElement>('[data-blok-testid="page-icon"]');

    expect(link.getAttribute('data-blok-page-state')).toBe('no-access');
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.getAttribute('role')).toBe('button');
    expect(link.getAttribute('aria-haspopup')).toBe('dialog');
    expect(link.getAttribute('aria-disabled')).toBeNull();
    expect(link.className).toContain('cursor-pointer');
    expect(href).not.toHaveBeenCalled();
    expect(root.textContent).toContain('No access');
    expect(root.textContent).not.toContain('Private plan');
    expect(root.textContent).not.toContain('Old secret');
    expect(root.textContent).not.toContain('🔐');
    expect(root.textContent).not.toContain('🔑');
    expect(icon?.querySelector('svg rect')).not.toBeNull();
  });

  it('opens one localized, accessible dialog on a denied click without navigating', async () => {
    const open = vi.fn();
    const href = vi.fn(() => '/pages/private');
    const root = await mount(track(makeTool({ resolve: () => ({ access: 'none' }), open, href })));
    const trigger = document.createElement('button');

    document.body.prepend(trigger);
    trigger.focus();
    linkOf(root).click();
    linkOf(root).click();

    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[0];
    const titleId = dialog?.getAttribute('aria-labelledby');
    const bodyId = dialog?.getAttribute('aria-describedby');

    expect(dialogs).toHaveLength(1);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(titleId).toBeTruthy();
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(titleId ?? '')?.textContent).toBe('You cannot open this page');
    expect(document.getElementById(bodyId ?? '')?.textContent).toBe('Ask the page owner for access.');
    expect(dialog?.querySelector('button')?.textContent).toBe('Close');
    expect(dialog?.querySelector('button')).toHaveFocus();
    expect(open).not.toHaveBeenCalled();
    expect(href).not.toHaveBeenCalled();
  });

  it('opens the denial dialog on navigation Enter and restores focus after Escape', async () => {
    const open = vi.fn();
    const href = vi.fn(() => '/pages/private');
    const root = await mount(track(makeTool({ resolve: () => ({ access: 'none' }), open, href })));
    const trigger = document.createElement('button');

    document.body.prepend(trigger);
    trigger.focus();

    const consumed = tools[0]?.onNavigationEnter(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(consumed).toBe(true);
    expect(dialogOf()).not.toBeNull();
    expect(dialogOf()?.querySelector('button')).toHaveFocus();

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(dialogOf()).toBeNull();
    expect(trigger).toHaveFocus();
    expect(linkOf(root).hasAttribute('href')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(href).not.toHaveBeenCalled();
  });

  it('restores focus with Close and removes an open dialog when the tool is removed', async () => {
    const tool = track(makeTool({ resolve: () => ({ access: 'none' }) }));
    const root = await mount(tool);
    const trigger = document.createElement('button');

    document.body.prepend(trigger);
    trigger.focus();
    linkOf(root).click();

    dialogOf()?.querySelector('button')?.click();
    expect(dialogOf()).toBeNull();
    expect(trigger).toHaveFocus();

    linkOf(root).click();
    expect(dialogOf()).not.toBeNull();
    tool.removed();
    expect(dialogOf()).toBeNull();
  });

  it('closes the denial explanation when access is rechecked', async () => {
    let info: PageInfo = { access: 'none' };
    let notify: (() => void) | undefined;
    const tool = track(makeTool({
      resolve: () => info,
      subscribe: (_id, onChange) => { notify = onChange; },
    }));
    const root = await mount(tool);

    linkOf(root).click();
    expect(dialogOf()).not.toBeNull();

    info = { title: 'Now allowed' };
    notify?.();

    expect(dialogOf()).toBeNull();
    await flush();
    expect(root.textContent).toContain('Now allowed');
  });

  it('keeps missing and unresolved pages distinct and inert', async () => {
    const open = vi.fn();
    const href = vi.fn(() => '/pages/private');
    const missing = track(makeTool({ resolve: () => null, open, href }));
    const unresolved = track(makeTool({ resolve: () => undefined, open, href }));
    const missingRoot = await mount(missing);
    const unresolvedRoot = await mount(unresolved);

    expect(linkOf(missingRoot).getAttribute('data-blok-page-state')).toBe('missing');
    expect(missingRoot.textContent).toContain('Page not found');
    expect(linkOf(unresolvedRoot).getAttribute('data-blok-page-state')).toBe('unresolved');
    expect(unresolvedRoot.textContent).toContain('Page');

    for (const [tool, root] of [[missing, missingRoot], [unresolved, unresolvedRoot]] as const) {
      expect(linkOf(root).hasAttribute('href')).toBe(false);
      linkOf(root).click();
      expect(tool.onNavigationEnter(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
    }

    expect(dialogOf()).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(href).not.toHaveBeenCalled();
  });

  it('still opens an authorized page when the editor is read-only', async () => {
    const open = vi.fn();
    const tool = track(makeTool({ resolve: () => ({ title: 'Readable' }), open }, { pageId: 'readable' }, true));
    const root = await mount(tool);

    linkOf(root).click();
    expect(open).toHaveBeenCalledWith('readable', { event: expect.any(MouseEvent) });
    expect(dialogOf()).toBeNull();
  });

  it('never requests a hover preview for denied, missing, or unresolved pages', async () => {
    const preview = vi.fn(() => []);
    const roots = await Promise.all([
      mount(track(makeTool({ resolve: () => ({ access: 'none' }), preview }))),
      mount(track(makeTool({ resolve: () => null, preview }))),
      mount(track(makeTool({ resolve: () => undefined, preview }))),
    ]);

    vi.useFakeTimers();
    roots.forEach((root) => linkOf(root).dispatchEvent(new MouseEvent('mouseenter')));
    await vi.advanceTimersByTimeAsync(500);

    expect(preview).not.toHaveBeenCalled();
    expect(document.querySelector('[data-blok-testid="page-hover-preview"]')).toBeNull();
  });
});
