import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openModalDialog } from '../../../../src/components/utils/modal-dialog';
import { PopoverDesktop } from '../../../../src/components/utils/popover/popover-desktop';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';

// jsdom lacks the HTML Popover API; stub the minimal shape promoteToTopLayer needs.
beforeEach(() => {
  vi.clearAllMocks();
  if (!('popover' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      get(this: HTMLElement) { return this.getAttribute('popover'); },
      set(this: HTMLElement, v: string) { this.setAttribute('popover', v); },
    });
  }
  if (typeof (HTMLElement.prototype as unknown as { showPopover?: () => void }).showPopover !== 'function') {
    (HTMLElement.prototype as unknown as { showPopover: () => void }).showPopover = function showPopover() {};
    (HTMLElement.prototype as unknown as { hidePopover: () => void }).hidePopover = function hidePopover() {};
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

interface BuiltDialog {
  content: HTMLElement;
  surface: HTMLElement;
  first: HTMLButtonElement;
  last: HTMLButtonElement;
}

const buildDialog = (): BuiltDialog => {
  const content = document.createElement('div');
  const surface = document.createElement('div');
  const first = document.createElement('button');
  const last = document.createElement('button');

  first.textContent = 'First';
  last.textContent = 'Last';
  surface.append(first, last);
  content.appendChild(surface);

  return { content, surface, first, last };
};

describe('openModalDialog', () => {
  it('sets dialog role, aria-modal, label and describedby on the surface', () => {
    const { content, surface } = buildDialog();
    const handle = openModalDialog({
      content,
      surface,
      role: 'alertdialog',
      label: 'My dialog',
      describedBy: 'desc-1',
      onDismiss: vi.fn(),
    });

    expect(surface.getAttribute('role')).toBe('alertdialog');
    expect(surface.getAttribute('aria-modal')).toBe('true');
    expect(surface.getAttribute('aria-label')).toBe('My dialog');
    expect(surface.getAttribute('aria-describedby')).toBe('desc-1');
    handle.close();
  });

  it('takes its direction from directionSource, else from its anchor', () => {
    const rtl = document.createElement('button');

    rtl.style.direction = 'rtl';
    document.body.appendChild(rtl);

    const fromSource = buildDialog();
    const sourced = openModalDialog({ ...fromSource, directionSource: rtl, onDismiss: vi.fn() });

    expect(fromSource.content.getAttribute('dir')).toBe('rtl');
    sourced.close();

    const fromAnchor = buildDialog();
    const anchored = openModalDialog({ ...fromAnchor, anchor: rtl, onDismiss: vi.fn() });

    expect(fromAnchor.content.getAttribute('dir')).toBe('rtl');
    anchored.close();
  });

  it('appends content to document.body and promotes it to the Top Layer', () => {
    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    expect(content.parentElement).toBe(document.body);
    expect(content.getAttribute('data-blok-top-layer')).toBe('true');
    handle.close();
    expect(content.getAttribute('data-blok-top-layer')).toBeNull();
    expect(content.isConnected).toBe(false);
  });

  it('applies inert to sibling body children while open and removes it on close', () => {
    const sibling = document.createElement('div');

    document.body.appendChild(sibling);

    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    expect(sibling.hasAttribute('inert')).toBe(true);
    expect(content.hasAttribute('inert')).toBe(false);

    handle.close();
    expect(sibling.hasAttribute('inert')).toBe(false);
  });

  it('does not clobber inert that was already present before opening', () => {
    const sibling = document.createElement('div');

    sibling.setAttribute('inert', '');
    document.body.appendChild(sibling);

    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.close();
    // Pre-existing inert must survive our teardown.
    expect(sibling.hasAttribute('inert')).toBe(true);
  });

  it('traps Tab focus, wrapping within the surface', () => {
    const { content, surface, first, last } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(first).toHaveFocus();

    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(last).toHaveFocus();

    handle.close();
  });

  it('pulls focus back inside when focus escapes the surface', () => {
    const outside = document.createElement('button');

    document.body.appendChild(outside);

    const { content, surface, first } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    // Simulate focus escaping to an element outside the dialog surface.
    outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(first).toHaveFocus();
    handle.close();
  });

  it('moves initial focus to the resolved initialFocus target after a microtask', async () => {
    const { content, surface, last } = buildDialog();
    const handle = openModalDialog({
      content,
      surface,
      initialFocus: () => last,
      onDismiss: vi.fn(),
    });

    await Promise.resolve();
    expect(last).toHaveFocus();
    handle.close();
  });

  it('dismisses with reason "escape" via the shared dismissal layer', () => {
    const { content, surface } = buildDialog();
    const onDismiss = vi.fn();
    const handle = openModalDialog({ content, surface, onDismiss });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('escape');
    handle.close();
  });

  it('dismisses with reason "outside" on outside pointerdown', () => {
    const outside = document.createElement('div');

    document.body.appendChild(outside);

    const { content, surface } = buildDialog();
    const onDismiss = vi.fn();
    const handle = openModalDialog({ content, surface, onDismiss });

    const event = new PointerEvent('pointerdown', { bubbles: true });

    Object.defineProperty(event, 'target', { value: outside });
    document.dispatchEvent(event);

    expect(onDismiss).toHaveBeenCalledWith('outside');
    handle.close();
  });

  it('does not dismiss on outside pointerdown when outside is disabled', () => {
    const outside = document.createElement('div');

    document.body.appendChild(outside);

    const { content, surface } = buildDialog();
    const onDismiss = vi.fn();
    const handle = openModalDialog({ content, surface, onDismiss, outside: false });

    const event = new PointerEvent('pointerdown', { bubbles: true });

    Object.defineProperty(event, 'target', { value: outside });
    document.dispatchEvent(event);

    expect(onDismiss).not.toHaveBeenCalled();
    handle.close();
  });

  it('restores focus to the previously focused element only if still connected', () => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);
    trigger.focus();

    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.close();
    expect(trigger).toHaveFocus();
  });

  it('does not throw restoring focus when the previous element was removed', () => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);
    trigger.focus();

    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    trigger.remove();
    expect(() => handle.close()).not.toThrow();
  });

  it('close is idempotent', () => {
    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.close();
    expect(() => handle.close()).not.toThrow();
  });

  it('does not append when container is null (caller manages mounting)', () => {
    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, container: null, topLayer: false, onDismiss: vi.fn() });

    expect(content.isConnected).toBe(false);
    handle.close();
  });

  it('closeAnimated finalizes immediately in jsdom (no animation engine)', () => {
    const { content, surface } = buildDialog();
    const onClose = vi.fn();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn(), onClose });

    handle.closeAnimated();
    expect(content.isConnected).toBe(false);
    expect(content.getAttribute('data-blok-closing')).toBe('true');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('focus outside the surface that the trap leaves alone', () => {
    const popovers: PopoverDesktop[] = [];

    beforeEach(() => {
      PopoverRegistry.resetForTests();
    });

    afterEach(() => {
      popovers.splice(0).forEach((popover) => popover.destroy());
      PopoverRegistry.resetForTests();
    });

    const openMenuFrom = (trigger: HTMLElement): HTMLElement => {
      const popover = new PopoverDesktop({ trigger, items: [{ title: 'Pick', onActivate: vi.fn() }] });

      popovers.push(popover);
      popover.show();

      const menu = popover.getElement().querySelector<HTMLElement>('[role="menu"]');

      if (menu === null) throw new Error('Missing menu');

      return menu;
    };

    it('lets focus move into a menu the dialog opened (it lives on body)', () => {
      const { content, surface, first } = buildDialog();
      const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });
      const menu = openMenuFrom(first);

      menu.focus();

      expect(menu).toHaveFocus();
      handle.close();
    });

    it('Escape closes a menu the dialog opened and keeps the dialog; the next Escape dismisses it', () => {
      const { content, surface, first } = buildDialog();
      const onDismiss = vi.fn();
      const handle = openModalDialog({ content, surface, onDismiss });
      const menu = openMenuFrom(first);
      // On an element: the menu's Flipper reads attributes off the key target.
      const escape = (): boolean => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      escape();

      expect(onDismiss).not.toHaveBeenCalled();
      expect(menu.isConnected && menu.closest('[data-blok-popover-opened]') !== null).toBe(false);
      expect(first).toHaveFocus();

      escape();

      expect(onDismiss).toHaveBeenCalledWith('escape');
      handle.close();
    });

    it('pulls focus back from a menu opened by a trigger outside the dialog', () => {
      const { content, surface, first } = buildDialog();
      const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });
      const stranger = document.createElement('button');

      document.body.appendChild(stranger);
      openMenuFrom(stranger).focus();

      expect(first).toHaveFocus();
      handle.close();
    });

    it('pulls focus back from an open-marked element on body that the dialog did not open', () => {
      const { content, surface, first } = buildDialog();
      const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });
      const stranger = document.createElement('div');
      const field = document.createElement('input');

      stranger.setAttribute('data-blok-popover-opened', '');
      stranger.appendChild(field);
      document.body.appendChild(stranger);

      field.focus();

      expect(first).toHaveFocus();
      handle.close();
    });

    it('keeps a nested dialog modal: focus in the outer dialog is pulled back into the inner one', () => {
      const outer = buildDialog();

      // The real setup and confirm backdrops carry it.
      outer.content.setAttribute('data-blok-popover', '');

      const outerHandle = openModalDialog({ content: outer.content, surface: outer.surface, onDismiss: vi.fn() });
      const inner = buildDialog();
      const innerHandle = openModalDialog({
        content: inner.content,
        surface: inner.surface,
        container: outer.surface,
        topLayer: false,
        onDismiss: vi.fn(),
      });

      outer.last.focus();

      expect(inner.first).toHaveFocus();
      innerHandle.close();
      outerHandle.close();
    });
  });
});
