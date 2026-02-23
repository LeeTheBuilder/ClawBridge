# ClawBridge Runner

A warm little CLI with serious utility.

**ClawBridge Runner** executes the `clawbridge-skill-latest` workflow, generates high-signal connection briefs, and delivers them to your preferred channel.

Use it as your repeatable “discovery engine” — not a spam cannon.

---

## What it does

- **Scheduled Runs** — Cron-based scheduling for nightly/weekly execution
- **Multi-Channel Delivery** — Discord, Slack, and Email support
- **Vault Integration** — Optional upload to `clawbridge.cloud` vault
- **Local Storage** — JSON and Markdown outputs saved locally
- **Dry Run Mode** — Test behavior without external delivery/upload
- **Auto Dedupe Assist** — Appends discovered identifiers to `constraints.avoid_list` (with backup) so reruns bias toward net-new candidates

---

## Prerequisite

You should have **OpenClaw installed first**.

ClawBridge Runner is designed to run alongside an OpenClaw-based workflow.

---

## Screenshots

### Installer / onboarding
![Clawbridge install page](docs/screenshots/install-page.png)

### CLI run output
![Clawbridge run output](docs/screenshots/run-output.png)

---

## Installation

### From npm

```bash
npm install -g clawbridge-runner
```

### From source

```bash
git clone https://github.com/LeeTheBuilder/ClawBridge.git
cd ClawBridge
npm install
npm run build
npm link
```

---

## Quick Start

### 1) Initialize configuration

```bash
clawbridge init
```

This creates:
- `config.yml` — project profile and runtime settings
- `.env` — secrets and tokens

### 2) Configure your profile

Edit `config.yml`:

```yaml
workspace_id: "ws_your_workspace_id"

project_profile:
  offer: "What your company offers"
  ask: "What you're looking for"
  ideal_persona: "Your target persona"
  verticals:
    - "keyword1"
    - "keyword2"
  tone: "friendly, professional"

delivery:
  target: "discord" # or "slack" or "email"
  discord:
    channel_id: "YOUR_CHANNEL_ID"
```

### 3) Set secrets

Edit `.env`:

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
# or
DISCORD_BOT_TOKEN=your_bot_token
```

### 4) Test run

```bash
clawbridge run --dry-run
```

### 5) Schedule recurring runs

```bash
clawbridge schedule --cron "0 21 * * *"
```

---

## Commands

### `clawbridge run`
Execute the skill once.

```bash
clawbridge run [options]
```

Options:
- `-c, --config <path>` Path to config file (default: `./config.yml`)
- `-o, --output <dir>` Output directory (default: `./output`)
- `--no-deliver` Skip delivery to Discord/Slack/Email
- `--no-upload` Skip vault upload
- `--dry-run` Preview without executing side effects

### `clawbridge schedule`
Start scheduler for periodic runs.

```bash
clawbridge schedule [options]
```

Options:
- `-c, --config <path>` Path to config file (default: `./config.yml`)
- `--cron <expression>` Cron expression (default: `"0 21 * * *"`)

Common cron expressions:
- `0 21 * * *` — Every day at 9 PM
- `0 6 * * *` — Every day at 6 AM
- `0 21 * * 1-5` — Weekdays at 9 PM
- `0 9 * * 1` — Every Monday at 9 AM

### `clawbridge init`
Initialize a new configuration.

```bash
clawbridge init [options]
```

Options:
- `-d, --dir <path>` Directory to initialize (default: `.`)

### `clawbridge validate`
Validate your config file.

```bash
clawbridge validate -c ./config.yml
```

### `clawbridge test-delivery`
Test delivery configuration only.

```bash
clawbridge test-delivery --channel discord
```

---

## Configuration (Full Reference)

```yaml
# Required: Workspace ID from clawbridge.cloud
workspace_id: "ws_your_workspace_id"

# Required: Project profile
project_profile:
  offer: "What your company/agency offers"
  ask: "What you're looking for (partners, clients, etc.)"
  ideal_persona: "Description of target personas"
  verticals:
    - "B2B SaaS"
    - "marketing automation"
  geo_timezone: "US/Pacific"

# Optional: do-not-contact list
disallowed:
  - "competitor@example.com"

# Optional
tone: "friendly, professional"

# Optional: Search constraints
constraints:
  no_spam_rules:
    - "No cold outreach to competitors"
  regions:
    - "US"
    - "EU"
  avoid_list:
    - "@spam_account"

# Optional: Resource usage limits
run_budget:
  max_searches: 20
  max_fetches: 50
  max_minutes: 10

# Required: Delivery settings
delivery:
  target: "discord" # or "slack" or "email"

  # Discord options
  discord:
    webhook_url: "" # Prefer env var DISCORD_WEBHOOK_URL
    # OR
    bot_token: ""   # Prefer env var DISCORD_BOT_TOKEN
    channel_id: "YOUR_CHANNEL_ID"

  # Slack options
  slack:
    webhook_url: "" # Prefer env var SLACK_WEBHOOK_URL
    # OR
    bot_token: ""   # Prefer env var SLACK_BOT_TOKEN
    channel: "#your-channel"

  # Email options
  email:
    smtp_host: "smtp.gmail.com"
    smtp_port: 587
    smtp_user: "your@email.com"
    smtp_pass: "" # Prefer env var SMTP_PASSWORD
    from: "Clawbridge <noreply@yourdomain.com>"
    to:
      - "recipient@example.com"

# Optional: Vault integration
vault:
  enabled: false
  api_url: "https://clawbridge.cloud/api"

# Optional: Output
output:
  dir: "./output"
  keep_runs: 30
```

> Note: Keep secrets in env vars when possible.

---

## Environment Variables

- `CLAWBRIDGE_WORKSPACE_TOKEN` — Auth token for vault uploads
- `DISCORD_WEBHOOK_URL` — Discord webhook URL
- `DISCORD_BOT_TOKEN` — Discord bot token
- `SLACK_WEBHOOK_URL` — Slack webhook URL
- `SLACK_BOT_TOKEN` — Slack bot token
- `SMTP_PASSWORD` — SMTP password for email
- `LOG_LEVEL` — Logging level (`debug`, `info`, `warn`, `error`)

---

## Output File Structure

```text
output/
├── run-2026-02-01T21-00-00.json
├── run-2026-02-01T21-00-00.md
├── latest.json -> run-2026-02-01T21-00-00.json
└── latest.md -> run-2026-02-01T21-00-00.md
```

JSON schema reference: `connection_brief.json` in the skill repo.

---

## Delivery Channels

### Discord

**Webhook (Recommended)**
1. Create a webhook in Discord channel settings
2. Set `DISCORD_WEBHOOK_URL`

**Bot mode**
1. Create Discord app + bot
2. Invite bot with Send Messages permission
3. Set `DISCORD_BOT_TOKEN` + `channel_id`

### Slack

**Webhook (Recommended)**
1. Create incoming webhook in Slack app settings
2. Set `SLACK_WEBHOOK_URL`

**Bot mode**
1. Create Slack app with `chat:write`
2. Install app to workspace
3. Set `SLACK_BOT_TOKEN` + `channel`

### Email

Example config:

```yaml
delivery:
  target: "email"
  email:
    smtp_host: "smtp.gmail.com"
    smtp_port: 587
    smtp_user: "your@gmail.com"
    from: "Clawbridge <your@gmail.com>"
    to:
      - "team@example.com"
```

For Gmail, use an **App Password** (not your regular account password).

---

## Running as a Service

### systemd (Linux)

Create `/etc/systemd/system/clawbridge.service`:

```ini
[Unit]
Description=Clawbridge Runner
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/clawbridge
ExecStart=/usr/bin/node /path/to/clawbridge-runner/dist/index.js schedule
Restart=always
RestartSec=10
EnvironmentFile=/path/to/clawbridge/.env

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl enable clawbridge
sudo systemctl start clawbridge
```

### PM2

```bash
npm install -g pm2
pm2 start "clawbridge schedule" --name clawbridge
pm2 save
pm2 startup
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
CMD ["node", "dist/index.js", "schedule"]
```

---

## Development

```bash
npm install
npm run dev -- run --dry-run
npm run build
npm test
npm run lint
```

---

## Related Projects

- `clawbridge-skill` — OpenClaw skill for discovery
- `clawbridge-web` — Web UI for workspace management

---

## Chinese README

中文文档：[`README.zh-CN.md`](./README.zh-CN.md)

---

## Security

- Keep workspace keys in env vars
- Do not commit `.env` or private config
- See `SECURITY.md` for reporting policy

## Contributing

See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

## License

MIT License — see `LICENSE` for details.
