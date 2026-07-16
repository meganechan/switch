import z from 'zod';
import { definePluginCapability } from '../../../lib/plugins/capability';

/**
 * Describes how an agent type installs and manages its Switch connector plugin.
 *
 * kind: 'cli'  — the agent exposes a Claude-Code-style plugin marketplace CLI
 *                (`<agent> plugin install/update/uninstall`, `<agent> plugin
 *                marketplace add/update/list`). The main-process switch-setup
 *                service drives that CLI from these descriptor fields.
 * kind: 'none' — the agent has no Switch connector setup; the UI surfaces nothing.
 *
 * No behavior contract: everything the service needs is declarative, so the
 * generic CLI driver handles all agents that share the marketplace model.
 */
export const switchSetupCapability = definePluginCapability()(
  'switch-setup',
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('cli'),
      /** Plugin name as published, e.g. 'switch-connector'. */
      pluginName: z.string(),
      /** Marketplace name the plugin is published under, e.g. 'switch-plugins'. */
      marketplaceName: z.string(),
      /** Source passed to `marketplace add`: a GitHub `owner/repo` or a path. */
      marketplaceSource: z.string(),
      /** Install scope flag for `-s`. */
      scope: z.enum(['user', 'project', 'local']).default('user'),
    }),
    z.object({ kind: z.literal('none') }),
  ])
);

export type SwitchSetupDescriptor = (typeof switchSetupCapability)['_descriptor'];
