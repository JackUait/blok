import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconItalic } from '@codexteam/icons';

import ItalicInlineTool from '../../../../src/components/inline-tools/inline-tool-italic';

type DocumentCommandKey = 'execCommand' | 'queryCommandState';

const setDocumentCommand = <K extends DocumentCommandKey>(
  key: K,
  implementation: Document[K]
): void => {
  Object.defineProperty(document, key, {
    configurable: true,
    value: implementation,
    writable: true,
  });
};

describe('ItalicInlineTool', () => {
  let tool: ItalicInlineTool;
  let execCommandMock: ReturnType<typeof vi.fn<[], boolean>>;
  let queryCommandStateMock: ReturnType<typeof vi.fn<[], boolean>>;

  beforeEach(() => {
    execCommandMock = vi.fn(() => true);
    queryCommandStateMock = vi.fn(() => false);

    setDocumentCommand('execCommand', execCommandMock as Document['execCommand']);
    setDocumentCommand('queryCommandState', queryCommandStateMock as Document['queryCommandState']);

    tool = new ItalicInlineTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes inline metadata and sanitizer config', () => {
    expect(ItalicInlineTool.isInline).toBe(true);
    expect(ItalicInlineTool.title).toBe('Italic');
    expect(ItalicInlineTool.sanitize).toStrictEqual({ i: {} });
  });

  it('renders an inline toolbar button with italic icon', () => {
    const element = tool.render();
    const button = element as HTMLButtonElement;
    const expectedIcon = document.createElement('div');

    expectedIcon.innerHTML = IconItalic;

    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button.type).toBe('button');
    expect(button.classList.contains('ce-inline-tool')).toBe(true);
    expect(button.classList.contains('ce-inline-tool--italic')).toBe(true);
    expect(button.innerHTML).toBe(expectedIcon.innerHTML);
  });

  it('executes italic command when surround is called', () => {
    tool.surround();

    expect(execCommandMock).toHaveBeenCalledWith('italic');
  });

  it('synchronizes button active state with document command state', () => {
    const button = tool.render();

    queryCommandStateMock.mockReturnValue(true);

    expect(tool.checkState()).toBe(true);
    expect(button.classList.contains('ce-inline-tool--active')).toBe(true);

    queryCommandStateMock.mockReturnValue(false);

    expect(tool.checkState()).toBe(false);
    expect(button.classList.contains('ce-inline-tool--active')).toBe(false);
  });

  it('exposes CMD+I shortcut', () => {
    expect(tool.shortcut).toBe('CMD+I');
  });
});

