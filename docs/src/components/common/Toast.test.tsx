import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toast } from './Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not render when visible is false', () => {
    const { container } = render(
      <Toast message="Test message" visible={false} onVisibleChange={vi.fn()} />
    );
    expect(container.firstChild).toBe(null);
  });

  it('should render when visible is true', () => {
    render(<Toast message="Test message" visible={true} onVisibleChange={vi.fn()} />);
    const toast = screen.queryByText('Test message');
    expect(toast).toBeInTheDocument();
  });

  it('should display the provided message', () => {
    render(<Toast message="Hello, world!" visible={true} onVisibleChange={vi.fn()} />);
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  it('should call onVisibleChange with false after default duration', () => {
    const onVisibleChange = vi.fn();
    render(<Toast message="Test" visible={true} onVisibleChange={onVisibleChange} />);

    expect(onVisibleChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2500);

    expect(onVisibleChange).toHaveBeenCalledWith(false);
    expect(onVisibleChange).toHaveBeenCalledTimes(1);
  });

  it('should use custom duration when provided', () => {
    const onVisibleChange = vi.fn();
    render(
      <Toast message="Test" visible={true} onVisibleChange={onVisibleChange} duration={5000} />
    );

    vi.advanceTimersByTime(2500);
    expect(onVisibleChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2500);
    expect(onVisibleChange).toHaveBeenCalledWith(false);
  });

  it('should clear timer when component unmounts', () => {
    const onVisibleChange = vi.fn();
    const { unmount } = render(
      <Toast message="Test" visible={true} onVisibleChange={onVisibleChange} />
    );

    unmount();

    vi.advanceTimersByTime(5000);
    expect(onVisibleChange).not.toHaveBeenCalled();
  });

  it('should not start timer when visible is false', () => {
    const onVisibleChange = vi.fn();
    render(<Toast message="Test" visible={false} onVisibleChange={onVisibleChange} />);

    vi.advanceTimersByTime(5000);
    expect(onVisibleChange).not.toHaveBeenCalled();
  });

  it('should have the correct CSS class', () => {
    const { container } = render(
      <Toast message="Test" visible={true} onVisibleChange={vi.fn()} />
    );
    const toast = container.querySelector('.toast');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveClass('visible');
  });

  it('should contain a checkmark icon', () => {
    const { container } = render(
      <Toast message="Test" visible={true} onVisibleChange={vi.fn()} />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
