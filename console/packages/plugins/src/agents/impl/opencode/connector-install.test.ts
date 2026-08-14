import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The connector's own installer, reached in the repo rather than through the
// workspace: `connectors/opencode-plugin` is published on its own and is
// deliberately not a workspace member.
import {
  install,
  installedVersion,
  uninstall,
} from '../../../../../../../connectors/opencode-plugin/install.js';

/**
 * What a user runs when there is no Switch Console. It edits a file the user
 * owns and shares with every other OpenCode session on the machine, so the
 * failure that matters is not "the install did not happen" — it is an install
 * that takes something else out with it.
 */
describe('the OpenCode connector installer', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'opencode-connector-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  function config(): Record<string, any> {
    return JSON.parse(readFileSync(join(configDir, 'opencode.json'), 'utf8'));
  }

  function writeConfig(value: unknown): void {
    writeFileSync(join(configDir, 'opencode.json'), `${JSON.stringify(value, null, 2)}\n`);
  }

  it('registers the Switch MCP server', async () => {
    await install(configDir);

    expect(config().mcp.switch).toMatchObject({ type: 'local', enabled: true });
  });

  it('registers it exactly as the connector declares it', async () => {
    const declared = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../../../connectors/opencode-plugin/opencode.json'),
        'utf8'
      )
    ) as { mcp: Record<string, unknown> };

    await install(configDir);

    expect(config().mcp.switch).toEqual(declared.mcp.switch);
  });

  it('writes every skill the connector ships, including the standalone one', async () => {
    await install(configDir);

    expect(existsSync(join(configDir, 'skills', 'switch', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(configDir, 'skills', 'configure', 'SKILL.md'))).toBe(true);
  });

  it('names each skill directory to match the skill, as OpenCode requires', async () => {
    await install(configDir);

    for (const name of ['switch', 'configure']) {
      const content = readFileSync(join(configDir, 'skills', name, 'SKILL.md'), 'utf8');
      expect(/^---\n(?:.*\n)*?name:\s*"?([\w-]+)"?\s*$/m.exec(content)?.[1]).toBe(name);
    }
  });

  /**
   * The config is the user's, not ours. An install that resets their model or
   * drops an MCP server they added is a worse outcome than one that fails.
   */
  it('leaves the rest of the config alone', async () => {
    writeConfig({
      $schema: 'https://opencode.ai/config.json',
      model: 'anthropic/claude-sonnet-4-5',
      mcp: { other: { type: 'local', command: ['true'] } },
    });

    await install(configDir);

    expect(config().model).toBe('anthropic/claude-sonnet-4-5');
    expect(config().mcp.other).toEqual({ type: 'local', command: ['true'] });
  });

  it('takes only its own entry back out on uninstall', async () => {
    writeConfig({ mcp: { other: { type: 'local', command: ['true'] } } });
    await install(configDir);

    await uninstall(configDir);

    expect(config().mcp.other).toBeDefined();
    expect(config().mcp.switch).toBeUndefined();
    expect(existsSync(join(configDir, 'skills', 'switch'))).toBe(false);
    expect(existsSync(join(configDir, 'skills', 'configure'))).toBe(false);
  });

  it('is idempotent', async () => {
    await install(configDir);
    const first = config();

    await install(configDir);

    expect(config()).toEqual(first);
  });

  /**
   * OpenCode adds `$schema` to its own config when it is missing, so writing it
   * here keeps an install from showing up as a spurious change the next time
   * OpenCode rewrites the file.
   */
  it('writes the schema OpenCode would add itself', async () => {
    await install(configDir);

    expect(config().$schema).toBe('https://opencode.ai/config.json');
  });

  it('refuses to rewrite a config it cannot parse', async () => {
    writeFileSync(join(configDir, 'opencode.json'), '{ this is not json');

    await expect(install(configDir)).rejects.toThrow(/not valid JSON/);
  });

  describe('reporting what is installed', () => {
    it('reports nothing before an install', async () => {
      expect(await installedVersion(configDir)).toBeNull();
    });

    it('reports the version afterwards', async () => {
      await install(configDir);

      expect(await installedVersion(configDir)).toMatch(/^\d+\.\d+\.\d+/);
    });

    /**
     * The marker alone is not proof. Editing `opencode.json` by hand can leave
     * it behind with no server registered, and reporting that as installed
     * hides the reason the session has no Switch tools.
     */
    it('reports nothing when the server is gone but the marker remains', async () => {
      await install(configDir);
      writeConfig({ mcp: {} });

      expect(await installedVersion(configDir)).toBeNull();
    });

    it('reports nothing after an uninstall', async () => {
      await install(configDir);
      await uninstall(configDir);

      expect(await installedVersion(configDir)).toBeNull();
    });
  });

  it('creates the config directory when there is none', async () => {
    const fresh = join(configDir, 'nested', 'opencode');
    mkdirSync(join(configDir, 'nested'));

    await install(fresh);

    expect(existsSync(join(fresh, 'opencode.json'))).toBe(true);
  });
});
