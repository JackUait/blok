import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DemoOutput } from './DemoOutput';

describe('DemoOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when output is null', () => {
    render(<DemoOutput output={null} />);
    expect(screen.queryByTestId('api-demo-output')).not.toBeInTheDocument();
  });

  it('should not render when output is undefined', () => {
    render(<DemoOutput />);
    expect(screen.queryByTestId('api-demo-output')).not.toBeInTheDocument();
  });

  it('should display success message', () => {
    render(<DemoOutput output={{ message: 'Action completed', type: 'success' }} />);
    expect(screen.getByText('Action completed')).toBeInTheDocument();
  });

  it('should display error message', () => {
    render(<DemoOutput output={{ message: 'Something went wrong', type: 'error' }} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('should render checkmark icon for success', () => {
    render(<DemoOutput output={{ message: 'Success', type: 'success' }} />);
    expect(screen.getByTestId('success-icon')).toBeInTheDocument();
  });

  it('should render error icon for error', () => {
    render(<DemoOutput output={{ message: 'Error', type: 'error' }} />);
    expect(screen.getByTestId('error-icon')).toBeInTheDocument();
  });

  it('should have the correct data-testid attribute', () => {
    render(<DemoOutput output={{ message: 'Test', type: 'success' }} />);
    expect(screen.getByTestId('api-demo-output')).toBeInTheDocument();
  });

  it('should apply success data attribute when type is success', () => {
    render(<DemoOutput output={{ message: 'Test', type: 'success' }} />);
    const wrapper = screen.getByTestId('api-demo-output');
    expect(wrapper).toHaveAttribute('data-output-type', 'success');
  });

  it('should apply error data attribute when type is error', () => {
    render(<DemoOutput output={{ message: 'Test', type: 'error' }} />);
    const wrapper = screen.getByTestId('api-demo-output');
    expect(wrapper).toHaveAttribute('data-output-type', 'error');
  });
});
