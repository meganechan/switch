import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';

// ---------------------------------------------------------------------------
// Supporting schemas (Branch and its dependencies)
// ---------------------------------------------------------------------------

const remoteSchema = z.object({
  name: z.string(),
  url: z.string(),
});

const branchSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('local'), branch: z.string(), remote: remoteSchema.optional() }),
  z.object({ type: z.literal('remote'), branch: z.string(), remote: remoteSchema }),
]);

// ---------------------------------------------------------------------------
// GitSetup schema — mirrors GitSetup in src/shared/sessions.ts
// ---------------------------------------------------------------------------

const gitSetupSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('use-branch'), branchName: z.string() }),
  z.object({
    kind: z.literal('create-branch'),
    branchName: z.string(),
    fromBranch: branchSchema,
    pushBranch: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('pr-branch'),
    prNumber: z.number(),
    headBranch: z.string(),
    headRepositoryUrl: z.string(),
    isFork: z.boolean(),
    sessionBranch: z.string().optional(),
    pushBranch: z.boolean().optional(),
  }),
]);

// ---------------------------------------------------------------------------
// v1 schema — stored in workspaces.config rows created before v2
// ---------------------------------------------------------------------------

const workspaceLocationSchema = z.discriminatedUnion('host', [
  z.object({ host: z.literal('local'), path: z.string().optional() }),
  z.object({ host: z.literal('project-ssh'), path: z.string().optional() }),
  z.object({ host: z.literal('byoi'), remoteWorkspaceId: z.string().optional() }),
]);

const v1Schema = z.object({
  version: z.literal('1'),
  git: gitSetupSchema,
  workspace: workspaceLocationSchema,
});

// ---------------------------------------------------------------------------
// v2 schema — current version
// ---------------------------------------------------------------------------

const workspaceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('repository-instance'), workspaceId: z.string() }),
  z.object({ kind: z.literal('new-worktree') }),
  z.object({ kind: z.literal('byoi'), remoteWorkspaceId: z.string().optional() }),
]);

const v2Schema = z.object({
  version: z.literal('2'),
  git: gitSetupSchema,
  workspace: workspaceTargetSchema,
});

// ---------------------------------------------------------------------------
// v3 schema — current version
//
// switchdash has no git worktrees, branches, PRs, or BYOI: every session runs
// in the project root directory. The `git` field (always `none`) is dropped and
// the workspace target narrows to the repository instance or a transient
// placeholder created before the project's repository workspace is known.
// ---------------------------------------------------------------------------

const v3WorkspaceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('repository-instance'), workspaceId: z.string() }),
  z.object({ kind: z.literal('new-worktree') }),
]);

const v3Schema = z.object({
  version: z.literal('3'),
  workspace: v3WorkspaceTargetSchema,
});

// ---------------------------------------------------------------------------
// Versioned schema
// ---------------------------------------------------------------------------

/**
 * Versioned schema for workspace configuration stored in `workspaces.config`.
 *
 * v1 → v2 upgrade: reshapes the `workspace` discriminant from `host`-based to
 * `kind`-based. Returns `null` (needs-context) when `git.kind === 'none'` and
 * the workspace host is local/project-ssh, because the `repositoryWorkspaceId`
 * needed to produce a `repository-instance` target is not available here.
 *
 * v2 → v3 upgrade: drops the obsolete `git` field and maps the removed `byoi`
 * target onto the transient `new-worktree` placeholder.
 */
export const workspaceConfig = defineVersionedSchema()
  .initial('1', v1Schema)
  .version('2', v2Schema, (v1) => {
    const { git, workspace } = v1;
    if (workspace.host === 'byoi') {
      return {
        version: '2' as const,
        git,
        workspace: { kind: 'byoi' as const, remoteWorkspaceId: workspace.remoteWorkspaceId },
      };
    }
    if (git.kind === 'none') {
      // Cannot determine repositoryWorkspaceId here — caller must resolve.
      return null;
    }
    return { version: '2' as const, git, workspace: { kind: 'new-worktree' as const } };
  })
  .version('3', v3Schema, (v2) => ({
    version: '3' as const,
    workspace: v2.workspace.kind === 'byoi' ? { kind: 'new-worktree' as const } : v2.workspace,
  }))
  .build();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** The Zod schema for the latest (v3) workspace config. */
export const workspaceConfigSchema = workspaceConfig.schema;

/** The TypeScript type for the latest (v3) workspace config. */
export type WorkspaceConfig = typeof workspaceConfig.Type;

/** The TypeScript type for the `workspace` field of a v3 config. */
export type WorkspaceTarget = z.infer<typeof v3WorkspaceTargetSchema>;
