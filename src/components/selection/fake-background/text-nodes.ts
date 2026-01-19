/**
 * Text node utilities for fake background functionality.
 */
export class FakeBackgroundTextNodes {
  /**
   * Collects text nodes that intersect with the passed range
   * @param range - selection range
   */
  static collectTextNodes(range: Range): Text[] {
    const nodes: Text[] = [];
    const { commonAncestorContainer } = range;

    if (commonAncestorContainer.nodeType === Node.TEXT_NODE) {
      nodes.push(commonAncestorContainer as Text);
      return nodes;
    }

    const walker = document.createTreeWalker(
      commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node: Node): number => {
          if (!range.intersectsNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          return node.textContent && node.textContent.length > 0
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );

    while (walker.nextNode()) {
      nodes.push(walker.currentNode as Text);
    }

    return nodes;
  }

  /**
   * Finds positions in text where line breaks occur
   * @param textNode - the text node to analyze
   * @param expectedLines - expected number of lines
   */
  static findLineBreakPositions(textNode: Text, expectedLines: number): number[] {
    const text = textNode.textContent || '';
    const range = document.createRange();
    const indices = Array.from({ length: text.length }, (_, i) => i);

    const result = indices.reduce(
      (acc: { positions: number[]; lastTop: number }, i: number) => {
        if (acc.positions.length >= expectedLines - 1) {
          return acc;
        }

        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);

        const rect = range.getBoundingClientRect();
        const isLineBreak = acc.lastTop !== -1 && Math.abs(rect.top - acc.lastTop) > 5;

        if (isLineBreak) {
          acc.positions.push(i);
        }

        return { positions: acc.positions, lastTop: rect.top };
      },
      { positions: [], lastTop: -1 }
    );

    return result.positions;
  }

  /**
   * Splits text content at given positions
   * @param text - the text to split
   * @param positions - array of split positions
   */
  static splitTextAtPositions(text: string, positions: number[]): string[] {
    const breakPoints = [0, ...positions, text.length];

    return breakPoints.slice(0, -1).map((start, idx) => {
      return text.substring(start, breakPoints[idx + 1]);
    }).filter((segment) => segment.length > 0);
  }
}
