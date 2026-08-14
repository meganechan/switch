#!/usr/bin/env node
/**
 * Installs this connector into an OpenCode installation.
 *
 * OpenCode has no marketplace, and installing the package from npm is not by
 * itself an install: npm puts the module in a cache, and OpenCode discovers a
 * skill only as a file in one of a few directories it reads. So the package
 * ships this command, and it is the one thing both consumers run — a user
 * setting OpenCode up by hand, and Switch Console installing on their behalf.
 *
 * Everything it writes comes from the files beside it, so there is no second
 * copy of the connector to keep in step: the MCP entry is `opencode.json`'s own
 * `mcp` block, and the skills are the directories under `skills/`.
 *
 *   npx -y <package> install     write the connector into ~/.config/opencode
 *   npx -y <package> uninstall   take it back out, leaving the rest alone
 *   npx -y <package> status      report what is installed, and exit 1 if not
 *
 * `--config-dir <path>` overrides the OpenCode config directory.
 */

import { realpathSync } from 'node:fs';
import { readFile, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The key the Switch MCP server is registered under. */
const SERVER_NAME = 'switch';

/**
 * Records what was installed, beside the config rather than inside it.
 * OpenCode validates its config against a published schema that rejects
 * unknown keys, so bookkeeping cannot ride along in `opencode.json` without
 * risking a config the agent refuses to start with.
 */
const MARKER_FILE = 'switch-connector.json';

function defaultConfigDir() {
  return path.join(homedir(), '.config', 'opencode');
}

async function readIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeFileEnsuringDir(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function packageVersion() {
  const manifest = JSON.parse(await readFile(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));
  return manifest.version;
}

/**
 * The MCP entry this connector registers, read from the `opencode.json` it
 * ships. That file is what a reviewer reads to see what the connector does to
 * a user's config, so it is also what gets written — the alternative is a
 * second declaration in code that can disagree with it silently.
 */
async function declaredServerEntry() {
  const declared = JSON.parse(await readFile(path.join(PACKAGE_DIR, 'opencode.json'), 'utf8'));
  const entry = declared.mcp?.[SERVER_NAME];
  if (!entry) {
    throw new Error(`opencode.json declares no '${SERVER_NAME}' MCP server; the package is broken.`);
  }
  return entry;
}

/**
 * The skills this connector ships, by directory name. OpenCode derives a
 * skill's name from its folder and rejects one whose frontmatter disagrees, so
 * the directory name is carried through to the install unchanged.
 */
async function declaredSkills() {
  const skillsDir = path.join(PACKAGE_DIR, 'skills');
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(skillsDir, entry.name, 'SKILL.md');
    skills.push({ name: entry.name, content: await readFile(source, 'utf8') });
  }
  if (skills.length === 0) {
    throw new Error('The package ships no skills; the install would give a session tools and no instructions.');
  }
  return skills;
}

function parseConfig(raw, configFile) {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // A config we cannot parse is not ours to rewrite: replacing it would
    // discard whatever the user has in there. Fail loudly instead.
    throw new Error(`${configFile} is not valid JSON. Fix or move it, then install again.`);
  }
}

async function install(configDir) {
  const configFile = path.join(configDir, 'opencode.json');
  const config = parseConfig(await readIfPresent(configFile), configFile);

  // OpenCode rewrites its own config to add `$schema` when it is missing;
  // writing it ourselves keeps that from showing up as a spurious change.
  config.$schema ??= 'https://opencode.ai/config.json';
  config.mcp = { ...config.mcp, [SERVER_NAME]: await declaredServerEntry() };
  await writeFileEnsuringDir(configFile, serialize(config));

  const written = [configFile];
  for (const skill of await declaredSkills()) {
    const target = path.join(configDir, 'skills', skill.name, 'SKILL.md');
    await writeFileEnsuringDir(target, skill.content);
    written.push(target);
  }

  const markerFile = path.join(configDir, MARKER_FILE);
  await writeFileEnsuringDir(markerFile, serialize({ version: await packageVersion() }));
  written.push(markerFile);

  return written;
}

async function uninstall(configDir) {
  const configFile = path.join(configDir, 'opencode.json');
  const raw = await readIfPresent(configFile);
  if (raw !== null) {
    const config = parseConfig(raw, configFile);
    if (config.mcp && SERVER_NAME in config.mcp) {
      // Only our own entry: the user's other MCP servers live in this file.
      const { [SERVER_NAME]: _removed, ...rest } = config.mcp;
      config.mcp = rest;
      if (Object.keys(rest).length === 0) delete config.mcp;
      await writeFile(configFile, serialize(config), 'utf8');
    }
  }

  for (const skill of await declaredSkills()) {
    await rm(path.join(configDir, 'skills', skill.name), { recursive: true, force: true });
  }
  await rm(path.join(configDir, MARKER_FILE), { force: true });
}

/**
 * The version recorded at install, or null when the connector is not installed.
 *
 * The marker alone is not proof. Someone editing `opencode.json` by hand, or
 * `opencode mcp` rewriting it, can leave the marker behind with no server
 * registered — reporting that as installed hides the reason the session has no
 * Switch tools.
 */
async function installedVersion(configDir) {
  const marker = await readIfPresent(path.join(configDir, MARKER_FILE));
  if (!marker) return null;

  const configFile = path.join(configDir, 'opencode.json');
  const config = parseConfig(await readIfPresent(configFile), configFile);
  if (!config.mcp || !(SERVER_NAME in config.mcp)) return null;

  try {
    const parsed = JSON.parse(marker);
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  let configDir = defaultConfigDir();
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--config-dir') {
      const value = rest[i + 1];
      if (!value) throw new Error('--config-dir needs a path.');
      configDir = path.resolve(value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${rest[i]}`);
  }
  return { command, configDir };
}

async function main(argv) {
  const { command, configDir } = parseArgs(argv);

  switch (command) {
    case 'install': {
      const written = await install(configDir);
      console.log(`Installed the Switch connector for OpenCode:\n${written.map((f) => `  ${f}`).join('\n')}`);
      console.log('\nStart an OpenCode session and run the `configure` skill to register an agent.');
      return 0;
    }
    case 'uninstall': {
      await uninstall(configDir);
      console.log(`Removed the Switch connector from ${configDir}.`);
      return 0;
    }
    case 'status': {
      const version = await installedVersion(configDir);
      if (version === null) {
        console.log(`No Switch connector installed in ${configDir}.`);
        return 1;
      }
      console.log(`Switch connector ${version} installed in ${configDir}.`);
      return 0;
    }
    default:
      console.error('Usage: install | uninstall | status [--config-dir <path>]');
      return 2;
  }
}

export { install, uninstall, installedVersion };

/**
 * True when this file was run as a command rather than imported.
 *
 * Resolved through `realpath` because npm installs a `bin` as a symlink: run
 * the command and `argv[1]` is the link in `node_modules/.bin`, not this file.
 * Comparing the two directly is the common form of this check and it is wrong
 * in exactly the case that matters — every install anyone actually performs —
 * where it makes the command exit 0 having done nothing at all.
 */
function invokedAsCommand() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsCommand()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(1);
    }
  );
}
