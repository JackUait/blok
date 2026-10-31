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

type Pair = { ours: ComparableNode; theirs: ComparableNode; path: string };

/** A node pair to compare, the child lists of a pair whose own checks passed, or a known failure to report in turn. */
type Task = (Pair & { kind: 'node' }) | (Pair & { kind: 'children' }) | { kind: 'fail'; message: string };

const checkNode = (ours: ComparableNode, theirs: ComparableNode, path: string): string | null => {
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

  return null;
};

/** Tasks for a child list: each child in order, with a wrong parentNode reported where the walk reaches it. */
const childTasks = (ours: ComparableNode, theirs: ComparableNode, path: string): Task[] | string => {
  const ourChildren = ours.childNodes ?? [];
  const theirChildren = theirs.childNodes ?? [];

  if (ourChildren.length !== theirChildren.length) {
    return `${path}: ${ourChildren.length} children, parse5 has ${theirChildren.length}`;
  }

  return ourChildren.map((child, index): Task =>
    child.parentNode === ours
      ? { kind: 'node', ours: child, theirs: theirChildren[index], path: `${path}/${index}:${child.nodeName}` }
      : { kind: 'fail', message: `${path}/${index}: parentNode is not its parent` }
  );
};

/** Checks one pair, then queues its template content and then its children. */
const visitNode = (task: Pair, stack: Task[]): string | null => {
  const difference = checkNode(task.ours, task.theirs, task.path);

  if (difference !== null) {
    return difference;
  }
  stack.push({ ...task, kind: 'children' });
  if (task.ours.content !== undefined && task.theirs.content !== undefined) {
    stack.push({ kind: 'node', ours: task.ours.content, theirs: task.theirs.content, path: `${task.path}#content` });
  }

  return null;
};

/**
 * Pre-order, with an explicit stack instead of recursion: trees from real
 * pages nest deeper than the call stack. The first difference found is the
 * same one a recursive walk finds.
 */
export const compareTrees = (ours: ComparableNode, theirs: ComparableNode, path = ''): string | null => {
  const stack: Task[] = [{ kind: 'node', ours, theirs, path }];

  for (let task = stack.pop(); task !== undefined; task = stack.pop()) {
    if (task.kind === 'fail') {
      return task.message;
    }
    const tasks = task.kind === 'node' ? visitNode(task, stack) : childTasks(task.ours, task.theirs, task.path);

    if (typeof tasks === 'string') {
      return tasks;
    }
    if (Array.isArray(tasks)) {
      stack.push(...tasks.reverse());
    }
  }

  return null;
};
