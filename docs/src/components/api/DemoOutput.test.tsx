import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DemoOutput } from './DemoOutput';

describe('DemoOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when output is null', () => {
    const { container } = render(<DemoOutput output={null} />);
    expect(container.firstChild).toBe(null);
  });

  it('should not render when output is undefined', () => {
    const { container } = render(<DemoOutput />);
    expect(container.firstChild).toBe(null);
  });

  it('should display success message with correct styling', () => {
    const { container } = render(
      <DemoOutput output={{ message: 'Action completed', type: 'success' }} />
    );
    const output = screen.getByText('Action completed');
    expect(output).toBeInTheDocument();
    const wrapper = container.querySelector('.api-demo-output');
    expect(wrapper).toHaveClass('api-demo-output-success');
  });

  it('should display error message with correct styling', () => {
    const { container } = render(
      <DemoOutput output={{ message: 'Something went wrong', type: 'error' }} />
    );
    const output = screen.getByText('Something went wrong');
    expect(output).toBeInTheDocument();
    const wrapper = container.querySelector('.api-demo-output');
    expect(wrapper).toHaveClass('api-demo-output-error');
  });

  it('should render checkmark icon for success', () => {
    const { container } = render(
      <DemoOutput output={{ message: 'Success', type: 'success' }} />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should render error icon for error', () => {
    const { container } = render(
      <DemoOutput output={{ message: 'Error', type: 'error' }} />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should have the correct CSS class', () => {
    const { container } = render(
      <DemoOutput output={{ message: 'Test', type: 'success' }} />
    );
    const wrapper = container.querySelector('.api-demo-output');
    expect(wrapper).toBeInTheDocument();
  });
});
