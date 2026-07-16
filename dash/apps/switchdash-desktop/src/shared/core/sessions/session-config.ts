import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';
import { sessionLifecycleStatuses } from './sessions';

const v1Schema = z.object({
  version: z.literal('1'),
  name: z.string(),
  initialConversation: z
    .object({
      id: z.string(),
      provider: z.string(),
      title: z.string().optional(),
      autoApprove: z.boolean().optional(),
      initialPrompt: z.string().optional(),
    })
    .optional(),
  initialStatus: sessionLifecycleStatuses.optional(),
});

export const sessionConfig = defineVersionedSchema().initial('1', v1Schema).build();

export const sessionConfigSchema = sessionConfig.schema;
export type SessionConfig = typeof sessionConfig.Type;
