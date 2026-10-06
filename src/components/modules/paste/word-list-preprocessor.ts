import { parseUntrustedDocument } from '../../utils/inert-html';

/**
 * Word writes a list as `<p style="mso-list:l0 level1 lfo1">` paragraphs. The
 * bullet or number is plain text in a leading `<span style="mso-list:Ignore">`,
 * so without this pass each item pastes as a paragraph starting with "·".
 * This pass drops that glyph and rebuilds real nested `<ul>`/`<ol>` lists.
 *
 * Runs on the raw clipboard string and on raw HTML pasted into table cells.
 */

const LIST_STYLE = /mso-list\s*:\s*l(\d+)\s+level(\d+)/i;
const IGNORE_STYLE = /mso-list\s*:\s*ignore/i;
// "1." "a)" "(iv)" "IV." — anything else (·, o, §, •) is a bullet.
const ORDERED_GLYPH = /^\(?[0-9a-z]{1,4}[.)]$/i;

interface WordListItem {
  element: Element;
  list: string;
  level: number;
  ordered: boolean;
}

const readItem = (element: Element): WordListItem | null => {
  const match = LIST_STYLE.exec(element.getAttribute('style') ?? '');

  if (match === null) {
    return null;
  }

  const ignored = Array.from(element.querySelectorAll('span[style]'))
    .filter(span => IGNORE_STYLE.test(span.getAttribute('style') ?? ''));
  const glyph = (ignored[0]?.textContent ?? '').replace(/[\s ]+/g, '');

  ignored.forEach(span => span.remove());

  return { element, list: match[1], level: Number(match[2]), ordered: ORDERED_GLYPH.test(glyph) };
};

const isSkippable = (node: Node): boolean =>
  node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === '');

/** The item and the items right after it (same list id), skipping blank text and comments. */
const collectRun = (first: WordListItem, items: Map<Element, WordListItem>): WordListItem[] => {
  const run = [first];
  const siblings = Array.from(first.element.parentNode?.childNodes ?? []);
  const after = siblings.slice(siblings.indexOf(first.element) + 1);

  for (const node of after) {
    if (isSkippable(node)) {
      continue;
    }

    const next = node instanceof Element ? items.get(node) : undefined;

    if (next === undefined || next.list !== first.list) {
      break;
    }

    run.push(next);
  }

  return run;
};

const buildList = (run: WordListItem[], doc: Document): HTMLElement => {
  const listTag = (item: WordListItem): string => (item.ordered ? 'ol' : 'ul');
  const root = doc.createElement(listTag(run[0]));
  const stack: Array<{ level: number; list: HTMLElement }> = [{ level: run[0].level, list: root }];

  for (const item of run) {
    while (stack.length > 1 && stack[stack.length - 1].level > item.level) {
      stack.pop();
    }

    const top = stack[stack.length - 1];
    const parentItem = top.list.lastElementChild;

    // One level deeper at most per step, and only under an existing item.
    if (item.level > top.level && parentItem !== null) {
      const nested = doc.createElement(listTag(item));

      parentItem.appendChild(nested);
      stack.push({ level: top.level + 1, list: nested });
    }

    const li = doc.createElement('li');

    li.append(...Array.from(item.element.childNodes));
    stack[stack.length - 1].list.appendChild(li);
  }

  return root;
};

/**
 * Turn runs of Word `mso-list` paragraphs into `<ul>`/`<ol>` lists without
 * the bullet/number glyph.
 * @param html - raw clipboard HTML string
 * @returns the rewritten HTML, or the input when it has no Word list
 */
export function preprocessWordLists(html: string): string {
  if (!/mso-list/i.test(html)) {
    return html;
  }

  const doc = parseUntrustedDocument(html);
  const items = new Map<Element, WordListItem>();
  const marked = Array.from(doc.body.querySelectorAll('[style]')).filter(element => LIST_STYLE.test(element.getAttribute('style') ?? ''));

  if (marked.length === 0) {
    return html;
  }

  marked.forEach(element => {
    const item = readItem(element);

    // Word also numbers headings with mso-list: those keep their tag and only lose the glyph.
    if (item !== null && element.tagName === 'P' && element.closest('ul, ol') === null) {
      items.set(element, item);
    }
  });

  const done = new Set<Element>();

  for (const item of items.values()) {
    if (done.has(item.element)) {
      continue;
    }

    const run = collectRun(item, items);
    const list = buildList(run, doc);

    item.element.replaceWith(list);
    run.forEach(member => {
      done.add(member.element);
      member.element.remove();
    });
  }

  return doc.documentElement.outerHTML;
}
