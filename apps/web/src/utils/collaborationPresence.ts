/** Keep sessions for sync; show each account only once in the presence UI. */
export function uniqueCollaborators<T extends { id: string }>(sessions: T[]): T[] {
  const users = new Map<string, T>()
  for (const session of sessions) if (!users.has(session.id)) users.set(session.id, session)
  return [...users.values()]
}
