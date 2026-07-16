export type SessionSessionLeafIds = {
  conversationIds: string[];
  terminalIds: string[];
};

/**
 * In switchdash a session is 1:1 with its conversation (the agent run) and with
 * its single shell, so the only leaf id is the session id itself.
 */
export async function getSessionSessionLeafIds(
  _projectId: string,
  sessionId: string
): Promise<SessionSessionLeafIds> {
  return {
    conversationIds: [sessionId],
    terminalIds: [],
  };
}
