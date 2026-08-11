# Installing Switch Console

Switch Console is distributed as a desktop app through **GitHub Releases on this
repository** (`sandbox-quantum/switch`). The repo is public, so the downloads
need no account, token or sign-up. No need to build from source.

> Builds are currently **macOS arm64** (Apple Silicon) and **Linux x64 and
> arm64**. Windows is not built yet.

## Download

### Option A — browser (simplest)

1. Open the repo's **[Releases](https://github.com/sandbox-quantum/switch/releases)**
   page.
2. Find the latest release titled **`Switch Console <version>`** (tag
   `switch-console-v<version>`).
3. Under **Assets**, download the file for your platform — `.dmg` on macOS, or
   one of `.AppImage` / `.deb` / `.rpm` on Linux.

### Option B — command line

Release assets are public, so a plain `curl` works — no token, no `gh`:

```bash
# Download an installer from a specific release (macOS):
curl -fLO https://github.com/sandbox-quantum/switch/releases/download/switch-console-v<version>/switch-console-arm64.dmg

# Linux — pick the format your distro uses:
curl -fLO https://github.com/sandbox-quantum/switch/releases/download/switch-console-v<version>/switch-console-x86_64.AppImage
```

With the [`gh` CLI](https://cli.github.com), if you prefer it:

```bash
gh release list --repo sandbox-quantum/switch | grep switch-console-v
gh release download switch-console-v<version> \
  --repo sandbox-quantum/switch \
  --pattern '*.dmg'
```

## Install (macOS)

1. Open the downloaded `.dmg`.
2. Drag **Switch Console** into your **Applications** folder.

Tagged macOS releases are signed and notarized with SandboxAQ's Developer ID, so
they open without a Gatekeeper bypass.

## Install (Linux)

Linux builds are **unsigned**. First check which arch you are on — the assets
carry it in the filename, and each packager reports it differently:

```bash
dpkg --print-architecture     # amd64 | arm64
```

An asset for the wrong arch does not fail cleanly. `apt` reports every
dependency as "not installable" (including core ones like `libuuid1`), which
reads like a broken package list rather than an arch mismatch.

Pick the format your distro uses:

- **AppImage** — no install step; make it executable and run it:

  ```bash
  chmod +x switch-console-x86_64.AppImage      # arm64: switch-console-arm64.AppImage
  ./switch-console-x86_64.AppImage
  ```

  On Ubuntu 22.04+ the AppImage needs FUSE 2 (`sudo apt install libfuse2`), and
  on 24.04+ AppArmor's restriction on unprivileged user namespaces can break
  Electron's sandbox. The `.deb` has neither problem — it installs
  `chrome-sandbox` correctly — so prefer it on Ubuntu.

- **Debian / Ubuntu** (`.deb`):

  ```bash
  sudo apt install ./switch-console-amd64.deb  # arm64: switch-console-arm64.deb
  ```

  Use `apt install ./file.deb` rather than `dpkg -i`, so the Electron runtime
  dependencies get resolved.

- **Fedora / RHEL** (`.rpm`):

  ```bash
  sudo dnf install ./switch-console-x86_64.rpm # arm64: switch-console-aarch64.rpm
  ```

> The app does not yet set a `desktopName`, so desktop environments may not
> associate its windows with the installed `.desktop` entry (the icon can appear
> as a duplicate or generic entry in the taskbar).

## Updating

Switch Console checks this repo's Releases for new versions in-app and offers the
update when one is available — no sign-in of any kind. Settings checks
automatically; you can also recheck manually.

You can always grab a newer build manually from the
[Releases page](https://github.com/sandbox-quantum/switch/releases) and
re-install (drag over the old app).

## Notes

- Release **asset filenames are prefixed `switch-console-`** (e.g.
  `switch-console-arm64.dmg`). The macOS app id still reads `com.switchdash.*`,
  which is deliberate — it is what carries update continuity for copies
  installed before the rename, and no user sees it.
- **Upgrading a Linux install from a pre-rename build:** `apt` and `dnf` see
  `switch-console` as a new package rather than an upgrade of `switchdash`, so
  remove the old one yourself (`sudo apt remove switchdash`) or the two sit
  side by side.
- Switch Console releases use the `switch-console-v*` tag prefix and are published with
  the repo-wide "Latest" badge **off**, so they never collide with other release
  streams in this repo.
