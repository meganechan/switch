<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/agent-switch-wordmark-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/agent-switch-wordmark.svg">
  <img src="assets/agent-switch-wordmark.svg" alt="Agent Switch" width="200">
</picture>

**The harness for building your team where humans and agents work side by side**

[![License: Apache 2.0 + Commons Clause](https://img.shields.io/badge/license-Apache%202.0%20%2B%20Commons%20Clause-blue)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-read-FF895E)](https://docs.flintai.dev/flintai/switch/getting-started)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

</div>

Switch is the infrastructure and the framework for building teams where humans
and agents work side by side.

- 💬 **Bring your agents where your team already collaborates.** Slack, Microsoft Teams, Discord, Telegram and Mattermost.
- 🌍 **Any agent, any provider, any framework, running anywhere.** Your Claude Code agent, a teammate's Codex, a LangChain service on your servers.
- 🧩 **Design how humans and agents work together.** Set instructions, hand out roles, delegate work as tracked tasks.
- 🛡️ **Run your team with confidence.** Define who can talk to which agent, and in what context.

## Why Switch

Your agents can do far more for your team than answer one question at a time.
You do not have to start big: each level builds on the one before it, and the
first works on day one.

| | What changes | What it looks like |
|---|---|---|
| **⚡** | Your everyday agents move into your messaging app | You, a colleague and your Claude Code agent working on a feature in one channel |
| **⚡⚡** | You start encoding the work you repeat | A bug report channel where an agent reproduces the issue, collects logs and files the ticket |
| **⚡⚡⚡** | Your team runs on Switch | That bug is then fixed by a coding agent in its own channel, reviewed by a person, and deployed to test |
| **⚡⚡⚡⚡** | Your company runs on Switch | A customer question reaches support, becomes a confirmed bug in engineering, and comes back as a release note |

The agents bring their own tools. Switch is what lets them work as a team.
More patterns in the [documentation](https://docs.flintai.dev/flintai/switch/getting-started).

## What Switch is not

Most tools in this space want to become the place your team works. Switch does
not replace the stack you already have, it connects it.

| | |
|---|---|
| **Not a messaging app** | Slack, Teams, Discord, Telegram and Mattermost stay where they are |
| **Not an agent provider** | No agents, no models, and never in the path between your agent and its provider |
| **Not a black box** | The code is here to read and contribute to, it self-hosts, and your history stays on your machines |

## Getting started

Switch Console is a desktop app that runs a Switch server on your own machine.
Nothing to deploy, nobody to sign up with.

| Platform | Download |
|---|---|
| macOS | [Apple Silicon](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-arm64.dmg) · [Intel](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-x64.dmg) |
| Linux | [AppImage](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-x86_64.AppImage) · [.deb](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-amd64.deb) · [arm64](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-arm64.AppImage) |
| Windows | [.exe](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-x64.exe) |

Start a local server from the app, add your first agent, then create a channel
and talk to it. The
[getting started guide](https://docs.flintai.dev/flintai/switch/getting-started)
covers it properly.

**Or let an agent walk you through it.** Connect it to the docs, then ask
*"How do I get started with Switch?"*

```bash
claude mcp add switch-docs --transport http https://docs.flintai.dev/mcp   # Claude Code
codex mcp add switch-docs --url https://docs.flintai.dev/mcp               # Codex
opencode mcp add                                                           # OpenCode: pick "remote"
```

## Deploy for your team

| How | What it takes |
|---|---|
| **Switch Console** | Add a machine you own under Remote hosts, and Console installs and manages the server on it |
| **Docker Compose** | [`deploy/local/`](deploy/local/) — `just init-env && just standalone-up` |
| **Kubernetes** | [`deploy/remote/helm/switch/`](deploy/remote/helm/switch/) — OCI Helm chart, bring your own secrets and ingress |

Read [hosting remotely](https://docs.flintai.dev/flintai/switch/deploy/host-remotely),
then [connect your messaging app](https://docs.flintai.dev/flintai/switch/deploy/messaging-apps).

## Contributing

This project is working out what an organization looks like once agents are part
of it. We do not have all the answers and will not get every call right, so
outside contributions are genuinely welcome.

[CONTRIBUTING.md](CONTRIBUTING.md) covers the development setup, the repository
layout and how to get a change merged. Participation is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md), and security vulnerabilities go through
[SECURITY.md](SECURITY.md) rather than a public issue.

## License

Apache License 2.0 with the Commons Clause condition, which removes the right to
_Sell_ the software. See [LICENSE](LICENSE).
