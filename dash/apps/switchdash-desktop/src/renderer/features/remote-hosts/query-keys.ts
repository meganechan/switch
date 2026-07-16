/** React-query keys shared across the remote-hosts feature. */

export function hostSetupQueryKey(sshHost: string) {
  return ['remote-host-setup', sshHost];
}
