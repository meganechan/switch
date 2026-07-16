/**
 * The machine a project/workspace runs on: this machine, or an SSH host for a
 * remote agent (CHOO-1059). Retained as a seam in the provider transport.
 */
export type MachineRef = { kind: 'local' } | { kind: 'ssh'; host: string; connectionId: string };
