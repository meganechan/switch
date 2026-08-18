import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * The logging surface the trust writers need.
 *
 * Injected rather than imported so they can run in the sidecar bundle, which
 * must not pull in the Electron-bound main-process file logger — the same
 * reason the hook-event parser takes its logger as a parameter. The sidecar
 * writes these same files on the VM before it spawns a session there.
 */
export interface TrustLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface TrustServiceDeps {
  getSessionSettings: () => Promise<{ autoTrustWorktrees: boolean }>;
  log: TrustLogger;
}

export async function readLocalConfig(configPath: string): Promise<string | null> {
  try {
    return await fs.readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if (isNodeNotFound(error)) return null;
    throw error;
  }
}

export async function writeLocalConfigAtomic(configPath: string, content: string): Promise<void> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, configPath);
  } catch (error: unknown) {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {}
    throw error;
  }
}

export function isNodeNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Serialises writes to one config file across the trust services.
 *
 * The agent CLIs' config files are shared between providers and between
 * concurrently starting sessions, and every write is read-modify-write over
 * the whole document, so two unserialised spawns lose one of the two entries.
 */
class ConfigWriteLock {
  private readonly locks = new Map<string, Promise<void>>();

  run(configPath: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(configPath) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(configPath, next);
    return next;
  }
}

export const configWriteLock = new ConfigWriteLock();
