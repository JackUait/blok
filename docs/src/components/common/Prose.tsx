import { Fragment, type ReactNode } from 'react';
import { useI18n } from '../../contexts/I18nContext';
import { applyTypography } from '../../utils/typography';
import type { Locale } from '../../i18n';

interface ProseProps {
  /** One documentation value. Blank lines split paragraphs, "- " starts a list. */
  text: string;
  /** Applied to every paragraph and list so callers keep their own type scale. */
  className?: string;
}

const codeClass =
  'rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground';

/** Stacked blocks need air between them; the first one must not push the heading. */
const blockClass = 'mt-3 first:mt-0';
const listClass = `${blockClass} list-disc space-y-1 pl-5`;
const subListClass = 'mt-1 list-[circle] space-y-1 pl-5';

/** A list item and, when the author indented lines under it, its sub-items. */
interface Item {
  text: string;
  children: string[];
}

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: Item[] };

/** Two spaces before the dash is what makes an item a sub-item. */
const LIST_LINE = /^(\s*)-\s+(.*)$/;

/**
 * Split one documentation value into paragraphs and lists. The grammar is
 * deliberately tiny: a blank line ends a block, a "- " line is an item, and two
 * leading spaces put the item under the one above. Anything else is prose, and
 * consecutive prose lines join into a single paragraph so a value can be wrapped
 * in the JSON bundle without changing what a reader sees.
 */
export const parseProse = (text: string): Block[] => {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Item[] | null = null;

  const closeParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  const closeList = (): void => {
    if (list !== null && list.length > 0) {
      blocks.push({ kind: 'list', items: list });
    }
    list = null;
  };

  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      closeParagraph();
      closeList();
      continue;
    }

    const item = LIST_LINE.exec(line);

    if (item === null) {
      closeList();
      paragraph.push(line.trim());
      continue;
    }

    closeParagraph();

    const nested = item[1].length >= 2;
    const body = item[2].trim();

    if (list === null) {
      list = [];
    }

    // A sub-item with no parent above it is an authoring slip; treat it as a
    // top-level item rather than dropping the text.
    if (nested && list.length > 0) {
      list[list.length - 1].children.push(body);
    } else {
      list.push({ text: body, children: [] });
    }
  }

  closeParagraph();
  closeList();

  return blocks;
};

/**
 * Render backticked spans as code and typographically correct everything else.
 * Typography is applied per text run and never to a code span: an identifier a
 * reader copies must not pick up a non-breaking space.
 */
const renderRuns = (text: string, locale: Locale): ReactNode =>
  text.split(/(`[^`]+`)/g).map((part, index) => (
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code key={index} className={codeClass}>{part.slice(1, -1)}</code>
    ) : (
      <Fragment key={index}>{applyTypography(part, locale)}</Fragment>
    )
  ));

/**
 * The block-level renderer for documentation prose. Use it wherever a value can
 * run past a few sentences; `Typo` still fits a label or a single line, but it
 * flattens a whole value into one paragraph and prints backticks literally.
 */
export const Prose = ({ text, className }: ProseProps) => {
  const { locale } = useI18n();

  return (
    <>
      {parseProse(text).map((block, index) => (
        block.kind === 'paragraph' ? (
          <p key={index} className={[blockClass, className].filter(Boolean).join(' ')}>
            {renderRuns(block.text, locale)}
          </p>
        ) : (
          <ul key={index} className={[listClass, className].filter(Boolean).join(' ')}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                {renderRuns(item.text, locale)}
                {item.children.length > 0 && (
                  <ul className={subListClass}>
                    {item.children.map((child, childIndex) => (
                      <li key={childIndex}>{renderRuns(child, locale)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )
      ))}
    </>
  );
};
