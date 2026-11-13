import { afterEach, expect, it, vi } from 'vitest';
import { openPageCreation, openPageSearch } from './navigation-dialogs';

afterEach(() => {
  document.querySelector<HTMLButtonElement>('[data-navigation-close]')?.click();
  document.body.replaceChildren();
});

it('searches authorized titles, shows ancestry and opens the keyboard-selected result', () => {
  const onOpen = vi.fn();
  openPageSearch({ workspaceName: 'Équipe', onOpen, pages: () => [
    { id: 'a', title: 'Guide', parentId: null },
    { id: 'b', title: 'Installer', parentId: 'a' },
    { id: 'c', title: 'Installation avancée', parentId: 'a' },
  ] });
  const input = document.querySelector<HTMLInputElement>('input')!;
  expect(document.activeElement).toBe(input);
  input.value = 'install'; input.dispatchEvent(new Event('input'));
  expect(document.querySelectorAll('[data-navigation-result]')).toHaveLength(2);
  expect(document.querySelector('[data-navigation-result-path]')?.textContent).toBe('Équipe / Guide');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(onOpen).toHaveBeenCalledWith('c');
  expect(document.querySelector('[data-navigation-dialog]')).toBeNull();
});

it('does not open a result removed by a permissions refresh', () => {
  const onOpen = vi.fn();
  let pages = [{ id: 'secret', title: 'Privé', parentId: null }];
  openPageSearch({ workspaceName: 'Équipe', onOpen, pages: () => pages });
  pages = [];
  document.querySelector<HTMLButtonElement>('[data-navigation-result]')!.click();
  expect(onOpen).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[data-navigation-result]')).toHaveLength(0);
  expect(document.querySelector<HTMLElement>('[data-navigation-empty]')!.hidden).toBe(false);
});

it('keeps the private destination when creating a database and releases the modal', () => {
  const onCreate = vi.fn();
  const destination = { value: 'private', label: 'Privé', parentId: null, privatePage: true };
  openPageCreation({ destinations: [destination], destination: 'private', onCreate });
  document.querySelectorAll<HTMLButtonElement>('[data-navigation-create-option]')[1].click();
  expect(onCreate).toHaveBeenCalledWith(destination, true);
  expect(document.querySelector('[data-navigation-dialog]')).toBeNull();
});
