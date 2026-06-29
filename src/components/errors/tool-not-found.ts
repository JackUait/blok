/**
 * Thrown when a block tool cannot be resolved during a creation/conversion
 * operation (insert, insertMany/composeBlock, composeBlockData, convert).
 *
 * A typed error lets adapters (React/Vue/Angular useBlocks) distinguish a
 * genuinely-unknown tool — an EXPECTED, recoverable outcome they surface as a
 * `null`/`[]` no-op — from a real bug, WITHOUT brittle `message.includes('not
 * found')` substring matching (which both mis-catches unrelated errors whose
 * message happens to contain "not found" and breaks under message localization).
 */
export class ToolNotFoundError extends Error {
  /**
   * @param toolName - the tool type that could not be resolved
   * @param message - optional override; defaults to a descriptive message
   */
  constructor(public readonly toolName: string, message?: string) {
    super(message ?? `Block Tool «${toolName}» not found.`);
    this.name = 'ToolNotFoundError';
  }
}
