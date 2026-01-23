import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuickStart } from './QuickStart';

describe('QuickStart', () => {
  it('should render a section element with id="quick-start"', () => {
    render(<QuickStart />);

    const section = document.getElementById('quick-start');
    expect(section).toBeInTheDocument();
  });

  it('should render the section header', () => {
    render(<QuickStart />);

    expect(screen.getByText('Quick Start')).toBeInTheDocument();
    // The title is split by <br /> tags
    expect(screen.getByText((content) => content.includes('Up and running'))).toBeInTheDocument();
    expect(screen.getByText('in minutes')).toBeInTheDocument();
  });

  it('should render 3 install steps', () => {
    const { container } = render(<QuickStart />);

    const steps = container.querySelectorAll('[data-install-step]');
    expect(steps.length).toBe(3);
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
    const { container } = render(<QuickStart />);

    const stepNumbers = container.querySelectorAll('.step-number span');
    expect(stepNumbers.length).toBe(3);
    expect(stepNumbers[0].textContent).toBe('1');
    expect(stepNumbers[1].textContent).toBe('2');
    expect(stepNumbers[2].textContent).toBe('3');
  });

  it('should have install-steps container', () => {
    const { container } = render(<QuickStart />);

    const installSteps = container.querySelector('.install-steps');
    expect(installSteps).toBeInTheDocument();
  });

  it('should have install-step elements', () => {
    const { container } = render(<QuickStart />);

    const steps = container.querySelectorAll('.install-step');
    expect(steps.length).toBe(3);
  });

  it('should have step-content divs', () => {
    const { container } = render(<QuickStart />);

    const stepContents = container.querySelectorAll('.step-content');
    expect(stepContents.length).toBe(3);
  });

  it('should have step-title elements', () => {
    const { container } = render(<QuickStart />);

    const titles = container.querySelectorAll('.step-title');
    expect(titles.length).toBe(3);
  });

  it('should have step-description elements', () => {
    const { container } = render(<QuickStart />);

    const descriptions = container.querySelectorAll('.step-description');
    expect(descriptions.length).toBe(3);
  });

  it('should apply animation-delay styles to steps', () => {
    const { container } = render(<QuickStart />);

    const steps = container.querySelectorAll('[data-install-step]');
    expect(steps[0]).toHaveStyle({ animationDelay: '0s' });
    expect(steps[1]).toHaveStyle({ animationDelay: '0.1s' });
    expect(steps[2]).toHaveStyle({ animationDelay: '0.2s' });
  });

  it('should have quick-start-bg div', () => {
    const { container } = render(<QuickStart />);

    const bg = container.querySelector('.quick-start-bg');
    expect(bg).toBeInTheDocument();
  });

  it('should have quick-start-blur element', () => {
    const { container } = render(<QuickStart />);

    const blur = container.querySelector('.quick-start-blur');
    expect(blur).toBeInTheDocument();
  });
});
