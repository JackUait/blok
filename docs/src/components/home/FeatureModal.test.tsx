import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeatureModal, type FeatureDetail } from './FeatureModal';
import { I18nProvider } from '../../contexts/I18nContext';

const mockFeature: FeatureDetail = {
  icon: <span>icon</span>,
  title: 'Clean JSON Output',
  description: 'Content is structured as typed JSON blocks, not raw HTML.',
  learnMore: 'Learn more about Clean JSON Output',
  accent: 'coral',
  details: {
    summary: 'Output is clean JSON, not HTML.',
    benefits: ['Easy to parse', 'Framework agnostic', 'Version control friendly'],
    codeExample: 'const data = await editor.save();',
    apiLink: '/docs#core-save',
  },
};

const renderModal = (feature: FeatureDetail | null = mockFeature, onClose = vi.fn()) =>
  render(
    <I18nProvider>
      <FeatureModal feature={feature} onClose={onClose} />
    </I18nProvider>
  );

describe('FeatureModal', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('should render nothing when feature is null', () => {
    const { container } = renderModal(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('should render the modal backdrop when feature is provided', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should render the feature title', () => {
    renderModal();
    expect(screen.getByText('Clean JSON Output')).toBeInTheDocument();
  });

  it('should render the feature summary', () => {
    renderModal();
    expect(screen.getByText('Output is clean JSON, not HTML.')).toBeInTheDocument();
  });

  it('should render the Key Benefits heading', () => {
    renderModal();
    expect(screen.getByText('Key Benefits')).toBeInTheDocument();
  });

  it('should render each benefit', () => {
    renderModal();
    expect(screen.getByText('Easy to parse')).toBeInTheDocument();
    expect(screen.getByText('Framework agnostic')).toBeInTheDocument();
    expect(screen.getByText('Version control friendly')).toBeInTheDocument();
  });

  it('should render the Example heading when codeExample is provided', () => {
    renderModal();
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it('should not render the Example heading when codeExample is absent', () => {
    const featureWithoutCode: FeatureDetail = {
      ...mockFeature,
      details: { summary: 'Summary', benefits: ['Benefit'] },
    };
    renderModal(featureWithoutCode);
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
  });

  it('should render the API docs link when apiLink is provided', () => {
    renderModal();
    const link = screen.getByText('View API Documentation →');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/docs#core-save');
  });

  it('should render the close button with accessible aria-label', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Close modal' })).toBeInTheDocument();
  });

  it('should call onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderModal(mockFeature, onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('should call onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    renderModal(mockFeature, onClose);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('should have aria-modal="true" on the dialog', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <I18nProvider>
        <FeatureModal feature={mockFeature} onClose={vi.fn()} />
      </I18nProvider>
    );
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
  });
});
