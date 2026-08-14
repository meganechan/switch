/**
 * Write the connector into an OpenCode config directory: the Switch MCP entry
 * merged into `opencode.json`, every skill the package ships, and a record of
 * what was written. Returns the paths it wrote.
 *
 * Throws rather than overwriting a config it cannot parse.
 */
export function install(configDir: string): Promise<string[]>;

/** Reverse an install, leaving the user's own config and MCP servers intact. */
export function uninstall(configDir: string): Promise<void>;

/**
 * The version recorded at install, or null when the connector is not installed
 * — including when the record survives but the MCP server no longer does.
 */
export function installedVersion(configDir: string): Promise<string | null>;
