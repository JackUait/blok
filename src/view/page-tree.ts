import type { PageIcon, PageInfo } from '../../types/tools/page';

import type { PageOwnerEdge } from './page-index';

export interface HostPageEdge extends PageOwnerEdge {
  ownerPageId: string | null;
}

export interface PageTreeNode {
  pageId: string;
  sourceBlockId: string;
  order: number;
  access: 'allowed' | 'none' | 'missing';
  title?: string;
  icon?: PageIcon;
  children: PageTreeNode[];
}

export type PageTreeDiagnostic =
  | { kind: 'duplicate-owner'; pageId: string; edges: HostPageEdge[] }
  | { kind: 'cycle'; pageId: string; path: string[] }
  | { kind: 'missing-page'; pageId: string; sourceBlockId: string }
  | { kind: 'missing-owner'; pageId: string }
  | { kind: 'unreachable'; pageId: string; sourceBlockId: string };

export interface PageTreeProjection {
  roots: PageTreeNode[];
  diagnostics: PageTreeDiagnostic[];
}

interface PositionedEdge {
  edge: HostPageEdge;
  inputOrder: number;
}

export const projectPageTree = (
  edges: readonly HostPageEdge[],
  metadata: Readonly<Record<string, PageInfo | null | undefined>>
): PageTreeProjection => {
  const diagnostics: PageTreeDiagnostic[] = [];
  const owners = new Map<string, PositionedEdge[]>();

  edges.forEach((edge, inputOrder) => {
    const entry = { edge, inputOrder };
    const group = owners.get(edge.pageId);

    if (group === undefined) {
      owners.set(edge.pageId, [entry]);
    } else {
      group.push(entry);
    }
  });

  const unique = new Map<string, PositionedEdge>();

  for (const [pageId, group] of owners) {
    // Pointers in one document are entry points to one page; the first owns it.
    const sameDocument = group.every(({ edge }) => edge.ownerPageId === group[0].edge.ownerPageId);

    if (group.length > 1 && !sameDocument) {
      diagnostics.push({
        kind: 'duplicate-owner',
        pageId,
        edges: group.map(({ edge }) => edge),
      });
    } else {
      unique.set(pageId, group.reduce((first, entry) => (entry.edge.order < first.edge.order ? entry : first)));
    }
  }

  const checked = new Set<string>();
  const cyclic = new Set<string>();

  const inspectChain = (pageId: string): void => {
    const path: string[] = [];
    const visiting = new Map<string, number>();
    const pending: Array<string | null> = [pageId];

    while (pending.length > 0) {
      const current = pending.pop();

      if (current === null || current === undefined || !unique.has(current) || checked.has(current)) {
        break;
      }

      const repeatAt = visiting.get(current);

      if (repeatAt !== undefined) {
        const cycle = path.slice(repeatAt);

        cycle.forEach((id) => cyclic.add(id));
        diagnostics.push({ kind: 'cycle', pageId: current, path: [...cycle, current] });
        break;
      }

      visiting.set(current, path.length);
      path.push(current);
      pending.push(unique.get(current)?.edge.ownerPageId ?? null);
    }

    path.forEach((id) => checked.add(id));
  };

  for (const pageId of unique.keys()) {
    if (!checked.has(pageId)) {
      inspectChain(pageId);
    }
  }

  const byParent = new Map<string | null, PositionedEdge[]>();

  for (const [pageId, positioned] of unique) {
    if (cyclic.has(pageId)) {
      continue;
    }

    const parent = positioned.edge.ownerPageId;
    const siblings = byParent.get(parent);

    if (siblings === undefined) {
      byParent.set(parent, [positioned]);
    } else {
      siblings.push(positioned);
    }
  }

  for (const siblings of byParent.values()) {
    siblings.sort((left, right) =>
      left.edge.order - right.edge.order || left.inputOrder - right.inputOrder
    );
  }

  const makeNode = ({ edge }: PositionedEdge): PageTreeNode => {
    const info = Object.hasOwn(metadata, edge.pageId) ? metadata[edge.pageId] : undefined;
    const node: PageTreeNode = {
      pageId: edge.pageId,
      sourceBlockId: edge.sourceBlockId,
      order: edge.order,
      access: 'missing',
      children: [],
    };

    if (info === null || info === undefined) {
      diagnostics.push({
        kind: 'missing-page',
        pageId: edge.pageId,
        sourceBlockId: edge.sourceBlockId,
      });
    } else if (info.access === 'none') {
      node.access = 'none';
    } else {
      node.access = 'allowed';

      if (info.title !== undefined) {
        node.title = info.title;
      }

      if (info.icon !== undefined) {
        node.icon = info.icon;
      }
    }

    return node;
  };

  const roots: PageTreeNode[] = [];
  const queue: PageTreeNode[] = [];
  const visited = new Set<string>();

  for (const positioned of byParent.get(null) ?? []) {
    const node = makeNode(positioned);

    roots.push(node);
    queue.push(node);
    visited.add(node.pageId);
  }

  const appendChildren = (parent: PageTreeNode): void => {
    for (const positioned of byParent.get(parent.pageId) ?? []) {
      if (visited.has(positioned.edge.pageId)) {
        continue;
      }

      const child = makeNode(positioned);

      parent.children.push(child);
      queue.push(child);
      visited.add(child.pageId);
    }
  };

  for (const parent of queue) {
    appendChildren(parent);
  }

  for (const [pageId, positioned] of unique) {
    if (!visited.has(pageId)) {
      diagnostics.push({
        kind: 'unreachable',
        pageId,
        sourceBlockId: positioned.edge.sourceBlockId,
      });
    }
  }

  for (const pageId of Object.keys(metadata)) {
    if (!owners.has(pageId)) {
      diagnostics.push({ kind: 'missing-owner', pageId });
    }
  }

  return { roots, diagnostics };
};
