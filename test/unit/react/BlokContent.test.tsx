import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { setHolder } from '../../../src/react/holder-map';

import { BlokContent } from '../../../src/react/BlokContent';

describe('BlokContent', () => {
  let mockEditor: Record<string, unknown>;
  let mockHolder: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditor = {};
    mockHolder = document.createElement('div');
    mockHolder.textContent = 'editor-content';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render an empty div when editor is null', () => {
    render(<BlokContent editor={null} data-testid="content" />);

    const div = screen.getByTestId('content');

    expect(div).toBeInstanceOf(HTMLDivElement);
    expect(div).toBeEmptyDOMElement();
  });

  it('should pass className to the container div', () => {
    render(<BlokContent editor={null} className="my-class" data-testid="content" />);

    const div = screen.getByTestId('content');

    expect(div.className).toBe('my-class');
  });

  it('should pass style to the container div', () => {
    render(<BlokContent editor={null} style={{ minHeight: '200px' }} data-testid="content" />);

    const div = screen.getByTestId('content');

    expect(div.style.minHeight).toBe('200px');
  });

  it('should adopt the editor holder into the container when editor is provided', () => {
    setHolder(mockEditor, mockHolder);

    render(
      <BlokContent editor={mockEditor as unknown as Parameters<typeof BlokContent>[0]['editor']} data-testid="content" />
    );

    const div = screen.getByTestId('content');

    expect(div.contains(mockHolder)).toBe(true);
    expect(div.textContent).toBe('editor-content');
  });

  it('should remove the holder from container on unmount', () => {
    setHolder(mockEditor, mockHolder);

    const { unmount } = render(
      <BlokContent editor={mockEditor as unknown as Parameters<typeof BlokContent>[0]['editor']} data-testid="content" />
    );

    // Holder is in the container — verify via its text content being present
    expect(screen.getByText('editor-content')).toBeInTheDocument();

    unmount();

    // After unmount, holder should be removed (detached from DOM).
    // Direct node access is necessary here: after unmount there is no rendered tree
    // to query, and we need to verify the cleanup effect detached this specific DOM node.
    // eslint-disable-next-line testing-library/no-node-access
    expect(mockHolder.parentElement).toBeNull();
  });

  it('should swap holders when editor prop changes to a different instance', () => {
    setHolder(mockEditor, mockHolder);

    const { rerender } = render(
      <BlokContent editor={mockEditor as unknown as Parameters<typeof BlokContent>[0]['editor']} data-testid="content" />
    );

    const div = screen.getByTestId('content');

    expect(div.contains(mockHolder)).toBe(true);

    const mockEditorB: Record<string, unknown> = {};
    const mockHolderB = document.createElement('div');

    mockHolderB.textContent = 'editor-b-content';
    setHolder(mockEditorB, mockHolderB);

    rerender(
      <BlokContent editor={mockEditorB as unknown as Parameters<typeof BlokContent>[0]['editor']} data-testid="content" />
    );

    // Old holder should be removed from container
    // eslint-disable-next-line testing-library/no-node-access
    expect(mockHolder.parentElement).toBeNull();
    expect(div.contains(mockHolder)).toBe(false);

    // New holder should be adopted
    expect(div.contains(mockHolderB)).toBe(true);
    expect(div.textContent).toBe('editor-b-content');
  });

  it('should call a function ref with the container HTMLDivElement (A1)', () => {
    const callbackRef = vi.fn<(node: HTMLDivElement | null) => void>();

    render(<BlokContent editor={null} ref={callbackRef} data-testid="content" />);

    expect(callbackRef).toHaveBeenCalledTimes(1);
    const receivedNode = callbackRef.mock.calls[0][0];
    expect(receivedNode).toBeInstanceOf(HTMLDivElement);
    expect(receivedNode).toBe(screen.getByTestId('content'));
  });

  it('should assign the container HTMLDivElement to an object ref (A2)', () => {
    const objectRef = React.createRef<HTMLDivElement>();

    render(<BlokContent editor={null} ref={objectRef} data-testid="content" />);

    expect(objectRef.current).toBeInstanceOf(HTMLDivElement);
    expect(objectRef.current).toBe(screen.getByTestId('content'));
  });

  it('should render an empty container without throwing when editor has no registered holder (C1)', () => {
    const editorWithoutHolder: Record<string, unknown> = {};

    expect(() => {
      render(
        <BlokContent
          editor={editorWithoutHolder as unknown as Parameters<typeof BlokContent>[0]['editor']}
          data-testid="content"
        />
      );
    }).not.toThrow();

    const div = screen.getByTestId('content');

    expect(div).toBeInstanceOf(HTMLDivElement);
    expect(div).toBeEmptyDOMElement();
  });

  it('should remove the holder from the container when editor changes to null', () => {
    setHolder(mockEditor, mockHolder);

    const { rerender } = render(
      <BlokContent editor={mockEditor as unknown as Parameters<typeof BlokContent>[0]['editor']} data-testid="content" />
    );

    // Holder is in the container
    expect(screen.getByText('editor-content')).toBeInTheDocument();

    rerender(<BlokContent editor={null} data-testid="content" />);

    // After switching editor to null, the cleanup effect should have detached the holder
    // eslint-disable-next-line testing-library/no-node-access
    expect(mockHolder.parentElement).toBeNull();
  });
});
