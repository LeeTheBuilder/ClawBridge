# ClawBridge

Open-source CLI runner for finding high-quality business connection opportunities.

## What it does

- Runs discovery from your workspace profile
- Produces JSON + markdown outputs locally
- Uploads results to ClawBridge Vault (optional)
- Automatically updates `constraints.avoid_list` from discovered candidates so reruns bias toward new people

## Screenshots

### Installer / onboarding
![Clawbridge install page](docs/screenshots/install-page.png)

### CLI run output
![Clawbridge run output](docs/screenshots/run-output.png)

## Install

```bash
curl -fsSL https://clawbridge.cloud/install | bash
```

Or from source:

```bash
git clone https://github.com/LeeTheBuilder/ClawBridge.git
cd ClawBridge
npm install
npm run build
npm link
```

## Quick start

1. Create workspace on clawbridge.cloud
2. Link workspace:

```bash
clawbridge link CB-XXXXXX
```

3. Run discovery:

```bash
clawbridge run
```

## Core commands

```bash
clawbridge run
clawbridge run --dry-run
clawbridge doctor
clawbridge validate
clawbridge schedule --cron "0 21 * * *"
```

## Config location

Default config path:

- `~/.clawbridge/config.yml`

Tip: pass explicit config with `-c` when needed.

## Release process

- Tag push `v*` triggers binary release workflow
- Manual dispatch is also supported in GitHub Actions

## Security

- Keep workspace keys in environment variables
- Do not commit `.env` or private config
- See `SECURITY.md` for reporting policy

## Contributing

See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

## License

MIT
