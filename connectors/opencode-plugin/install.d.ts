/**
 * Write the connector into an OpenCode config directory: the Switch MCP entry
 * merged into `opencode.json`, every skill the package ships, and a record of
 * what was written. Returns the paths it wrote.
 *
 * Refuses, before writing anything, on a config it cannot safely edit — one
 * that is not valid JSON, whose root is not an object, or whose `mcp` is not
 * an object — and on a skill file it did not write itself.
 */
export function install(configDir: string): Promise<string[]>;

/**
 * Reverse an install, leaving the user's own config and MCP servers intact.
 *
 * Removes only the skills the recorded install wrote, and only the file it
 * wrote in each; with no record it leaves them alone and says so through
 * `hadRecord`.
 */
export function uninstall(configDir: string): Promise<{
  removedSkills: string[];
  hadRecord: boolean;
}>;

/**
 * The version recorded at install, or null when the connector is not installed
 * — including when the record survives but the MCP server no longer does.
 */
export function installedVersion(configDir: string): Promise<string | null>;
