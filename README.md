# ClawBridge

ClawBridge is an open-source CLI that helps you discover relevant business connection opportunities from your own workspace context.

It is designed for **signal sharing and workflow automation**, not spam automation.

---

## TL;DR

- You connect your workspace profile
- `clawbridge run` discovers potential people/companies to reach out to
- Results are saved locally (JSON + Markdown)
- Optional upload to ClawBridge Vault
- Future runs auto-avoid previously discovered candidates via `constraints.avoid_list`

---

## Prerequisite

ClawBridge works with an OpenClaw workflow setup.

- Install OpenClaw first
- Then install/use ClawBridge

If you are new to OpenClaw, start from OpenClaw docs first.

---

## What ClawBridge actually does

### 1) Reads your workspace profile and constraints
It uses your configured context (industry, target profile, constraints) to search for better-fit opportunities.

### 2) Runs discovery and ranking
It gathers candidate leads and ranks them based on relevance.

### 3) Exports usable outputs
Each run generates local artifacts you can inspect, edit, or feed into your own workflow:

- `output/*.json`
- `output/*.md`

### 4) Optional Vault sync
If Vault is configured, results can be uploaded for centralized tracking.

### 5) Prevents repeated suggestions
After discovery, candidate identifiers can be appended into `constraints.avoid_list` in your active config (with backup), so the next run biases toward net-new people.

---

## Screenshots

### Installer / onboarding
![Clawbridge install page](docs/screenshots/install-page.png)

### CLI run output
![Clawbridge run output](docs/screenshots/run-output.png)

---

## Install

### Option A: Installer (recommended)

```bash
curl -fsSL https://clawbridge.cloud/install | bash
```

### Option B: From source

```bash
git clone https://github.com/LeeTheBuilder/ClawBridge.git
cd ClawBridge
npm install
npm run build
npm link
```

---

## Quick start

1. Create a workspace on `clawbridge.cloud`
2. Link your workspace:

```bash
clawbridge link CB-XXXXXX
```

3. Run discovery:

```bash
clawbridge run
```

---

## Core commands

```bash
clawbridge run
clawbridge run --dry-run
clawbridge doctor
clawbridge validate
clawbridge schedule --cron "0 21 * * *"
```

---

## Config

Default config path:

- `~/.clawbridge/config.yml`

Use explicit config when needed:

```bash
clawbridge run -c /path/to/config.yml
```

---

## Chinese README

中文文档：[`README.zh-CN.md`](./README.zh-CN.md)

---

## Security

- Keep workspace keys in environment variables
- Do not commit `.env` or private config
- See `SECURITY.md` for reporting policy

## Contributing

See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

## License

MIT
