import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startInlineRename } from '../../../../src/components/utils/inline-rename';
import { simulateKeydown } from '../../../helpers/simulate';

const makeTitle = (text: string): { container: HTMLElement; title: HTMLElement } => {
  const container = document.createElement('div');
  const title = document.createElement('div');

  title.setAttribute('data-title', '');
  title.textContent = text;
  container.appendChild(title);
  document.body.appendChild(container);

  return { container, title };
};

const buildRestored = (value: string): HTMLElement => {
  const div = document.createElement('div');

  div.setAttribute('data-title', '');
  div.textContent = value;

  return div;
};

describe('startInlineRename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('swaps the target for an input that is focused, selected and labelled', () => {
    const { container, title } = makeTitle('Todo');

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit: vi.fn(),
      buildRestored,
    });

    const input = container.querySelector('input');

    expect(input).not.toBeNull();
    expect(input?.value).toBe('Todo');
    expect(input?.getAttribute('aria-label')).toBe('Rename column');
    expect(input).toHaveFocus();
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe('Todo'.length);
    // Original display element removed in favour of the input
    expect(container.querySelector('div[data-title]')).toBeNull();
  });

  it('commits on Enter with the resolved value and swaps back the display element', () => {
    const { container, title } = makeTitle('Todo');
    const onCommit = vi.fn();

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit,
      buildRestored,
    });

    const input = container.querySelector('input')!;

    input.value = 'Done';
    simulateKeydown(input, 'Enter');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Done');
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('div[data-title]')?.textContent).toBe('Done');
  });

  it('commits on blur', () => {
    const { container, title } = makeTitle('Todo');
    const onCommit = vi.fn();

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit,
      buildRestored,
    });

    const input = container.querySelector('input')!;

    input.value = 'Later';
    input.dispatchEvent(new Event('blur'));

    expect(onCommit).toHaveBeenCalledWith('Later');
  });

  it('guards against double-commit (blur after Enter)', () => {
    const { container, title } = makeTitle('Todo');
    const onCommit = vi.fn();

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit,
      buildRestored,
    });

    const input = container.querySelector('input')!;

    input.value = 'Done';
    simulateKeydown(input, 'Enter');
    input.dispatchEvent(new Event('blur'));

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('falls back to the current value when the input is emptied', () => {
    const { container, title } = makeTitle('Todo');
    const onCommit = vi.fn();

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit,
      buildRestored,
    });

    const input = container.querySelector('input')!;

    input.value = '   ';
    simulateKeydown(input, 'Enter');

    expect(onCommit).toHaveBeenCalledWith('Todo');
  });

  it('cancels on Escape, restoring the original value without committing', () => {
    const { container, title } = makeTitle('Todo');
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit,
      onCancel,
      buildRestored,
    });

    const input = container.querySelector('input')!;

    input.value = 'Oops';
    simulateKeydown(input, 'Escape');

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector('div[data-title]')?.textContent).toBe('Todo');
  });

  it('does not commit on the blur that follows an Escape cancel', () => {
    const { container, title } = makeTitle('Todo');
    const onCommit = vi.fn();

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit,
      buildRestored,
    });

    const input = container.querySelector('input')!;

    input.value = 'Oops';
    simulateKeydown(input, 'Escape');
    input.dispatchEvent(new Event('blur'));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('restores focus to the swapped-back element instead of dropping it to <body>', () => {
    const { container, title } = makeTitle('Todo');

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit: vi.fn(),
      buildRestored,
    });

    const input = container.querySelector('input')!;

    simulateKeydown(input, 'Enter');

    const restored = container.querySelector('div[data-title]');

    expect(restored).not.toBeNull();
    expect(restored).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it('fires onInput on every keystroke when provided', () => {
    const { container, title } = makeTitle('Todo');
    const onInput = vi.fn();

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit: vi.fn(),
      onInput,
      buildRestored,
    });

    const input = container.querySelector('input')!;

    input.value = 'Tod';
    input.dispatchEvent(new Event('input'));

    expect(onInput).toHaveBeenCalledWith('Tod');
  });

  it('runs the configureInput hook against the created input', () => {
    const { container, title } = makeTitle('Todo');

    startInlineRename({
      target: title,
      currentValue: 'Todo',
      label: 'Rename column',
      onCommit: vi.fn(),
      buildRestored,
      configureInput: (input) => input.setAttribute('data-custom', 'yes'),
    });

    const input = container.querySelector('input');

    expect(input?.getAttribute('data-custom')).toBe('yes');
  });
});
