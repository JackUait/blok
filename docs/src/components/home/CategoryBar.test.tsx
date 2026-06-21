import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../contexts/I18nContext';
import { CategoryBar, type HomeView } from './CategoryBar';

const renderBar = (activeView: HomeView = 'getStarted', onSelect = vi.fn()) => {
  render(
    <I18nProvider>
      <CategoryBar activeView={activeView} onSelect={onSelect} />
    </I18nProvider>
  );
  return onSelect;
};

describe('CategoryBar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders a navigation landmark labelled for browsing the docs', () => {
    renderBar();
    expect(
      screen.getByRole('navigation', { name: /browse the documentation/i })
    ).toBeInTheDocument();
  });

  it('renders every category as a button (no navigation)', () => {
    renderBar();

    const expected = [
      /get started/i,
      /^docs$/i,
      /^tools$/i,
      /^playground$/i,
      /^migration$/i,
      /^changelog$/i,
    ];

    expected.forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });

    // The pills no longer route anywhere.
    expect(screen.queryByRole('link', { name: /^docs$/i })).not.toBeInTheDocument();
  });

  it('does not render recipes or integrations categories', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: /^recipes$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^integrations$/i })).not.toBeInTheDocument();
  });

  it('calls onSelect with the view when a pill is clicked', () => {
    const onSelect = renderBar('getStarted');
    fireEvent.click(screen.getByRole('button', { name: /^tools$/i }));
    expect(onSelect).toHaveBeenCalledWith('tools');
  });

  it('marks the active view as pressed and others as not', () => {
    renderBar('tools');
    expect(screen.getByRole('button', { name: /^tools$/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /^migration$/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('marks "Get started" as pressed when it is the active view', () => {
    renderBar('getStarted');
    expect(screen.getByRole('button', { name: /get started/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('renders translated labels in Russian', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    renderBar();
    expect(screen.getByRole('button', { name: /начало работы/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^документация$/i })).toBeInTheDocument();
  });
});
