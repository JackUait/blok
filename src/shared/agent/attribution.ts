/** Who a block an agent writes is credited to: `by` for `createdBy`/`lastEditedBy`, `with` for `createdWith`/`lastEditedWith`. */
export interface Attribution {
  by?: string;
  with?: string;
}

/**
 * The one rule every agent engine stamps with, so engines cannot drift.
 * The person the agent acts for is the author and the agent co-authors.
 * With no person the agent is the author. 'user' credits only the person.
 * @param actor - the agent, and the person it acts for
 * @param attributeTo - 'agent' (default) or 'user'
 * @returns the ids to stamp; an empty id counts as missing
 */
export const agentAttribution = (
  actor: { id: string; onBehalfOf?: string },
  attributeTo: 'agent' | 'user' = 'agent'
): Attribution => {
  const person = actor.onBehalfOf !== undefined && actor.onBehalfOf !== '' ? actor.onBehalfOf : undefined;
  const agent = actor.id !== '' ? actor.id : undefined;

  if (person === undefined) {
    return attributeTo === 'user' || agent === undefined ? {} : { by: agent };
  }

  return attributeTo === 'user' || agent === undefined ? { by: person } : { by: person, with: agent };
};
