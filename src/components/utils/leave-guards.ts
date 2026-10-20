/**
 * Questions a part of the editor asks before an in-app navigation, such as a
 * layout builder with unsaved edits. `blok.confirmLeave()` asks them.
 */
interface LeaveGuard {
  /** Where the asker lives; only the editor that contains it asks. */
  anchor: Element;
  /** Resolves true to leave, false to stay. */
  ask: () => Promise<boolean>;
}

const guards = new Set<LeaveGuard>();

/**
 * Register a question to ask before leaving.
 * @param anchor - an element inside the editor the question belongs to
 * @param ask - resolves true to leave, false to stay
 * @returns a function that removes the question
 */
export const holdLeave = (anchor: Element, ask: () => Promise<boolean>): (() => void) => {
  const guard: LeaveGuard = { anchor, ask };

  guards.add(guard);

  return () => {
    guards.delete(guard);
  };
};

/**
 * Ask every question anchored inside `root`, one at a time.
 * @param root - the editor's wrapper
 * @returns true when every question lets the user leave
 */
export const askLeave = async (root: Element): Promise<boolean> => {
  for (const guard of [ ...guards ]) {
    // A question removed while an earlier one was open is no longer asked.
    if (!guards.has(guard) || !root.contains(guard.anchor)) continue;
    if (!(await guard.ask())) return false;
  }

  return true;
};
