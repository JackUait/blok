// docs/src/i18n/ru-language-purity.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../contexts/I18nContext';
import { FrameworkProvider } from '../contexts/FrameworkContext';
import { ServerContent } from '../pages/ServerPage';
import { PresetsContent } from '../pages/PresetsPage';
import { ToolSection } from '../components/tools/ToolSection';
import { TOOL_SECTIONS } from '../components/tools/tools-data';
import { WhyBlok } from '../components/home/WhyBlok';
import { Features, LANGUAGE_COUNT, PHRASES } from '../components/home/Features';
import { Sidebar } from '../components/common/Sidebar';
import { CodeBlock } from '../components/common/CodeBlock';
import { Footer } from '../components/layout/Footer';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { useToolsTranslations } from '../hooks/useToolsTranslations';
import { useApiTranslations } from '../hooks/useApiTranslations';
import { ApiSection as ApiSectionView } from '../components/api/ApiSection';
import { API_SECTIONS } from '../components/api/api-data';

/**
 * Google classifies a page by its visible body text — never by `lang`, hreflang
 * or the `/ru` prefix — and treats two localized pages as duplicates when only
 * the chrome is translated. So an English paragraph on a `/ru/**` page is not a
 * polish defect: it makes the page rank as English, or not at all.
 *
 * This law renders every Russian surface this repo owns and fails on visible
 * English. It is deliberately component-scoped rather than page-scoped: the
 * sr-only Markdown pointer is English on every page and renders OUTSIDE
 * `I18nProvider` (root.tsx mounts it in Layout), so it cannot be rendered here
 * at all — including whole pages would pin someone else's defect on this law and
 * make it unmaintainable. Assert that one in `seo-artifacts.test.ts` instead.
 *
 * The comment here used to name Nav's "Skip to content" as a second such
 * offender. It never was: commit a6df2dc2 routed it through `t()` and added this
 * comment in the same diff, so the example was wrong from the first day.
 */

/** Code is English by definition; `data-lang-exempt` marks a deliberate brand row. */
const STRIP_SELECTOR = 'script,style,pre,code,kbd,samp,svg,noscript,[data-lang-exempt]';

/** Tags that continue a sentence rather than starting a new one. */
const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'DATA', 'DFN', 'EM', 'I', 'MARK',
  'Q', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR',
]);

/** Attributes a screen reader speaks, so they are visible content too. */
const TEXT_ATTRIBUTES = ['aria-label', 'alt', 'title', 'placeholder'] as const;

const CYRILLIC = /[Ѐ-ӿ]/;
const LATIN_WORD = /[A-Za-z][A-Za-z'’]*/g;

/**
 * Splits rendered DOM into the phrases a reader actually sees: inline markup is
 * merged (so `Type <span>/</span> for commands` stays one phrase) and every
 * block-level element starts a new one (so two unrelated table cells never join).
 */
interface Phrase {
  text: string;
  /** Attribute values skip the Cyrillic veto — see `isEnglishProse`. */
  fromAttribute: boolean;
}

const visiblePhrases = (root: HTMLElement): Phrase[] => {
  const phrases: Phrase[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join('').replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      phrases.push({ text, fromAttribute: false });
    }
    buffer = [];
  };

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer.push(node.textContent ?? '');
      return;
    }
    if (!(node instanceof HTMLElement) && !(node instanceof Element)) {
      return;
    }
    const inline = INLINE_TAGS.has((node as Element).tagName);
    if (!inline) flush();
    node.childNodes.forEach(walk);
    if (!inline) flush();
  };

  walk(root);
  flush();

  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of TEXT_ATTRIBUTES) {
      const value = element.getAttribute(attribute)?.trim();
      if (value !== undefined && value.length > 0) {
        phrases.push({ text: value, fromAttribute: true });
      }
    }
  }

  return phrases;
};

/**
 * Two or more Latin words with at least one written in lower case. The
 * lower-case requirement is what keeps proper-noun rows ("React / Vue / Angular",
 * "Typed JSON") out of the offender list without an exemption for each one.
 */
const isEnglishProse = ({ text, fromAttribute }: Phrase): boolean => {
  // The Cyrillic veto is skipped for attributes, and only for attributes.
  // Attribute values are routinely an English frame with one translated word
  // interpolated into it (`aria-label={`Toggle theme (current: ${label})`}`),
  // and the veto made every such string invisible: one Cyrillic character
  // anywhere cleared the whole phrase. Measured across all 74 Russian chrome
  // pages, lifting it here yields three hits — two real defects and the
  // deliberate `data-lang-exempt` one — and zero false positives. Lifting it
  // for text nodes was measured too: 302 hits, nearly all legitimate Russian
  // prose quoting API identifiers. The measurement holds only while attributes
  // carry short labels; labelling a landmark with a route-metadata heading
  // (English module name + Russian subtitle) makes 11 sections false-positive.
  if (!fromAttribute && CYRILLIC.test(text)) {
    return false;
  }
  const words = (text.match(LATIN_WORD) ?? []).filter((word) => word.length >= 2);
  return words.length >= 2 && words.some((word) => word === word.toLowerCase());
};

const englishIn = (element: HTMLElement): string[] => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(STRIP_SELECTOR).forEach((node) => node.remove());
  return [...new Set(visiblePhrases(clone).filter(isEnglishProse).map((phrase) => phrase.text))];
};

const renderRu = (ui: ReactElement, path = '/ru'): HTMLElement => {
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider locale="ru">
        <FrameworkProvider>{ui}</FrameworkProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
  return container;
};

/** Renders one tool's section with the same translated data the real page uses. */
const RussianToolSection: React.FC<{ id: string }> = ({ id }) => {
  const { toolSections } = useToolsTranslations();
  const section = toolSections.find((tool) => tool.id === id);
  if (section === undefined) {
    throw new Error(`unknown tool id: ${id}`);
  }
  return <ToolSection section={section} />;
};

/** Renders one API section with the same translated data the real page uses. */
const RussianApiSection: React.FC<{ id: string }> = ({ id }) => {
  const { apiSections } = useApiTranslations();
  const section = apiSections.find((entry) => entry.id === id);
  if (section === undefined) {
    throw new Error(`unknown api section id: ${id}`);
  }
  return <ApiSectionView section={section} />;
};

const RU_SIDEBAR = [
  { title: 'Начало работы', links: [{ id: 'quick-start', label: 'Быстрый старт' }] },
];

const expectNoEnglish = (container: HTMLElement, surface: string): void => {
  const offenders = englishIn(container);
  expect(
    offenders,
    `${surface} renders English prose on a /ru page:\n${offenders.map((o) => `  · ${o}`).join('\n')}`,
  ).toEqual([]);
};

describe('/ru pages carry no English body prose', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the server page in Russian', () => {
    expectNoEnglish(renderRu(<ServerContent />, '/ru/server'), 'ServerContent');
  });

  it('renders the presets page in Russian', () => {
    expectNoEnglish(renderRu(<PresetsContent />, '/ru/presets'), 'PresetsContent');
  });

  it.each(TOOL_SECTIONS.map((tool) => tool.id))('renders the %s tool docs in Russian', (id) => {
    expectNoEnglish(renderRu(<RussianToolSection id={id} />, `/ru/docs/${id}`), `ToolSection(${id})`);
  });

  it('renders the comparison table in Russian', () => {
    expectNoEnglish(renderRu(<WhyBlok />), 'WhyBlok');
  });

  it('renders the home feature tiles in Russian', () => {
    expectNoEnglish(renderRu(<Features />), 'Features');
  });

  /**
   * The polyglot greeting tile draws one of 69 locales at random on mount, and
   * its hidden measuring twin holds the FULL word however little has been typed.
   * Two of those greetings read as English prose to the heuristic above
   * ("Xin chào", "Përshëndetje"), so the test above failed on roughly one run in
   * 35 until the tile was marked `data-lang-exempt`. The offenders are derived,
   * not listed, so a newly added locale is covered the day it lands.
   */
  const LATIN_GREETINGS = PHRASES
    .map((phrase, index) => ({ code: phrase.code, hello: phrase.hello, index }))
    .filter(({ hello }) => isEnglishProse({ text: hello, fromAttribute: false }));

  it.each(LATIN_GREETINGS)(
    'renders the home feature tiles in Russian while the greeting tile shows $hello',
    ({ index }) => {
      // pickLocaleIndex floors rng() * LANGUAGE_COUNT, so this lands mid-bucket.
      vi.spyOn(Math, 'random').mockReturnValue((index + 0.5) / LANGUAGE_COUNT);
      expectNoEnglish(renderRu(<Features />), 'Features');
    },
  );

  it('renders the docs sidebar in Russian', () => {
    expectNoEnglish(
      renderRu(<Sidebar sections={RU_SIDEBAR} activeSection="quick-start" variant="api" />),
      'Sidebar',
    );
  });

  it('renders code-block chrome in Russian', () => {
    expectNoEnglish(renderRu(<CodeBlock code="npm i @bloklabs/core" language="bash" />), 'CodeBlock');
  });

  it('renders the footer in Russian', () => {
    expectNoEnglish(renderRu(<Footer />), 'Footer');
  });

  it('renders the theme toggle in Russian', () => {
    expectNoEnglish(renderRu(<ThemeToggle />), 'ThemeToggle');
  });

  it.each(API_SECTIONS.map((section) => section.id))(
    'renders the %s API docs in Russian',
    (id) => {
      expectNoEnglish(renderRu(<RussianApiSection id={id} />, `/ru/docs/${id}`), `ApiSection(${id})`);
    },
  );
});
