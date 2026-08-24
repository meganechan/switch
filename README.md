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

- 💬 **Bring your agents where your team already collaborates.** Slack, Microsoft Teams, Discord, Telegram and Mattermost. Nobody moves anywhere.
- 🌍 **Any agent, any provider, any framework, running anywhere.** Your Claude Code agent, a teammate's Codex, a LangChain service on your servers.
- 🧩 **Design how humans and agents work together.** Set instructions, hand out roles, delegate work as tracked tasks.
- 🛡️ **Run your team with confidence.** Define who can talk to which agent, and in what context. *Guardrails and cost reporting are coming next, Flint AI among the ways to get them.*

## Why Switch

Your agents can do far more for your team than answer one question at a time.
Switch is what unlocks it. You do not have to start big: each level builds on the
one before it, and the first works on day one.

**⚡ Level 1. Your everyday agents move into your messaging app.**

- Work on a feature with a colleague and your Claude Code agent, all in one channel.
- Pull a colleague in to review what you and your agent have been doing. The whole trail is already there.
- Stand up a Codex agent that knows one slice of the system, and let anyone ask it directly.
- Open a channel for a feature, with the people and agents that feature needs in it.

<details>
<summary><b>⚡⚡ Level 2. You start encoding how the work runs.</b></summary>

- A bootstrap channel where anyone asks a manager agent to start a piece of work. It opens the channel, brings in the right people and agents, attaches the context, and gets it moving.
- A feature request channel where an agent triages what comes in, asks the questions you would have asked, and files it in Jira, Confluence or Notion.
- A bug report channel where an agent reproduces what it can, collects the logs and versions, and either files the ticket or says what is missing.

</details>

<details>
<summary><b>⚡⚡⚡ Level 3. Your team runs on Switch.</b></summary>

- A bug is reported and reproduced in the bug channel, fixed by a coding agent in a channel of its own, reviewed by a person, then put on the test environment by the deployment agent.
- A feature request is triaged and filed, built in a work channel with the ticket and design already in it, and signed off by whoever asked for it.
- An alert is caught in the on-call channel by whoever holds the role that week, fixed down the same path as any bug, and written up into the team's knowledge.
- A question is asked in the support channel and answered from the runbooks, and when the runbook turns out to be wrong it is corrected in the channel that owns it.

</details>

<details>
<summary><b>⚡⚡⚡⚡ Level 4. Your company runs on Switch.</b></summary>

Every person, team and department works alongside agents, and work crosses
between them the same way it crosses between channels.

- A customer question reaches support, becomes a confirmed bug in engineering, and comes back as a release note.
- A security report is triaged by the security team's agent, which opens fix channels in whichever teams own the affected code.
- A new hire gets a channel on day one, and each team they join has an agent that sorts out their access and introductions.

</details>

The agents bring their own tools. Switch is what lets them work as a team.

## What Switch is not

Most tools in this space want to become the place your team works. Switch does
not replace the stack you already have, it connects it.

- **Not a messaging app.** Slack, Teams, Discord, Telegram and Mattermost stay where they are.
- **Not an agent provider.** No agents, no models, and never in the path between your agent and its provider.
- **Not a black box.** The code is here to read and contribute to, it is built to self-host, and your history stays on your machines.

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

<details>
<summary><b>Or let an agent walk you through it</b></summary>

Connect an agent to the documentation and have it take you through the steps,
answering questions as they come up.

```bash
claude mcp add switch-docs --transport http https://docs.flintai.dev/mcp   # Claude Code
codex mcp add switch-docs --url https://docs.flintai.dev/mcp               # Codex
opencode mcp add                                                           # OpenCode: pick "remote"
```

Then ask it: *How do I get started with Switch?*

</details>

<details>
<summary><b>Deploying Switch for your team</b></summary>

| How | What it takes |
|---|---|
| **Switch Console** | Add a machine you own under Remote hosts, and Console installs and manages the server on it |
| **Docker Compose** | [`deploy/local/`](deploy/local/) — `just init-env && just standalone-up` |
| **Kubernetes** | [`deploy/remote/helm/switch/`](deploy/remote/helm/switch/) — OCI Helm chart, bring your own secrets and ingress |

Read [hosting remotely](https://docs.flintai.dev/flintai/switch/deploy/host-remotely),
then [connect your messaging app](https://docs.flintai.dev/flintai/switch/deploy/messaging-apps).

</details>

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
