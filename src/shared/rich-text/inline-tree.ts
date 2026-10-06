export type InlineNode =
  | { kind: 'text'; value: string }
  | { kind: 'element'; tag: string; attrs: Record<string, string>; children: InlineNode[]; outerHtml: string };
