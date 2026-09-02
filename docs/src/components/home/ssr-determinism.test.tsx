import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../contexts/I18nContext';
import { HomePage } from '../../pages/HomePage';

/**
 * The prerendered HTML must be reproducible, because hydration compares it to
 * what the client renders. Anything nondeterministic read DURING render — a
 * `Math.random()`, a clock, a locale sniff — bakes one value into the file and
 * produces another in the browser, and React throws a hydration mismatch.
 *
 * This is not a cosmetic warning. React responds by discarding the server HTML
 * and re-rendering the whole root on the client, and an external auditor
 * crawling this page recorded its only `<h1>` as "Application Error" — the
 * router's error boundary — where the served file plainly contains
 * "Build beautiful block-based editors". Googlebot renders JavaScript, so a
 * page that reliably fails hydration risks being indexed as its error state.
 *
 * Randomness belongs in an effect, which runs only on the client and only after
 * hydration has already matched.
 */
const renderHome = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <I18nProvider>
        <HomePage />
      </I18nProvider>
    </MemoryRouter>,
  );

describe('server render determinism', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the home page identically twice', () => {
    expect(renderHome()).toBe(renderHome());
  });

  // Two renders can coincide by luck; forcing opposite ends of the range makes
  // any use of Math.random() during render show up every time.
  it('does not read Math.random() while rendering', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const low = renderHome();

    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const high = renderHome();

    expect(high).toBe(low);
  });
});
