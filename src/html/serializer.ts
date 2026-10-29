/* eslint-disable no-restricted-syntax -- += in indexed loops: on V8 it is about 1.6x faster than map/join, and no slower under Jint */
/**
 * HTML serialization, byte for byte what parse5 (MIT, see NOTICE) writes with
 * its default options: scripting on, so noscript text is written raw.
 * Escaping is the HTML spec's "escaping a string", the same rules parse5
 * gets from the entities package.
 */
import { NS, UNESCAPED_TEXT } from './tags';
import type { Attribute } from './token';
import type { ChildNode, Element, Node, ParentNode, TextNode } from './tree';

const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

const TEXT_SPECIAL = /[&<>\u00A0]/;
const TEXT_SPECIAL_ALL = /[&<>\u00A0]/g;
// Attribute values keep < and >: the spec escapes only these three in attribute mode.
const ATTR_SPECIAL = /["&\u00A0]/;
const ATTR_SPECIAL_ALL = /["&\u00A0]/g;

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\u00A0': '&nbsp;' };

const toEntity = (char: string): string => ESCAPES[char];

const escapeText = (text: string): string => (TEXT_SPECIAL.test(text) ? text.replace(TEXT_SPECIAL_ALL, toEntity) : text);

const escapeAttribute = (value: string): string => (ATTR_SPECIAL.test(value) ? value.replace(ATTR_SPECIAL_ALL, toEntity) : value);

// parse5's own element test: own `tagName`, so a plain object passed in by mistake is not an element.
const isElement = (node: Node | null): node is Element => node !== null && Object.prototype.hasOwnProperty.call(node, 'tagName');

const isVoidElement = (node: Node): boolean => isElement(node) && node.namespaceURI === NS.HTML && VOID_ELEMENTS.has(node.tagName);

// Attribute namespaces are plain strings; compare them as strings.
const XML: string = NS.XML;
const XMLNS: string = NS.XMLNS;
const XLINK: string = NS.XLINK;

const attributeName = (attr: Attribute): string => {
  const ns = attr.namespace;

  if (!ns) {
    return attr.name;
  }
  if (ns === XML) {
    return `xml:${attr.name}`;
  }
  if (ns === XMLNS) {
    return attr.name === 'xmlns' ? attr.name : `xmlns:${attr.name}`;
  }
  if (ns === XLINK) {
    return `xlink:${attr.name}`;
  }

  // A missing prefix prints "undefined", as parse5 does.
  return `${String(attr.prefix)}:${attr.name}`;
};

const serializeAttributes = (attrs: Attribute[]): string => {
  let html = '';

  for (let i = 0; i < attrs.length; i++) {
    html += ' ' + attributeName(attrs[i]) + '="' + escapeAttribute(attrs[i].value) + '"';
  }

  return html;
};

// Raw or escaped is the text node's own parent's call, not the caller's, as in parse5.
const serializeText = (node: TextNode): string => {
  const parent = node.parentNode;

  return isElement(parent) && parent.namespaceURI === NS.HTML && UNESCAPED_TEXT.has(parent.tagName) ? node.value : escapeText(node.value);
};

/** The children a node writes: a template writes its content. */
const childrenOf = (node: ParentNode): ChildNode[] =>
  isElement(node) && node.tagName === 'template' && node.namespaceURI === NS.HTML && 'content' in node ? node.content.childNodes : node.childNodes;

/** A node that is not an element: text, comment or doctype. */
const serializeLeaf = (node: ChildNode): string => {
  switch (node.nodeName) {
    case '#text':
      return 'value' in node ? serializeText(node) : '';
    case '#comment':
      return 'data' in node ? `<!--${node.data}-->` : '';
    case '#documentType':
      return 'name' in node ? `<!DOCTYPE ${node.name}>` : '';
    default:
      return '';
  }
};

interface Frame {
  children: ChildNode[];
  index: number;
  /** End tag written once every child is out. */
  close: string;
}

/**
 * Writes the nodes in order. An explicit stack, not recursion: the parser
 * builds trees far deeper than the call stack, and they must still serialize.
 */
const serializeNodes = (nodes: ChildNode[]): string => {
  const stack: Frame[] = [{ children: nodes, index: 0, close: '' }];
  let html = '';

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];

    if (frame.index === frame.children.length) {
      html += frame.close;
      stack.pop();
      continue;
    }
    const node = frame.children[frame.index++];

    if (!isElement(node)) {
      html += serializeLeaf(node);
      continue;
    }
    html += '<' + node.tagName + serializeAttributes(node.attrs) + '>';
    if (isVoidElement(node)) {
      continue;
    }
    const children = childrenOf(node);

    if (children.length === 0) {
      html += '</' + node.tagName + '>';
    } else {
      stack.push({ children, index: 0, close: '</' + node.tagName + '>' });
    }
  }

  return html;
};

/** Inner HTML of a document, fragment or element. A template writes its content. */
export const serialize = (node: ParentNode): string => (isVoidElement(node) ? '' : serializeNodes(childrenOf(node)));

/** Outer HTML: the node itself, with its tag for an element. */
export const serializeOuter = (node: ChildNode): string => serializeNodes([node]);
