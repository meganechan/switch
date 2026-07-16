import type { AppDb } from '@main/db/client';
import { agents, messages, projects, projectSettings, sessions } from '@main/db/schema';

// Fixed UUIDs so fixture content is stable across regenerations.
const PROJECT_A_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_B_ID = '22222222-2222-2222-2222-222222222222';

const AGENT_A_ID = 'a9e70001-0000-0000-0000-000000000000';
const AGENT_B_ID = 'a9e70002-0000-0000-0000-000000000000';

const TASK_A1_ID = 'aaaa0001-0000-0000-0000-000000000000';
const TASK_A2_ID = 'aaaa0002-0000-0000-0000-000000000000';
const TASK_A3_ID = 'aaaa0003-0000-0000-0000-000000000000';
const TASK_B1_ID = 'bbbb0001-0000-0000-0000-000000000000';

const MSG_A1_ID = 'dddd0001-0000-0000-0000-000000000000';
const MSG_A2_ID = 'dddd0002-0000-0000-0000-000000000000';

/**
 * Realistic but fully synthetic dataset — no sensitive data.
 * Represents a developer's day-to-day switchdash state: two projects, each with
 * a Switch agent, four sessions across various lifecycle statuses, and a couple
 * of messages.
 */
export async function baseline(db: AppDb): Promise<void> {
  await db.insert(projects).values([
    {
      id: PROJECT_A_ID,
      name: 'switchdash',
      path: '/home/dev/projects/switchdash',
    },
    {
      id: PROJECT_B_ID,
      name: 'my-api',
      path: '/home/dev/projects/my-api',
    },
  ]);

  await db
    .insert(projectSettings)
    .values([{ projectId: PROJECT_A_ID }, { projectId: PROJECT_B_ID }]);

  await db.insert(agents).values([
    {
      id: AGENT_A_ID,
      projectId: PROJECT_A_ID,
      name: 'switchdash',
      providerId: 'claude',
      switchAgentId: 'switch-agent-a',
      apiEndpoint: 'https://switch.example.com',
    },
    {
      id: AGENT_B_ID,
      projectId: PROJECT_B_ID,
      name: 'my-api',
      providerId: 'claude',
      switchAgentId: 'switch-agent-b',
      apiEndpoint: 'https://switch.example.com',
    },
  ]);

  await db.insert(sessions).values([
    {
      id: TASK_A1_ID,
      agentId: AGENT_A_ID,
      title: 'Add workspace database entity',
      status: 'in_progress',
      isInitialSession: true,
    },
    {
      id: TASK_A2_ID,
      agentId: AGENT_A_ID,
      title: 'Improve migration test tooling',
      status: 'review',
    },
    {
      id: TASK_A3_ID,
      agentId: AGENT_A_ID,
      title: 'Fix SSH connection timeout',
      status: 'done',
      archivedAt: '2026-04-01T10:00:00.000Z',
    },
    {
      id: TASK_B1_ID,
      agentId: AGENT_B_ID,
      title: 'Add rate limiting middleware',
      status: 'todo',
    },
  ]);

  await db.insert(messages).values([
    {
      id: MSG_A1_ID,
      sessionId: TASK_A1_ID,
      content: 'Plan workspace schema',
      sender: 'user',
    },
    {
      id: MSG_A2_ID,
      sessionId: TASK_A2_ID,
      content: 'Design fixture tooling',
      sender: 'user',
    },
  ]);
}
