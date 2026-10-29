/**
 * Structural comparison of two parsed trees of parse5's default shape.
 * Returns where they first differ, or null when they match.
 */
export interface ComparableNode {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  childNodes?: readonly ComparableNode[];
  content?: ComparableNode;
  parentNode?: unknown;
  value?: string;
  data?: string;
  name?: string;
  publicId?: string;
  systemId?: string;
  mode?: string;
}

/** Every own key of an attribute: `prefix: ''` (xmlns) is not the same as no prefix. */
const attrKey = (attr: Readonly<Record<string, unknown>>): string =>
  JSON.stringify(Object.keys(attr).sort().map((key) => [key, attr[key]]));

const SCALARS = ['nodeName', 'tagName', 'namespaceURI', 'value', 'data', 'name', 'publicId', 'systemId', 'mode'] as const;

const checkChildren = (ours: ComparableNode, theirs: ComparableNode, path: string): string | null => {
  const ourChildren = ours.childNodes ?? [];
  const theirChildren = theirs.childNodes ?? [];

  if (ourChildren.length !== theirChildren.length) {
    return `${path}: ${ourChildren.length} children, parse5 has ${theirChildren.length}`;
  }

  for (const [index, child] of ourChildren.entries()) {
    if (child.parentNode !== ours) {
      return `${path}/${index}: parentNode is not its parent`;
    }

    const difference = compareTrees(child, theirChildren[index], `${path}/${index}:${child.nodeName}`);

    if (difference !== null) {
      return difference;
    }
  }

  return null;
};

export const compareTrees = (ours: ComparableNode, theirs: ComparableNode, path = ''): string | null => {
  for (const key of SCALARS) {
    if (ours[key] !== theirs[key]) {
      return `${path}: ${key} ${JSON.stringify(ours[key])} vs parse5 ${JSON.stringify(theirs[key])}`;
    }
  }

  const ourAttrs = (ours.attrs ?? []).map(attrKey).join('|');
  const theirAttrs = (theirs.attrs ?? []).map(attrKey).join('|');

  if (ourAttrs !== theirAttrs) {
    return `${path}: attrs ${ourAttrs} vs parse5 ${theirAttrs}`;
  }

  if ((ours.content === undefined) !== (theirs.content === undefined)) {
    return `${path}: template content present in only one tree`;
  }

  if (ours.content !== undefined && theirs.content !== undefined) {
    const difference = compareTrees(ours.content, theirs.content, `${path}#content`);

    if (difference !== null) {
      return difference;
    }
  }

  return checkChildren(ours, theirs, path);
};
