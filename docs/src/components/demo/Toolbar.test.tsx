import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
  const mockHandlers = {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    onClear: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render undo button', () => {
    render(<Toolbar {...mockHandlers} />);

    const undoButton = screen.getByTitle('Undo');
    expect(undoButton.tagName.toLowerCase()).toBe('button');
  });

  it('should render redo button', () => {
    render(<Toolbar {...mockHandlers} />);

    const redoButton = screen.getByTitle('Redo');
    expect(redoButton.tagName.toLowerCase()).toBe('button');
  });

  it('should render save button', () => {
    render(<Toolbar {...mockHandlers} />);

    const saveButton = screen.getByTitle('Save JSON');
    expect(saveButton.tagName.toLowerCase()).toBe('button');
  });

  it('should render clear button', () => {
    render(<Toolbar {...mockHandlers} />);

    const clearButton = screen.getByTitle('Clear Editor');
    expect(clearButton.tagName.toLowerCase()).toBe('button');
  });

  it('should call onUndo when undo button is clicked', () => {
    render(<Toolbar {...mockHandlers} />);

    const undoButton = screen.getByTitle('Undo');
    expect(undoButton).toBeEnabled();
    fireEvent.click(undoButton);

    expect(mockHandlers.onUndo).toHaveBeenCalledTimes(1);
  });

  it('should call onRedo when redo button is clicked', () => {
    render(<Toolbar {...mockHandlers} />);

    const redoButton = screen.getByTitle('Redo');
    expect(redoButton).toBeEnabled();
    fireEvent.click(redoButton);

    expect(mockHandlers.onRedo).toHaveBeenCalledTimes(1);
  });

  it('should call onSave when save button is clicked', () => {
    render(<Toolbar {...mockHandlers} />);

    const saveButton = screen.getByTitle('Save JSON');
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(mockHandlers.onSave).toHaveBeenCalledTimes(1);
  });

  it('should call onClear when clear button is clicked', () => {
    render(<Toolbar {...mockHandlers} />);

    const clearButton = screen.getByTitle('Clear Editor');
    expect(clearButton).toBeEnabled();
    fireEvent.click(clearButton);

    expect(mockHandlers.onClear).toHaveBeenCalledTimes(1);
  });

  it('should disable undo button when canUndo is false', () => {
    render(<Toolbar {...mockHandlers} canUndo={false} />);

    const undoButton = screen.getByTitle('Undo');
    expect(undoButton).toBeDisabled();
  });

  it('should enable undo button when canUndo is true', () => {
    render(<Toolbar {...mockHandlers} canUndo={true} />);

    const undoButton = screen.getByTitle('Undo');
    expect(undoButton).not.toBeDisabled();
  });

  it('should disable redo button when canRedo is false', () => {
    render(<Toolbar {...mockHandlers} canRedo={false} />);

    const redoButton = screen.getByTitle('Redo');
    expect(redoButton).toBeDisabled();
  });

  it('should enable redo button when canRedo is true', () => {
    render(<Toolbar {...mockHandlers} canRedo={true} />);

    const redoButton = screen.getByTitle('Redo');
    expect(redoButton).not.toBeDisabled();
  });

  it('should render all 4 toolbar buttons', () => {
    render(<Toolbar {...mockHandlers} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
  });

  it('should have Save text on save button', () => {
    render(<Toolbar {...mockHandlers} />);

    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('should have Clear text on clear button', () => {
    render(<Toolbar {...mockHandlers} />);

    expect(screen.getByText('Clear')).toBeInTheDocument();
  });
});
