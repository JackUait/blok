import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QuickStart } from './QuickStart';
import { I18nProvider } from '../../contexts/I18nContext';

const testIdPrefix = 'quick-start';

const renderQuickStart = () =>
  render(
    <I18nProvider>
      <QuickStart />
    </I18nProvider>
  );

describe('QuickStart', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('should render a section element with id="quick-start"', () => {
    renderQuickStart();
    const section = screen.getByTestId(`${testIdPrefix}-section`);
    expect(section).toBeInTheDocument();
    expect(section.id).toBe('quick-start');
  });

  it('should render the eyebrow and section heading', () => {
    renderQuickStart();
    expect(screen.getByText('Get Started')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Up and running in minutes' })
    ).toBeInTheDocument();
  });

  it('should render 3 step controls as buttons', () => {
    renderQuickStart();
    for (const n of [1, 2, 3]) {
      const step = screen.getByTestId(`install-step-${n}`);
      expect(step).toBeInTheDocument();
      expect(step.tagName).toBe('BUTTON');
    }
  });

  it('should always render every step title and description in the rail', () => {
    renderQuickStart();
    expect(screen.getByRole('heading', { name: 'Install Blok' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Import and configure' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Save content' })).toBeInTheDocument();

    expect(
      screen.getByText('Add Blok to your project using your favorite package manager.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Import the editor and tools, then configure your block types.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Extract clean JSON data ready to save anywhere.')
    ).toBeInTheDocument();
  });

  it('should render step numbers 1, 2, 3', () => {
    renderQuickStart();
    expect(within(screen.getByTestId('step-number-1')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('step-number-2')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('step-number-3')).getByText('3')).toBeInTheDocument();
  });

  it('should mark the first step active by default', () => {
    renderQuickStart();
    expect(screen.getByTestId('install-step-1')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('install-step-2')).not.toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('install-step-3')).not.toHaveAttribute('aria-current', 'step');
  });

  it('should activate a step when its control is clicked', () => {
    renderQuickStart();
    fireEvent.click(screen.getByTestId('install-step-3'));
    expect(screen.getByTestId('install-step-3')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('install-step-1')).not.toHaveAttribute('aria-current', 'step');
  });

  it('should render a single code window pane', () => {
    renderQuickStart();
    expect(screen.getByTestId('quick-start-window')).toBeInTheDocument();
  });

  it('should render the live editor finale region', () => {
    renderQuickStart();
    expect(screen.getByTestId('quick-start-live')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'And then it just runs' })).toBeInTheDocument();
  });

  it('should have the atmospheric background layers', () => {
    renderQuickStart();
    expect(screen.getByTestId('quick-start-bg')).toBeInTheDocument();
    expect(screen.getByTestId('quick-start-blur')).toBeInTheDocument();
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    renderQuickStart();
    expect(screen.queryByText('Up and running in minutes')).not.toBeInTheDocument();
    expect(screen.getByText('Готово за несколько минут')).toBeInTheDocument();
  });
});
