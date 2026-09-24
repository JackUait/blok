/**
 * Order a parent's children the way the editor does on load (`toDepthFirstOrder`
 * in renderer.ts): first those its `content` lists, in that order, then the
 * rest in their input order. Ids in `content` that name no child are ignored.
 * @param children - the parent's children, in input order
 * @param content - child ids the parent lists
 */
export const orderByContent = <T extends { id?: string }>(children: T[], content: readonly string[]): T[] => {
  const rank = new Map<string, number>();

  content.forEach((id, index) => {
    if (!rank.has(id)) {
      rank.set(id, index);
    }
  });

  const rankOf = (child: T): number =>
    (child.id === undefined ? undefined : rank.get(child.id)) ?? content.length;

  // Array.prototype.sort is stable, so unlisted children keep input order.
  return [...children].sort((a, b) => rankOf(a) - rankOf(b));
};
