/**
 * The turn-into rules both the editor (BlockManager.convert) and the agent
 * planner (planConvert) follow. Pure and data-only: the editor reads its
 * inputs from the DOM, the planner from saved data.
 */

type Data = Readonly<Record<string, unknown>>;

/** Only a callout keeps its text in its first child block. A turn-into hoists that child's text, or seeds one. */
export const textLivesInFirstChild = (type: string): boolean => type === 'callout';

export const isToggleHeadingData = (type: string, data?: Data): boolean =>
  type === 'header' && data?.isToggleable === true;

/**
 * Whether turning a block into `targetType` moves its children up to its own
 * level instead of keeping them nested (Notion). A toggle heading does, unless
 * it stays a toggle heading; a toggle list keeps them. A callout does, unless
 * it becomes a toggle: its lines are its content, and only a toggle shows them nested.
 */
export const releasesChildrenOnConvert = (
  source: { type: string; isToggleHeading: boolean },
  targetType: string,
  targetData?: Data
): boolean => {
  const targetIsToggleHeading = isToggleHeadingData(targetType, targetData);

  if (textLivesInFirstChild(source.type)) {
    return targetType !== 'toggle' && !targetIsToggleHeading;
  }

  return source.isToggleHeading && !targetIsToggleHeading;
};

/**
 * Whether the new block adopts the section that follows it: every next sibling
 * up to a heading of the same or higher rank. Only a block that was not a
 * toggle already (toggle list or toggle heading) and becomes a toggle heading.
 */
export const adoptsSectionOnConvert = (sourceIsToggle: boolean, targetType: string, targetData?: Data): boolean =>
  isToggleHeadingData(targetType, targetData) && !sourceIsToggle;

/** A heading of the same or higher rank ends the section a toggle heading adopts. */
export const endsSection = (candidateLevel: number | null, level: number): boolean =>
  candidateLevel !== null && candidateLevel <= level;

/**
 * The source's block colours a turn-into keeps: a colour the new data does not
 * set yet, onto a target that stores the field. A target whose import sets the
 * field (a callout sets null) keeps its own.
 */
export const carriedBlockColors = (source: Data, next: Data, keeps: (field: string) => boolean): Record<string, string> =>
  Object.fromEntries((['textColor', 'backgroundColor'] as const).flatMap((field) => {
    const value = source[field];

    return typeof value === 'string' && next[field] === undefined && keeps(field) ? [[field, value]] : [];
  }));
