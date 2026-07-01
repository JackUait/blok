// docs/src/components/api/ApiPagination.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { ApiPagination } from './ApiPagination';
import { MODULE_ORDER } from './api-nav';

const labels = Object.fromEntries(MODULE_ORDER.map((id) => [id, id]));
const renderAt = (currentId: string) =>
  render(
    <MemoryRouter><I18nProvider><ApiPagination currentId={currentId} labels={labels} /></I18nProvider></MemoryRouter>,
  );

describe('ApiPagination', () => {
  it('first module has next but no prev', () => {
    renderAt(MODULE_ORDER[0]);
    expect(screen.queryByTestId('api-pagination-prev')).toBeNull();
    expect(screen.getByTestId('api-pagination-next')).toHaveAttribute('href', `/docs/${MODULE_ORDER[1]}`);
  });

  it('last module has prev but no next', () => {
    const last = MODULE_ORDER[MODULE_ORDER.length - 1];
    renderAt(last);
    expect(screen.getByTestId('api-pagination-prev')).toHaveAttribute('href', `/docs/${MODULE_ORDER[MODULE_ORDER.length - 2]}`);
    expect(screen.queryByTestId('api-pagination-next')).toBeNull();
  });

  it('middle module links to both neighbors', () => {
    renderAt(MODULE_ORDER[2]);
    expect(screen.getByTestId('api-pagination-prev')).toHaveAttribute('href', `/docs/${MODULE_ORDER[1]}`);
    expect(screen.getByTestId('api-pagination-next')).toHaveAttribute('href', `/docs/${MODULE_ORDER[3]}`);
  });
});
