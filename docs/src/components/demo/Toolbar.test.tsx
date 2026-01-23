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

  it('should render a div with demo-toolbar class', () => {
    render(<Toolbar {...mockHandlers} />);

    const toolbar = document.querySelector('.demo-toolbar');
    expect(toolbar).toBeInTheDocument();
  });

  it('should render undo button', () => {
    render(<Toolbar {...mockHandlers} />);

    const undoButton = screen.getByTitle('Undo');
    expect(undoButton).toBeInTheDocument();
    expect(undoButton.tagName.toLowerCase()).toBe('button');
  });

  it('should render redo button', () => {
    render(<Toolbar {...mockHandlers} />);

    const redoButton = screen.getByTitle('Redo');
    expect(redoButton).toBeInTheDocument();
    expect(redoButton.tagName.toLowerCase()).toBe('button');
  });

  it('should render save button', () => {
    render(<Toolbar {...mockHandlers} />);

    const saveButton = screen.getByTitle('Save JSON');
    expect(saveButton).toBeInTheDocument();
    expect(saveButton.tagName.toLowerCase()).toBe('button');
  });

  it('should render clear button', () => {
    render(<Toolbar {...mockHandlers} />);

    const clearButton = screen.getByTitle('Clear Editor');
    expect(clearButton).toBeInTheDocument();
    expect(clearButton.tagName.toLowerCase()).toBe('button');
  });

  it('should call onUndo when undo button is clicked', () => {
    render(<Toolbar {...mockHandlers} />);

    const undoButton = screen.getByTitle('Undo');
    fireEvent.click(undoButton);

    expect(mockHandlers.onUndo).toHaveBeenCalledTimes(1);
  });

  it('should call onRedo when redo button is clicked', () => {
    render(<Toolbar {...mockHandlers} />);

    const redoButton = screen.getByTitle('Redo');
    fireEvent.click(redoButton);

    expect(mockHandlers.onRedo).toHaveBeenCalledTimes(1);
  });

  it('should call onSave when save button is clicked', () => {
    render(<Toolbar {...mockHandlers} />);

    const saveButton = screen.getByTitle('Save JSON');
    fireEvent.click(saveButton);

    expect(mockHandlers.onSave).toHaveBeenCalledTimes(1);
  });

  it('should call onClear when clear button is clicked', () => {
    render(<Toolbar {...mockHandlers} />);

    const clearButton = screen.getByTitle('Clear Editor');
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

  it('should have toolbar-group divs', () => {
    const { container } = render(<Toolbar {...mockHandlers} />);

    const groups = container.querySelectorAll('.toolbar-group');
    expect(groups.length).toBe(2);
  });

  it('should have toolbar-divider', () => {
    const { container } = render(<Toolbar {...mockHandlers} />);

    const divider = container.querySelector('.toolbar-divider');
    expect(divider).toBeInTheDocument();
  });

  it('should have toolbar-btn class on all buttons', () => {
    const { container } = render(<Toolbar {...mockHandlers} />);

    const buttons = container.querySelectorAll('.toolbar-btn');
    expect(buttons.length).toBe(4);
  });

  it('should have Save text on save button', () => {
    render(<Toolbar {...mockHandlers} />);

    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('should have Clear text on clear button', () => {
    render(<Toolbar {...mockHandlers} />);

    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('should have SVG icons for all buttons', () => {
    const { container } = render(<Toolbar {...mockHandlers} />);

    const svgs = container.querySelectorAll('.toolbar-btn svg');
    expect(svgs.length).toBe(4);
  });
});
