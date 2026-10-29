/**
 * The html5lib tree-construction `.dat` format: a reader for the test files
 * and a serializer for trees. Ported from parse5's test utils (MIT, see NOTICE).
 * The serializer walks any tree of parse5's default shape, so it prints
 * parse5's own trees too.
 */
import { NS } from '../../../src/html/tags';

/** The fields of a parsed node the serializer reads. parse5's and ours both fit. */
export interface DatNode {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: Array<{ name: string; value: string; prefix?: string }>;
  childNodes?: DatNode[];
  content?: DatNode;
  value?: string;
  data?: string;
  name?: string;
  publicId?: string;
  systemId?: string;
}

export interface FragmentContext {
  tagName: string;
  namespaceURI: NS;
}

export interface DatTest {
  input: string;
  expected: string;
  scriptingEnabled: boolean;
  fragmentContext: FragmentContext | null;
  lineNum: number;
}

const createFragmentContext = (tagName: string | undefined): FragmentContext | null => {
  if (tagName === undefined || tagName === '') {
    return null;
  }

  const parts = tagName.split(' ');

  if (parts.length === 1) {
    return { tagName, namespaceURI: NS.HTML };
  }

  const namespaces: Record<string, NS> = { svg: NS.SVG, math: NS.MATHML };

  return { tagName: parts[1], namespaceURI: namespaces[parts[0]] ?? NS.HTML };
};

export const parseDatFile = (testSet: string): DatTest[] => {
  const descriptions: Array<{ line: number; directives: Map<string, string[]> }> = [];
  const state = { directive: '' };

  testSet.split(/\r?\n/).forEach((line, index) => {
    if (line === '#data') {
      descriptions.push({ line: index + 1, directives: new Map() });
    }

    const current = descriptions.at(-1);

    if (current === undefined) {
      return;
    }

    if (line.startsWith('#')) {
      state.directive = line;
      current.directives.set(line, []);
    } else {
      current.directives.get(state.directive)?.push(line);
    }
  });

  return descriptions.map(({ line, directives }) => ({
    input: (directives.get('#data') ?? []).join('\n'),
    expected: (directives.get('#document') ?? []).join('\n'),
    scriptingEnabled: !directives.has('#script-off'),
    fragmentContext: createFragmentContext(directives.get('#document-fragment')?.[0]),
    lineNum: line,
  }));
};

const indentOf = (indent: number): string => '|'.padEnd(indent + 2, ' ');

const namespacePrefix = (namespaceURI: string | undefined): string => {
  if (namespaceURI === NS.SVG) {
    return 'svg ';
  }

  return namespaceURI === NS.MATHML ? 'math ' : '';
};

const serializeNode = (node: DatNode, indent: number): string => {
  const head = indentOf(indent);

  switch (node.nodeName) {
    case '#comment':
      return `${head}<!-- ${node.data ?? ''} -->\n`;
    case '#text':
      return `${head}"${node.value ?? ''}"\n`;
    case '#documentType': {
      const ids = node.publicId || node.systemId ? ` "${node.publicId ?? ''}" "${node.systemId ?? ''}"` : '';

      return `${head}<!DOCTYPE ${node.name ?? ''}${ids}>\n`;
    }
    default:
      break;
  }

  const tagName = node.tagName ?? '';
  const childIndent = indent + 2;
  const attrs = (node.attrs ?? [])
    .map((attr) => `${indentOf(childIndent)}${attr.prefix ? `${attr.prefix} ` : ''}${attr.name}="${attr.value}"\n`)
    .sort()
    .join('');
  const isTemplate = tagName === 'template' && node.namespaceURI === NS.HTML && node.content !== undefined;
  const body = isTemplate && node.content !== undefined
    ? `${indentOf(childIndent)}content\n${serializeNodeList(node.content.childNodes ?? [], childIndent + 2)}`
    : serializeNodeList(node.childNodes ?? [], childIndent);

  return `${head}<${namespacePrefix(node.namespaceURI)}${tagName}>\n${attrs}${body}`;
};

const serializeNodeList = (nodes: DatNode[], indent: number): string =>
  nodes.map((node) => serializeNode(node, indent)).join('');

/** The tree below `root` in the `#document` notation, ending with a newline when not empty. */
export const serializeToDatFileFormat = (root: DatNode): string => serializeNodeList(root.childNodes ?? [], 0);
