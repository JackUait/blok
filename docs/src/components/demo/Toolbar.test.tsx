import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toolbar } from './Toolbar';
import { I18nProvider } from '../../contexts/I18nContext';

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
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    const undoButton = screen.getByTitle('Undo');
    expect(undoButton.tagName.toLowerCase()).toBe('button');
  });

  it('should render redo button', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    const redoButton = screen.getByTitle('Redo');
    expect(redoButton.tagName.toLowerCase()).toBe('button');
  });

  it('should render save button', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    const saveButton = screen.getByTitle('Save JSON');
    expect(saveButton.tagName.toLowerCase()).toBe('button');
  });

  it('should render clear button', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    const clearButton = screen.getByTitle('Clear Editor');
    expect(clearButton.tagName.toLowerCase()).toBe('button');
  });

  it('should call onUndo when undo button is clicked', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    const undoButton = screen.getByTitle('Undo');
    expect(undoButton).toBeEnabled();
    fireEvent.click(undoButton);

    expect(mockHandlers.onUndo).toHaveBeenCalledTimes(1);
  });

  it('should call onRedo when redo button is clicked', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    const redoButton = screen.getByTitle('Redo');
    expect(redoButton).toBeEnabled();
    fireEvent.click(redoButton);

    expect(mockHandlers.onRedo).toHaveBeenCalledTimes(1);
  });

  it('should call onSave when save button is clicked', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    const saveButton = screen.getByTitle('Save JSON');
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(mockHandlers.onSave).toHaveBeenCalledTimes(1);
  });

  it('should call onClear when clear button is clicked', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    const clearButton = screen.getByTitle('Clear Editor');
    expect(clearButton).toBeEnabled();
    fireEvent.click(clearButton);

    expect(mockHandlers.onClear).toHaveBeenCalledTimes(1);
  });

  it('should disable undo button when canUndo is false', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} canUndo={false} /></I18nProvider>);

    const undoButton = screen.getByTitle('Undo');
    expect(undoButton).toBeDisabled();
  });

  it('should enable undo button when canUndo is true', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} canUndo={true} /></I18nProvider>);

    const undoButton = screen.getByTitle('Undo');
    expect(undoButton).not.toBeDisabled();
  });

  it('should disable redo button when canRedo is false', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} canRedo={false} /></I18nProvider>);

    const redoButton = screen.getByTitle('Redo');
    expect(redoButton).toBeDisabled();
  });

  it('should enable redo button when canRedo is true', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} canRedo={true} /></I18nProvider>);

    const redoButton = screen.getByTitle('Redo');
    expect(redoButton).not.toBeDisabled();
  });

  it('should render all 4 toolbar buttons', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
  });

  it('should have Save text on save button', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('should have Clear text on clear button', () => {
    render(<I18nProvider><Toolbar {...mockHandlers} /></I18nProvider>);

    expect(screen.getByText('Clear')).toBeInTheDocument();
  });
});
