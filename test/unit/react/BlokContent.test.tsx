import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setHolder, getHolder } from '../../../src/react/holder-map';

import { BlokContent } from '../../../src/react/BlokContent';

describe('BlokContent', () => {
  let mockEditor: object;
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
    const { container } = render(<BlokContent editor={null} data-testid="content" />);

    const div = screen.getByTestId('content');

    expect(div).toBeInstanceOf(HTMLDivElement);
    expect(div.children).toHaveLength(0);
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

    const { container } = render(
      <BlokContent editor={mockEditor as Parameters<typeof BlokContent>[0]['editor']} data-testid="content" />
    );

    const div = screen.getByTestId('content');

    expect(div.contains(mockHolder)).toBe(true);
    expect(div.textContent).toBe('editor-content');
  });

  it('should remove the holder from container on unmount', () => {
    setHolder(mockEditor, mockHolder);

    const { unmount } = render(
      <BlokContent editor={mockEditor as Parameters<typeof BlokContent>[0]['editor']} data-testid="content" />
    );

    // Holder is in the container
    expect(mockHolder.parentElement).not.toBeNull();

    unmount();

    // After unmount, holder should be removed (detached from DOM)
    expect(mockHolder.parentElement).toBeNull();
  });
});
