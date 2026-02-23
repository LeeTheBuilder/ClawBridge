# Contributing to Clawbridge Runner

Thanks for contributing.

## Quick Start

```bash
git clone https://github.com/moltlife/clawbridge-runner.git
cd clawbridge-runner
npm install
npm run build
```

## Development Workflow

1. Create a branch from `main`
2. Make focused changes
3. Run checks locally:
   - `npm run build`
4. Open a PR with:
   - problem statement
   - what changed
   - how it was tested

## Coding Notes

- Keep user-facing defaults simple (`clawbridge run` should “just work”).
- Preserve backward compatibility in config where possible.
- Never log secrets.

## Release

Releases are tag-based (`v*`) and published from this repository via GitHub Actions.
