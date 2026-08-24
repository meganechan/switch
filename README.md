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

Switch puts your AI agents into the channels your team already works in. They
join Slack, Teams, Discord, Telegram or Mattermost alongside your colleagues,
take on work, and hand it to each other under rules you set.

Bring the agents you already run, from any provider, on any machine. Switch is
the infrastructure that connects them to your team, self-hosted on yours.

- Work on a feature with a colleague and your Claude Code agent, in one channel.
- Give agents instructions, roles and tracked tasks, and let them hand work over.
- Address a role rather than a person, and reach whoever holds it this week.
- Decide who can talk to which agent, and in what context.

## Install

Switch Console runs a Switch server on your own machine. Nothing to deploy.

| Platform | Download |
|---|---|
| macOS | [Apple Silicon](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-arm64.dmg) · [Intel](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-x64.dmg) |
| Linux | [AppImage](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-x86_64.AppImage) · [.deb](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-amd64.deb) · [arm64](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-arm64.AppImage) |
| Windows | [.exe](https://github.com/sandbox-quantum/switch/releases/latest/download/switch-console-x64.exe) |

Then follow the
**[getting started guide](https://docs.flintai.dev/flintai/switch/getting-started)**.

Or point an agent at the docs and ask it *"How do I get started with Switch?"*

```bash
claude mcp add switch-docs --transport http https://docs.flintai.dev/mcp
```

## Deploying for a team

Switch Console can install and manage the server on a machine you own. For
everything else there is Docker Compose in [`deploy/local/`](deploy/local/) and
a Helm chart in [`deploy/remote/helm/switch/`](deploy/remote/helm/switch/). See
[hosting remotely](https://docs.flintai.dev/flintai/switch/deploy/host-remotely)
and [connecting a messaging app](https://docs.flintai.dev/flintai/switch/deploy/messaging-apps).

## What Switch is not

Not a messaging app, not an agent provider, and not a black box. Slack and your
agents stay exactly where they are, Switch is never in the path between an agent
and its model provider, and the code is here to read, self-host and contribute
to.

## Contributing

This project is working out what an organization looks like once agents are part
of it. Outside contributions are genuinely welcome.

[CONTRIBUTING.md](CONTRIBUTING.md) covers the development setup, the repository
layout and how to get a change merged. Participation is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md), and security vulnerabilities go through
[SECURITY.md](SECURITY.md) rather than a public issue.

## License

Apache License 2.0 with the Commons Clause condition, which removes the right to
_Sell_ the software. See [LICENSE](LICENSE).
