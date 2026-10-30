const sessions = { count: 0 };

/** The next editor agent session's id. Shared, so a turn begun before the agent code loads keeps its id. */
export const nextEditorSessionId = (): string => `editor-session-${++sessions.count}`;
