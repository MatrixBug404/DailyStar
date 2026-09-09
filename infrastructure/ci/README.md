# CI / GitHub Actions

CI workflow files live in [`.github/workflows/`](../../.github/workflows/) (required by GitHub).

## Workflows

| File | Trigger | Jobs |
|---|---|---|
| [`ci.yml`](../../.github/workflows/ci.yml) | Push / PR to any branch | `install` → `lint`, `typecheck`, `test`, `build` (parallel) |

## Local CI Simulation

Run the same checks locally:

```bash
# Install
pnpm install

# Lint
pnpm lint

# Type check
pnpm typecheck

# Test
pnpm test

# Build
pnpm build
```

## Future Workflows (not in Phase 0)

- **Deploy to staging** — triggered on merge to `main`
- **Deploy to production** — manual trigger after staging sign-off
- **Dependency vulnerability scan** — weekly schedule
