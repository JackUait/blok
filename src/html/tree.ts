/**
 * The tree the parser builds: plain objects, the same shape as parse5's
 * default tree adapter (MIT, see NOTICE) without source locations, so code
 * that walked parse5 nodes walks these unchanged.
 */
import type { Attribute } from './token';
import { DOCUMENT_MODE, type NS } from './tags';

export interface Document {
  nodeName: '#document';
  mode: DOCUMENT_MODE;
  childNodes: ChildNode[];
}

export interface DocumentFragment {
  nodeName: '#document-fragment';
  childNodes: ChildNode[];
}

export interface Element {
  nodeName: string;
  tagName: string;
  attrs: Attribute[];
  namespaceURI: NS;
  parentNode: ParentNode | null;
  childNodes: ChildNode[];
}

/** An HTML `<template>`: its parsed children live in `content`, not `childNodes`. */
export interface Template extends Element {
  nodeName: 'template';
  tagName: 'template';
  content: DocumentFragment;
}

export interface CommentNode {
  nodeName: '#comment';
  parentNode: ParentNode | null;
  data: string;
}

export interface TextNode {
  nodeName: '#text';
  parentNode: ParentNode | null;
  value: string;
}

export interface DocumentType {
  nodeName: '#documentType';
  parentNode: ParentNode | null;
  name: string;
  publicId: string;
  systemId: string;
}

export type ParentNode = Document | DocumentFragment | Element | Template;
export type ChildNode = Element | Template | CommentNode | TextNode | DocumentType;
export type Node = ParentNode | ChildNode;

export const createDocument = (): Document => ({ nodeName: '#document', mode: DOCUMENT_MODE.NO_QUIRKS, childNodes: [] });

export const createDocumentFragment = (): DocumentFragment => ({ nodeName: '#document-fragment', childNodes: [] });

export const createElement = (tagName: string, namespaceURI: NS, attrs: Attribute[]): Element => ({
  nodeName: tagName,
  tagName,
  attrs,
  namespaceURI,
  childNodes: [],
  parentNode: null,
});

export const createCommentNode = (data: string): CommentNode => ({ nodeName: '#comment', data, parentNode: null });

export const createTextNode = (value: string): TextNode => ({ nodeName: '#text', value, parentNode: null });

export const isElementNode = (node: Node): node is Element => Object.prototype.hasOwnProperty.call(node, 'tagName');

export const isTextNode = (node: Node): node is TextNode => node.nodeName === '#text';

export const isDocumentTypeNode = (node: Node): node is DocumentType => node.nodeName === '#documentType';

export const appendChild = (parentNode: ParentNode, newNode: ChildNode): void => {
  parentNode.childNodes.push(newNode);
  // eslint-disable-next-line no-param-reassign -- the tree is built by mutation
  newNode.parentNode = parentNode;
};

/*
 * lastIndexOf, not indexOf: a foster-parenting <table> sits at the end, so
 * indexOf from the front made long foster-parented runs quadratic. A node
 * sits in one array once, so both find the same index.
 */
export const insertBefore = (parentNode: ParentNode, newNode: ChildNode, referenceNode: ChildNode): void => {
  parentNode.childNodes.splice(parentNode.childNodes.lastIndexOf(referenceNode), 0, newNode);
  // eslint-disable-next-line no-param-reassign -- the tree is built by mutation
  newNode.parentNode = parentNode;
};

export const detachNode = (node: ChildNode): void => {
  const parent = node.parentNode;

  if (parent === null) {
    return;
  }
  parent.childNodes.splice(parent.childNodes.lastIndexOf(node), 1);
  // eslint-disable-next-line no-param-reassign -- the tree is built by mutation
  node.parentNode = null;
};

/** Appends text, merging it into a text node already at the end. */
export const insertText = (parentNode: ParentNode, text: string): void => {
  const last = parentNode.childNodes.at(-1);

  if (last !== undefined && isTextNode(last)) {
    last.value += text;

    return;
  }
  appendChild(parentNode, createTextNode(text));
};

/** Inserts text before a node, merging it into a text node right before it. */
export const insertTextBefore = (parentNode: ParentNode, text: string, referenceNode: ChildNode): void => {
  const previous = parentNode.childNodes[parentNode.childNodes.lastIndexOf(referenceNode) - 1];

  if (previous !== undefined && isTextNode(previous)) {
    previous.value += text;

    return;
  }
  insertBefore(parentNode, createTextNode(text), referenceNode);
};

/** Adds the attributes the element does not have yet (a second `<html>` or `<body>` tag). */
export const adoptAttributes = (recipient: Element, attrs: Attribute[]): void => {
  const present = new Set(recipient.attrs.map((attr) => attr.name));

  recipient.attrs.push(...attrs.filter((attr) => !present.has(attr.name)));
};

export const setTemplateContent = (template: Element, content: DocumentFragment): void => {
  // eslint-disable-next-line no-param-reassign -- the tree is built by mutation
  (template as Template).content = content;
};

export const setDocumentType = (document: Document, name: string, publicId: string, systemId: string): void => {
  const existing = document.childNodes.find(isDocumentTypeNode);

  if (existing !== undefined) {
    existing.name = name;
    existing.publicId = publicId;
    existing.systemId = systemId;

    return;
  }
  appendChild(document, { nodeName: '#documentType', name, publicId, systemId, parentNode: null });
};

export const setDocumentMode = (document: Document, mode: DOCUMENT_MODE): void => {
  // eslint-disable-next-line no-param-reassign -- the tree is built by mutation
  document.mode = mode;
};
