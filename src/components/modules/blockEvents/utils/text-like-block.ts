import type { BlockToolAdapter } from '../../../tools/block';

/**
 * Whether a block is "text-like" -- the kind of block where an inline command
 * trigger ("/" for the toolbox, ":" for the emoji menu) should open a menu
 * rather than be typed as a literal character (Code, Table...).
 *
 * A block is text-like when its tool is the default block, or when it opts
 * into the inline toolbar AND does not manage its own line breaks. Tools that
 * manage line breaks own the full keyboard inside their content, so a trigger
 * character must stay literal there.
 *
 * When no tool can be resolved the block is treated as text-like so the
 * regular paragraph/header menus are never blocked.
 * @param tool - the current block's tool, or undefined when no block is resolved
 */
export function isTextLikeBlock(tool: BlockToolAdapter | undefined): boolean {
  if (tool === undefined) {
    return true;
  }

  if (tool.isDefault) {
    return true;
  }

  if (tool.isLineBreaksEnabled) {
    return false;
  }

  return tool.enabledInlineTools !== false;
}
