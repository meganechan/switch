import type { DependencyDescriptor } from '@switchdash/core/deps/runtime';

/**
 * Core host tools a remote host needs to run switchdash agent sessions: the same
 * binaries the remote-session preflight verifies (tmux, node, git) plus gh, which
 * agents commonly rely on. Unlike agent dependencies (built from the plugin
 * registry), these are static — the plugin system has no notion of host tooling.
 *
 * These are surfaced only on the remote-host management page; the local
 * dependency manager continues to track agent CLIs only. `updates`/`uninstall`
 * are intentionally omitted: switchdash detects and installs these tools but does
 * not manage their upgrade/removal lifecycle.
 */
export const CORE_DEPENDENCIES: DependencyDescriptor[] = [
  {
    id: 'git',
    name: 'Git',
    category: 'core',
    commands: ['git'],
    versionArgs: ['--version'],
    docUrl: 'https://git-scm.com/downloads',
    installCommands: {
      macos: [{ method: 'homebrew', command: 'brew install git', recommended: true }],
      linux: [
        {
          method: 'apt',
          command: 'sudo apt-get update && sudo apt-get install -y git',
          recommended: true,
        },
      ],
    },
  },
  {
    id: 'tmux',
    name: 'tmux',
    category: 'core',
    commands: ['tmux'],
    versionArgs: ['-V'],
    docUrl: 'https://github.com/tmux/tmux/wiki/Installing',
    installCommands: {
      macos: [{ method: 'homebrew', command: 'brew install tmux', recommended: true }],
      linux: [
        {
          method: 'apt',
          command: 'sudo apt-get update && sudo apt-get install -y tmux',
          recommended: true,
        },
      ],
    },
  },
  {
    id: 'node',
    name: 'Node.js',
    category: 'core',
    commands: ['node'],
    versionArgs: ['--version'],
    // The sidecar bundle and the remote-session reachability probe rely on global
    // `fetch` / `AbortSignal.timeout` / optional chaining, stable only from Node 18.
    minVersion: '18.0.0',
    docUrl: 'https://nodejs.org/en/download',
    installCommands: {
      macos: [{ method: 'homebrew', command: 'brew install node', recommended: true }],
      linux: [
        {
          // Distro `apt install nodejs` ships ancient Node on LTS Ubuntu (v12 on
          // 22.04), and NodeSource's package conflicts with a pre-installed distro
          // libnode. Install the official prebuilt LTS tarball into /usr/local
          // instead: no apt repo, no package conflicts, and /usr/local/bin precedes
          // /usr/bin on the default PATH so it wins over any distro node.
          method: 'curl',
          command:
            'set -e; A=$(uname -m); case "$A" in x86_64) A=x64;; aarch64|arm64) A=arm64;; *) echo "unsupported arch $A" >&2; exit 1;; esac; F=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -oE "node-v22[0-9.]*-linux-$A\\.tar\\.xz" | head -1); curl -fsSL "https://nodejs.org/dist/latest-v22.x/$F" | sudo tar -xJ -C /usr/local --strip-components=1',
          label: 'Official tarball',
          recommended: true,
        },
      ],
    },
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    category: 'core',
    commands: ['gh'],
    versionArgs: ['--version'],
    docUrl: 'https://github.com/cli/cli#installation',
    installCommands: {
      macos: [{ method: 'homebrew', command: 'brew install gh', recommended: true }],
      linux: [
        {
          method: 'apt',
          command:
            'sudo mkdir -p -m 755 /etc/apt/keyrings && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && sudo apt-get update && sudo apt-get install -y gh',
          label: 'apt',
          recommended: true,
        },
        {
          method: 'homebrew',
          command: 'brew install gh',
          label: 'Homebrew',
        },
      ],
    },
  },
];
