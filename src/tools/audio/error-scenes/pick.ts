/** The objects the error card can show for any failure but "file too large". */
export const ERROR_SCENES = ['shattered', 'ink-burst', 'sand', 'pulled-plug'] as const;

export type ErrorSceneName = typeof ERROR_SCENES[number];

const shown: { last: ErrorSceneName | null } = { last: null };

/**
 * Pick an object at random, never the one shown last.
 * @param random - 0..1 source; tests pass a fixed one
 */
export function pickErrorScene(random: () => number = Math.random): ErrorSceneName {
  const rest = ERROR_SCENES.filter((name) => name !== shown.last);
  const pick = rest[Math.min(rest.length - 1, Math.floor(random() * rest.length))];

  shown.last = pick;

  return pick;
}
