import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { exactTmuxTarget } from '@main/core/pty/tmux-session-name';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { AgentLaunchSpec } from '../../../../sidecar/agent-launch-spec';
import {
  SIDECAR_BUNDLE_REL_PATH,
  sidecarAgentDir,
  sidecarDeployLockRelPath,
  sidecarLaunchSpecRelPath,
  sidecarEndpointRelPath,
  sidecarLogRelPath,
  sidecarReadyRelPath,
  sidecarWatchEnabledRelPath,
} from '../../../../sidecar/sidecar-paths';

/**
 * Deploys and launches the switchdash remote runtime sidecar on the agent's VM
 * (CHOO-1059 → CHOO-1085), then waits for it to report a ready endpoint.
 *
 * The sidecar is agent-scoped: one per remote agent, serving every session on
 * the VM (the one switchdash starts over SSH and any it auto-starts) plus the
 * notification watcher. It must outlive the switchdash UI — that is the whole
 * point — so it runs inside its own detached tmux session rather than on the
 * launching SSH channel (which dies when switchdash disconnects). It writes
 * `{event:"ready",port,token,hash,epoch,pid}` to its ready file atomically once
 * bound; the launcher polls that file until a line from the incarnation it just
 * started appears, then returns the endpoint so the caller can point its remote
 * sessions' hook env at the VM-local server.
 *
 * Replacing a running sidecar is serialised across clients by a host-side deploy
 * lock: two clients deploying at once would overwrite the bundle under each
 * other and each kill the other's freshly started process.
 */

const SIDECAR_TMUX_SUFFIX = '-sidecar';
const READY_POLL_INTERVAL_MS = 250;
const READY_MAX_ATTEMPTS = 80; // ~20s
const DEPLOY_LOCK_POLL_MS = 500;
const DEPLOY_LOCK_MAX_ATTEMPTS = 60; // ~30s waiting on another client's deploy
/** `find -mmin` granularity is minutes; 2 comfortably exceeds a real deploy. */
const DEPLOY_LOCK_STALE_MIN = 2;
/** Trim the append-only sidecar log at launch once it passes this size. */
const SIDECAR_LOG_MAX_BYTES = 8 * 1024 * 1024;
const SIDECAR_LOG_KEEP_BYTES = 1024 * 1024;

export interface SidecarLaunchConfig {
  /** Absolute remote repo dir; the bundle, spec, ready file, and log live under .switchdash/. */
  repoDir: string;
  deeplinkScheme: string;
  /** Provider-specific launch recipe the sidecar's watcher materialises per auto-start. */
  launchSpec: AgentLaunchSpec;
  /** The agent's per-agent credentials slug — its definition name, else its agent
   * id — so the sidecar reads `.switch/agents/<slug>.json` for this agent's Switch
   * identity rather than the legacy shared settings file (CHOO-1440). */
  credsSlug: string;
}

export interface SidecarEndpoint {
  port: number;
  token: string;
  /** Absolute on-VM path of the sidecar's endpoint file. Sessions are launched
   * pointing at this rather than at `port`/`token` directly, so they survive the
   * sidecar restarting on a fresh port with a fresh token. */
  endpointFile: string;
}

/** The ready line the sidecar prints. `hash` is absent for a pre-CHOO-1085
 * sidecar; the endpoint file path is derived locally, not carried on the wire. */
interface ReadyLine {
  port: number;
  token: string;
  hash: string | null;
  /** Monotonic per-start counter from the sidecar's durable state. Absent from
   * a pre-CHOO-1425 sidecar. */
  epoch: number | null;
}

/** Narrow remote seam the launcher needs — satisfied by IExecutionContext + ssh-fs. */
export interface SidecarHost {
  exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
  putFile(localAbsPath: string, remoteRelPath: string): Promise<void>;
}

export interface SidecarLauncherLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

function sidecarEnv(config: SidecarLaunchConfig): Record<string, string> {
  return {
    SWITCHDASH_SIDECAR_REPO_DIR: config.repoDir,
    SWITCHDASH_SIDECAR_DEEPLINK_SCHEME: config.deeplinkScheme,
    SWITCHDASH_SIDECAR_AGENT_SLUG: config.credsSlug,
  };
}

function parseReady(raw: string): ReadyLine | null {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'event' in parsed &&
    parsed.event === 'ready' &&
    'port' in parsed &&
    typeof parsed.port === 'number' &&
    'token' in parsed &&
    typeof parsed.token === 'string'
  ) {
    const hash = 'hash' in parsed && typeof parsed.hash === 'string' ? parsed.hash : null;
    const epoch = 'epoch' in parsed && typeof parsed.epoch === 'number' ? parsed.epoch : null;
    return { port: parsed.port, token: parsed.token, hash, epoch };
  }
  return null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deterministic, agent-scoped tmux session name for the sidecar, derived from
 * the remote repo dir AND the agent's creds slug — so every caller (the SSH
 * agent runtime and the auto-session setup path) computes the same name and
 * reattaches to that agent's sidecar, while two agents sharing a directory get
 * distinct sidecars (CHOO-1440). Deliberately does NOT end in `-sidecar` so the
 * legacy per-session `reapOrphanedSidecars` never mistakes it for an orphan.
 */
export function agentSidecarTmuxName(repoDir: string, slug: string): string {
  const hash = createHash('sha256').update(`${repoDir}\0${slug}`).digest('hex').slice(0, 16);
  return `switchdash-sidecar-${hash}`;
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

export class RemoteSidecarLauncher {
  private readonly host: SidecarHost;
  private readonly bundlePath: string;
  private readonly sidecarTmuxName: string;
  private readonly config: SidecarLaunchConfig;
  private readonly log: SidecarLauncherLogger;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly hashBundle: () => Promise<string>;

  constructor(opts: {
    host: SidecarHost;
    /** Local absolute path to the built sidecar bundle (dist-sidecar/sidecar.mjs). */
    bundlePath: string;
    /** Dedicated tmux session that keeps the sidecar alive across UI disconnects. */
    sidecarTmuxName: string;
    config: SidecarLaunchConfig;
    log: SidecarLauncherLogger;
    sleep?: (ms: number) => Promise<void>;
    /** Override the local bundle hash (tests); defaults to sha256 of bundlePath. */
    hashBundle?: () => Promise<string>;
  }) {
    this.host = opts.host;
    this.bundlePath = opts.bundlePath;
    this.sidecarTmuxName = opts.sidecarTmuxName;
    this.config = opts.config;
    this.log = opts.log;
    this.sleep = opts.sleep ?? defaultSleep;
    this.hashBundle = opts.hashBundle ?? (() => sha256File(this.bundlePath));
  }

  /** Per-agent state paths, keyed by this agent's creds slug (CHOO-1440). */
  private get agentDir(): string {
    return sidecarAgentDir(this.config.credsSlug);
  }
  private get launchSpecPath(): string {
    return sidecarLaunchSpecRelPath(this.config.credsSlug);
  }
  private get readyPath(): string {
    return sidecarReadyRelPath(this.config.credsSlug);
  }
  private get logPath(): string {
    return sidecarLogRelPath(this.config.credsSlug);
  }
  private get deployLockPath(): string {
    return sidecarDeployLockRelPath(this.config.credsSlug);
  }
  /** Absolute, because it is baked into spawned sessions' env and read by hooks
   * whose working directory is not guaranteed to be the repo dir. */
  private get endpointFile(): string {
    return `${this.config.repoDir}/${sidecarEndpointRelPath(this.config.credsSlug)}`;
  }

  private toEndpoint(ready: ReadyLine): SidecarEndpoint {
    return { port: ready.port, token: ready.token, endpointFile: this.endpointFile };
  }

  /**
   * Reconcile-or-launch. The sidecar is designed to outlive the switchdash UI,
   * so on relaunch a still-running sidecar (its tmux session alive and its ready
   * file intact) is reattached to rather than redeployed — preserving its poll
   * queue and connection. Only when none is running (or it's stale) do we deploy
   * the bundle and start fresh.
   */
  async deployAndLaunch(): Promise<SidecarEndpoint> {
    // Always (re)write the launch spec first so a config change (e.g. new extra
    // args) takes effect on the next fresh launch, even when reattaching.
    await this.writeLaunchSpec();

    const localHash = await this.hashBundle();
    const existing = await this.reattachExisting(localHash);
    if (existing) {
      this.log.debug('RemoteSidecarLauncher: reattached to running sidecar', {
        sidecarTmuxName: this.sidecarTmuxName,
        port: existing.port,
      });
      return existing;
    }

    // Replacing the sidecar is not safe to do concurrently: two clients would
    // overwrite the bundle under each other and each kill the other's freshly
    // started process. Serialise it across clients, then re-check — whoever
    // waited may find the holder already started exactly what it wanted.
    return this.withDeployLock(async () => {
      const reattach = await this.reattachExisting(localHash);
      if (reattach) {
        this.log.debug('RemoteSidecarLauncher: another client deployed a matching sidecar', {
          sidecarTmuxName: this.sidecarTmuxName,
          port: reattach.port,
        });
        return reattach;
      }

      const previousEpoch = await this.runningEpoch();
      const remoteHash = await this.prepareDir();
      if (remoteHash === localHash) {
        this.log.debug('RemoteSidecarLauncher: bundle unchanged on host — skipping upload', {
          sidecarTmuxName: this.sidecarTmuxName,
        });
      } else {
        await this.uploadBundle();
      }
      await this.killSidecar();
      await this.startDetached(localHash);
      return this.awaitReady(previousEpoch);
    });
  }

  /**
   * Create the sidecar dir and return the hash of the bundle already on the
   * host (empty when absent), so the 1.2MB SFTP is skipped whenever an identical
   * copy is already deployed (the common case: a new session reusing a prior
   * session's bundle).
   *
   * The hash is computed from the file itself rather than read from a sidecar
   * file kept alongside it: that file could be torn, written out of step with
   * the bundle, or simply stale, each of which silently defeats the comparison.
   *
   * Note this no longer deletes the ready file. Doing so made a healthy running
   * sidecar undiscoverable to every other client for the duration of a deploy —
   * and permanently if the deploy then failed. The sidecar replaces that file
   * atomically when it starts.
   */
  private async prepareDir(): Promise<string> {
    const bundle = quoteShellArg(SIDECAR_BUNDLE_REL_PATH);
    const script = [
      `mkdir -p ${quoteShellArg(this.agentDir)}`,
      `if [ -f ${bundle} ]; then sha256sum ${bundle} 2>/dev/null || shasum -a 256 ${bundle} 2>/dev/null; fi`,
    ].join('; ');
    const { stdout } = await this.host.exec('sh', ['-c', script]);
    return stdout.trim().split(/\s+/)[0] ?? '';
  }

  /**
   * Upload the bundle to a temp path and rename it into place.
   *
   * `putFile` is a direct SFTP overwrite: it truncates the destination and
   * streams into it, so for the length of the transfer the file node is about
   * to load is observably half-written. A concurrent start would fail on a
   * SyntaxError. Renaming is atomic, so a reader sees the old bundle or the new
   * one.
   */
  private async uploadBundle(): Promise<void> {
    const tmpRel = `${SIDECAR_BUNDLE_REL_PATH}.${process.pid}.tmp`;
    await this.host.putFile(this.bundlePath, tmpRel);
    await this.host.exec('sh', [
      '-c',
      `mv ${quoteShellArg(tmpRel)} ${quoteShellArg(SIDECAR_BUNDLE_REL_PATH)}`,
    ]);
  }

  /** Epoch of the sidecar currently running, or null if none/unreadable. */
  private async runningEpoch(): Promise<number | null> {
    const raw = await this.readReadyFile();
    return (raw ? parseReady(raw) : null)?.epoch ?? null;
  }

  /**
   * Run `fn` holding the host-side deploy lock for this agent.
   *
   * `mkdir` is atomic on POSIX — it fails if the directory exists — which makes
   * it a usable mutex over plain ssh, unlike a create-then-write lockfile. A
   * lock older than the timeout is broken rather than honoured: the holder may
   * have been killed mid-deploy, and refusing to ever deploy again would be a
   * worse failure than the race the lock prevents.
   */
  private async withDeployLock<T>(fn: () => Promise<T>): Promise<T> {
    const lock = quoteShellArg(this.deployLockPath);
    for (let attempt = 0; attempt < DEPLOY_LOCK_MAX_ATTEMPTS; attempt++) {
      const { stdout } = await this.host.exec('sh', [
        '-c',
        `if mkdir ${lock} 2>/dev/null; then echo acquired; else ` +
          // Break a stale lock: find returns the dir only when it is older than
          // the staleness window, so a live holder is left alone.
          `if [ -n "$(find ${lock} -maxdepth 0 -mmin +${DEPLOY_LOCK_STALE_MIN} 2>/dev/null)" ]; then ` +
          `rm -rf ${lock} && mkdir ${lock} 2>/dev/null && echo broke-stale; else echo busy; fi; fi`,
      ]);
      const outcome = stdout.trim();
      if (outcome === 'broke-stale') {
        this.log.warn('RemoteSidecarLauncher: broke a stale deploy lock', {
          sidecarTmuxName: this.sidecarTmuxName,
        });
      }
      if (outcome === 'acquired' || outcome === 'broke-stale') {
        try {
          return await fn();
        } finally {
          await this.host.exec('sh', ['-c', `rm -rf ${lock}`]).catch((error: unknown) =>
            this.log.warn('RemoteSidecarLauncher: failed to release deploy lock', {
              error: String(error),
            })
          );
        }
      }
      await this.sleep(DEPLOY_LOCK_POLL_MS);
    }
    throw new Error(
      `another client has been deploying this sidecar for over ` +
        `${(DEPLOY_LOCK_MAX_ATTEMPTS * DEPLOY_LOCK_POLL_MS) / 1000}s — not replacing it`
    );
  }

  private async writeLaunchSpec(): Promise<void> {
    const json = JSON.stringify(this.config.launchSpec);
    const b64 = Buffer.from(json, 'utf8').toString('base64');
    const spec = quoteShellArg(this.launchSpecPath);
    // base64 round-trip avoids fighting shell quoting on the JSON payload. Write
    // to a per-process temp (`$$`) then atomically `mv` into place, so nothing
    // can observe a torn, half-written spec that would crash the sidecar on
    // startup.
    await this.host.exec('sh', [
      '-c',
      `mkdir -p ${quoteShellArg(this.agentDir)} && tmp=${spec}.$$.tmp && printf %s ${quoteShellArg(b64)} | base64 -d > "$tmp" && mv "$tmp" ${spec}`,
    ]);
  }

  /**
   * Endpoint of an already-running sidecar for this session, or null. Reattaches
   * only when the running process was launched from the current bundle: its ready
   * line carries the bundle hash it started with, so a sidecar left over from an
   * older bundle (or a pre-CHOO-1085 one that reports no hash) is treated as stale
   * and relaunched — otherwise a bundle upgrade never takes effect while the old
   * process keeps running.
   */
  private async reattachExisting(localHash: string): Promise<SidecarEndpoint | null> {
    try {
      await this.host.exec('tmux', ['has-session', '-t', exactTmuxTarget(this.sidecarTmuxName)]);
    } catch {
      return null; // not running
    }
    const raw = await this.readReadyFile();
    const ready = raw ? parseReady(raw) : null;
    if (!ready) return null;
    if (ready.hash !== localHash) {
      this.log.debug('RemoteSidecarLauncher: running sidecar is a stale bundle — relaunching', {
        sidecarTmuxName: this.sidecarTmuxName,
        runningHash: ready.hash,
        localHash,
      });
      return null;
    }
    return this.toEndpoint(ready);
  }

  /**
   * Endpoint of an already-running current-bundle sidecar, or null if none is
   * running (or it is a stale bundle). Read-only — unlike `deployAndLaunch` it
   * never deploys, writes, or starts anything. For callers that only want to
   * talk to a sidecar if one already exists (e.g. cross-client discovery), so a
   * merely-configured agent does not cause a sidecar to be launched.
   */
  async probeExisting(): Promise<SidecarEndpoint | null> {
    return this.reattachExisting(await this.hashBundle());
  }

  async stop(): Promise<void> {
    await this.killSidecar();
  }

  private async killSidecar(): Promise<void> {
    try {
      await this.host.exec('tmux', ['kill-session', '-t', exactTmuxTarget(this.sidecarTmuxName)]);
    } catch (error) {
      this.log.debug('RemoteSidecarLauncher: no existing sidecar session to kill', {
        sidecarTmuxName: this.sidecarTmuxName,
        error: String(error),
      });
    }
  }

  private async startDetached(bundleHash: string): Promise<void> {
    const env = { ...sidecarEnv(this.config), SWITCHDASH_SIDECAR_BUNDLE_HASH: bundleHash };
    const envPrefix = Object.entries(env)
      .map(([key, value]) => `${key}=${quoteShellArg(value)}`)
      .join(' ');
    // Trim the log first: it is append-only for the life of the host, and the
    // sidecar logs a line per `/events` poll per attached client. Left alone it
    // eventually fills the disk, which then breaks the very files — ready,
    // endpoint, state — that everything else depends on. A restart is the
    // natural rotation point.
    const log = quoteShellArg(this.logPath);
    await this.host.exec('sh', [
      '-c',
      `if [ -f ${log} ] && [ "$(wc -c < ${log})" -gt ${SIDECAR_LOG_MAX_BYTES} ]; then ` +
        `tail -c ${SIDECAR_LOG_KEEP_BYTES} ${log} > ${log}.tmp && mv ${log}.tmp ${log}; fi`,
    ]);
    // stdout goes to the log alongside stderr; the sidecar writes its ready file
    // itself (atomically) rather than relying on a shell redirect, which would
    // truncate it the moment the process starts.
    const inner =
      `${envPrefix} exec node ${quoteShellArg(SIDECAR_BUNDLE_REL_PATH)} ` +
      `>> ${quoteShellArg(this.logPath)} 2>&1`;
    await this.host.exec('tmux', [
      'new-session',
      '-d',
      '-s',
      this.sidecarTmuxName,
      '-c',
      this.config.repoDir,
      inner,
    ]);
  }

  /**
   * Wait for the sidecar we just started to publish its endpoint.
   *
   * The ready file is no longer deleted before launch, so a leftover line from
   * the process we killed would otherwise be mistaken for the new one's. The
   * epoch increments on every start, so requiring a higher one identifies the
   * new incarnation. A sidecar that reports no epoch predates this and cannot
   * be distinguished — accept it rather than hang.
   */
  private async awaitReady(previousEpoch: number | null): Promise<SidecarEndpoint> {
    for (let attempt = 0; attempt < READY_MAX_ATTEMPTS; attempt++) {
      await this.assertAlive();
      const raw = await this.readReadyFile();
      const ready = raw ? parseReady(raw) : null;
      const isNew =
        ready && (previousEpoch === null || ready.epoch === null || ready.epoch > previousEpoch);
      if (ready && isNew) return this.toEndpoint(ready);
      await this.sleep(READY_POLL_INTERVAL_MS);
    }
    throw new Error(
      `sidecar did not report ready within ${
        (READY_MAX_ATTEMPTS * READY_POLL_INTERVAL_MS) / 1000
      }s — see ${this.config.repoDir}/${this.logPath}`
    );
  }

  private async assertAlive(): Promise<void> {
    try {
      await this.host.exec('tmux', ['has-session', '-t', exactTmuxTarget(this.sidecarTmuxName)]);
    } catch {
      const tail = await this.readLogTail();
      const logRef = `${this.config.repoDir}/${this.logPath}`;
      this.log.warn('RemoteSidecarLauncher: sidecar exited during startup', {
        sidecarTmuxName: this.sidecarTmuxName,
        logRef,
        logTail: tail,
      });
      throw new Error(
        tail
          ? `sidecar process exited during startup — last output from ${logRef}:\n${tail}`
          : `sidecar process exited during startup (no output in ${logRef})`
      );
    }
  }

  /** Best-effort tail of the sidecar log, so a startup crash surfaces its actual
   * error (e.g. a SyntaxError from too-old node) instead of an opaque message. */
  private async readLogTail(): Promise<string> {
    try {
      const { stdout } = await this.host.exec('tail', ['-n', '20', this.logPath]);
      return stdout.trim();
    } catch {
      return '';
    }
  }

  private async readReadyFile(): Promise<string | null> {
    try {
      const { stdout } = await this.host.exec('cat', [this.readyPath]);
      return stdout;
    } catch {
      return null; // not created yet
    }
  }
}

/**
 * Set the agent's sidecar `watch-enabled` flag (1/0). The running sidecar reads
 * this file each poll, so toggling auto_session enables/disables auto-start
 * without restarting the sidecar — leaving its session injection undisturbed.
 * Keyed by the agent's creds `slug` so it targets that agent's sidecar and not a
 * co-located one (CHOO-1440).
 */
export async function writeWatchEnabled(
  host: SidecarHost,
  slug: string,
  enabled: boolean
): Promise<void> {
  await host.exec('sh', [
    '-c',
    `mkdir -p ${quoteShellArg(sidecarAgentDir(slug))} && printf %s ${enabled ? '1' : '0'} > ${quoteShellArg(sidecarWatchEnabledRelPath(slug))}`,
  ]);
}

/**
 * Kill an agent's sidecar tmux session without a full launcher (no bundle/spec
 * needed) — used to fully tear down the sidecar (agent removal / host teardown).
 * Best-effort: a missing session is a no-op, not an error.
 */
export async function killSidecarSession(
  host: SidecarHost,
  sidecarTmuxName: string,
  log: SidecarLauncherLogger
): Promise<void> {
  try {
    await host.exec('tmux', ['kill-session', '-t', exactTmuxTarget(sidecarTmuxName)]);
  } catch (error) {
    log.debug('killSidecarSession: no existing sidecar session to kill', {
      sidecarTmuxName,
      error: String(error),
    });
  }
}

/**
 * Reap LEGACY per-session sidecars — those named `<agentTmux>-sidecar`, one per
 * session — whose agent pane is gone: they are still polling Switch with nowhere
 * to inject.
 *
 * This deliberately does not match today's agent-scoped sidecars
 * (`switchdash-sidecar-<hash>`, see `agentSidecarTmuxName`). Those are *supposed*
 * to outlive every pane: with no live session the notification watcher is the
 * thing that starts one when the agent is next addressed, so reaping them for
 * having no panes would quietly disable auto-start. An agent-scoped sidecar is
 * torn down explicitly instead, via `killSidecarSession`, when the agent or host
 * goes away.
 *
 * Best-effort: a missing tmux server (no sessions at all) is a no-op, not an error.
 */
export async function reapOrphanedSidecars(
  host: SidecarHost,
  log: SidecarLauncherLogger
): Promise<void> {
  let names: string[];
  try {
    const { stdout } = await host.exec('tmux', ['list-sessions', '-F', '#{session_name}']);
    names = stdout
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean);
  } catch {
    return; // no tmux server / no sessions
  }

  for (const name of names) {
    if (!name.endsWith(SIDECAR_TMUX_SUFFIX)) continue;
    const agentSession = name.slice(0, -SIDECAR_TMUX_SUFFIX.length);
    try {
      await host.exec('tmux', ['has-session', '-t', exactTmuxTarget(agentSession)]);
      continue; // agent still alive — sidecar is in use
    } catch {
      // agent gone — reap the orphan
    }
    try {
      await host.exec('tmux', ['kill-session', '-t', exactTmuxTarget(name)]);
      log.debug('reapOrphanedSidecars: reaped orphaned sidecar', { name });
    } catch (error) {
      log.warn('reapOrphanedSidecars: failed to kill orphaned sidecar', {
        name,
        error: String(error),
      });
    }
  }
}
