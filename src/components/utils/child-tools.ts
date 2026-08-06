import type { ChildToolRestrictions } from '../../../types/tools';
import type { Block } from '../block';

/**
 * Per-container child-tool restrictions — the generic form of the Table tool's
 * `restrictedTools`.
 *
 * The table's version is a module-level registry whose every enforcement point
 * asks "is this inside a table cell?" (`isInsideTableCell`, keyed on the
 * `data-blok-table-cell-blocks` attribute), so no OTHER container could declare
 * what may be its child. `ownsChildren` is the only other lever and it is
 * all-or-nothing AND move-only. A container tool was therefore left defending
 * itself downstream — filtering `child.name` in render, keeping its CSS robust
 * against a foreign child, migrating strays out of stored documents.
 *
 * Enforcement is deliberately shaped like the table's, because that shape is
 * already proven here: a disallowed tool is DEMOTED on insert (never refused —
 * an Enter keypress must always produce a block) and a cross-boundary move that
 * would carry one in is REFUSED.
 */

/**
 * The restrictions a container block's tool declares, or undefined when it
 * accepts any child. An empty `allow`/`deny` reads as "no restriction" so a
 * tool computing the lists cannot accidentally lock its container down.
 * @param parent - the container block whose tool declares the restrictions
 */
export const getChildToolRestrictions = (
  parent: Block | undefined | null
): ChildToolRestrictions | undefined => {
  const declared = parent?.tool?.childTools;

  if (declared === undefined || declared === null) {
    return undefined;
  }

  const hasAllow = Array.isArray(declared.allow) && declared.allow.length > 0;
  const hasDeny = Array.isArray(declared.deny) && declared.deny.length > 0;

  return hasAllow || hasDeny ? declared : undefined;
};

/**
 * Whether `toolName` satisfies an already-resolved declaration. `deny` wins over
 * `allow`, so a tool named in both is rejected.
 *
 * Takes the declaration rather than a Block so surfaces that only hold a tool
 * ADAPTER (the toolbox reads `api.tools.getBlockTools()`, never Block
 * instances) can ask the same question without faking a Block.
 * @param restrictions - the container's declaration, or undefined for none
 * @param toolName - name of the block tool being placed
 */
export const satisfiesChildToolRestrictions = (
  restrictions: ChildToolRestrictions | undefined,
  toolName: string
): boolean => {
  if (restrictions === undefined) {
    return true;
  }

  if (restrictions.deny?.includes(toolName) === true) {
    return false;
  }

  if (Array.isArray(restrictions.allow) && restrictions.allow.length > 0) {
    return restrictions.allow.includes(toolName);
  }

  return true;
};

/**
 * Whether `toolName` may be a direct child of `parent`.
 * @param parent - the prospective parent block (undefined/null = root, always allowed)
 * @param toolName - name of the block tool being placed
 */
export const isChildToolAllowed = (
  parent: Block | undefined | null,
  toolName: string
): boolean => satisfiesChildToolRestrictions(getChildToolRestrictions(parent), toolName);

/**
 * The tool a child insert should actually create: the requested one when the
 * parent permits it, otherwise the container's own first `allow` entry (so
 * "Enter at the end of a segment makes another segment"), falling back to the
 * editor's default block when only a `deny` list is declared.
 * @param parent - the prospective parent block (undefined/null = root)
 * @param requestedTool - the tool the caller asked for
 * @param defaultBlock - the editor's `config.defaultBlock`
 */
export const resolveChildTool = (
  parent: Block | undefined | null,
  requestedTool: string,
  defaultBlock: string
): string => {
  if (isChildToolAllowed(parent, requestedTool)) {
    return requestedTool;
  }

  return getChildToolRestrictions(parent)?.allow?.[0] ?? defaultBlock;
};

/**
 * Which of `candidateToolNames` the declaration does NOT permit — the set an
 * insertion surface (toolbox) must hide while the caret sits in one of the
 * container's children. Empty when nothing is declared.
 * @param restrictions - the container's declaration, or undefined for none
 * @param candidateToolNames - tool names the surface would otherwise offer
 */
export const restrictedChildToolNames = (
  restrictions: ChildToolRestrictions | undefined,
  candidateToolNames: string[]
): string[] => {
  if (restrictions === undefined) {
    return [];
  }

  return candidateToolNames.filter(
    (toolName) => !satisfiesChildToolRestrictions(restrictions, toolName)
  );
};
