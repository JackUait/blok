import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QuickStart } from './QuickStart';

const testIdPrefix = 'quick-start';

describe('QuickStart', () => {
  it('should render a section element with id="quick-start"', () => {
    render(<QuickStart />);

    const section = screen.getByTestId(`${testIdPrefix}-section`);
    expect(section).toBeInTheDocument();
    expect(section.id).toBe('quick-start');
  });

  it('should render the section header', () => {
    render(<QuickStart />);

    const section = screen.getByTestId(`${testIdPrefix}-section`);
    expect(section).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Up and running in minutes' })).toBeInTheDocument();
  });

  it('should render 3 install steps', () => {
    render(<QuickStart />);

    expect(screen.getByTestId('install-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('install-step-2')).toBeInTheDocument();
    expect(screen.getByTestId('install-step-3')).toBeInTheDocument();
  });

  it('should render step 1: Install Blok', () => {
    render(<QuickStart />);

    expect(screen.getByText('Install Blok')).toBeInTheDocument();
    expect(
      screen.getByText('Add Blok to your project using your favorite package manager.')
    ).toBeInTheDocument();
  });

  it('should render step 2: Import and configure', () => {
    render(<QuickStart />);

    expect(screen.getByText('Import and configure')).toBeInTheDocument();
    expect(
      screen.getByText('Import the editor and tools, then configure your block types.')
    ).toBeInTheDocument();
  });

  it('should render step 3: Save content', () => {
    render(<QuickStart />);

    expect(screen.getByText('Save content')).toBeInTheDocument();
    expect(screen.getByText('Extract clean JSON data ready to save anywhere.')).toBeInTheDocument();
  });

  it('should render step numbers', () => {
    render(<QuickStart />);

    const stepNumber1 = screen.getByTestId('step-number-1');
    const stepNumber2 = screen.getByTestId('step-number-2');
    const stepNumber3 = screen.getByTestId('step-number-3');

    expect(within(stepNumber1).getByText('1')).toBeInTheDocument();
    expect(within(stepNumber2).getByText('2')).toBeInTheDocument();
    expect(within(stepNumber3).getByText('3')).toBeInTheDocument();
  });

  it('should have install-steps container', () => {
    render(<QuickStart />);

    expect(screen.getByTestId('install-steps')).toBeInTheDocument();
  });

  it('should have install-step elements', () => {
    render(<QuickStart />);

    expect(screen.getByTestId('install-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('install-step-2')).toBeInTheDocument();
    expect(screen.getByTestId('install-step-3')).toBeInTheDocument();
  });

  it('should have step-content divs', () => {
    render(<QuickStart />);

    expect(screen.getByTestId('step-content-1')).toBeInTheDocument();
    expect(screen.getByTestId('step-content-2')).toBeInTheDocument();
    expect(screen.getByTestId('step-content-3')).toBeInTheDocument();
  });

  it('should have step-title elements', () => {
    render(<QuickStart />);

    expect(screen.getByRole('heading', { name: 'Install Blok' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Import and configure' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Save content' })).toBeInTheDocument();
  });

  it('should have step-description elements', () => {
    render(<QuickStart />);

    expect(screen.getByTestId('step-description-1')).toBeInTheDocument();
    expect(screen.getByTestId('step-description-2')).toBeInTheDocument();
    expect(screen.getByTestId('step-description-3')).toBeInTheDocument();
  });

  it('should apply animation-delay styles to steps', () => {
    render(<QuickStart />);

    const step1 = screen.getByTestId('install-step-1');
    const step2 = screen.getByTestId('install-step-2');
    const step3 = screen.getByTestId('install-step-3');

    expect(step1).toHaveStyle({ animationDelay: '0s' });
    expect(step2).toHaveStyle({ animationDelay: '0.1s' });
    expect(step3).toHaveStyle({ animationDelay: '0.2s' });
  });

  it('should have quick-start-bg div', () => {
    render(<QuickStart />);

    expect(screen.getByTestId('quick-start-bg')).toBeInTheDocument();
  });

  it('should have quick-start-blur element', () => {
    render(<QuickStart />);

    expect(screen.getByTestId('quick-start-blur')).toBeInTheDocument();
  });
});
