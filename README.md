# DailyStar

**Modern digital news portal** — accurate reporting, editorial integrity, AI-assisted newsroom pipeline.

DailyStar is a full-stack monorepo combining a public-facing news site, an editorial CMS, and an AI-assisted ingestion pipeline. Built with a bias toward simplicity a small student/developer team can actually ship.

> **Current phase:** Phase 0 — Project Scaffolding  
> See [`docs/architecture/README.md`](docs/architecture/README.md) for the full phased roadmap.

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 + React 19 + TypeScript + Tailwind CSS |
| Backend | NestJS 10 + TypeScript |
| Database | PostgreSQL 16 + Prisma |
| Cache / Queue | Redis 7 |
| Object Storage | MinIO (local dev) / AWS S3 (production) |
| Package manager | pnpm 9 (workspaces monorepo) |
| CI | GitHub Actions |

Architecture specification: [`dailystar_architecture.md`](dailystar_architecture.md)

---

## Prerequisites

| Tool | Minimum version | Install |
|---|---|---|
| Node.js | 20.x | [nodejs.org](https://nodejs.org) |
| pnpm | 9.x | `npm install -g pnpm@9` |
| Docker Desktop | 4.x | [docker.com](https://www.docker.com/products/docker-desktop) |
| Git | 2.x | [git-scm.com](https://git-scm.com) |

---

## Installation

```bash
# 1. Clone the repository
git clone <repo-url> dailystar
cd dailystar

# 2. Install all workspace dependencies
pnpm install
```

---

## Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and set your local values
# (the defaults work for local Docker Compose development out of the box)
```

Key variables (see `.env.example` for the full list):

| Variable | Default (local) | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://dailystar:changeme_local@localhost:5432/dailystar_dev` | Prisma database connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `MINIO_ROOT_USER` | `minioadmin` | MinIO admin username |
| `MINIO_ROOT_PASSWORD` | `changeme_local` | MinIO admin password |
| `PORT` | `3001` | NestJS API port |
| `NEXT_PORT` | `3000` | Next.js frontend port |

> **Never commit your `.env` file** — only `.env.example` is tracked in git.

---

## Starting Docker Services

Local infrastructure (PostgreSQL, Redis, MinIO) runs in Docker:

```bash
# Start all services in the background
docker compose -f infrastructure/docker/docker-compose.local.yml up -d

# Check service health
docker compose -f infrastructure/docker/docker-compose.local.yml ps

# View logs for a specific service
docker compose -f infrastructure/docker/docker-compose.local.yml logs -f postgres

# Stop services
docker compose -f infrastructure/docker/docker-compose.local.yml down

# Stop services and remove volumes (CAUTION: deletes all local data)
docker compose -f infrastructure/docker/docker-compose.local.yml down -v
```

**MinIO web console** is available at [http://localhost:9001](http://localhost:9001)  
Login with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from your `.env`.

---

## Starting the Frontend

```bash
# Start Next.js development server (port 3000)
pnpm --filter @dailystar/web dev

# Or from the apps/web directory
cd apps/web && pnpm dev
```

Visit: [http://localhost:3000](http://localhost:3000)

---

## Starting the Backend

```bash
# Start NestJS in watch mode (port 3001)
pnpm --filter @dailystar/api start:dev

# Or from the apps/api directory
cd apps/api && pnpm start:dev
```

Health check: [http://localhost:3001/health](http://localhost:3001/health)  
Expected response: `{ "status": "ok", "timestamp": "...", "version": "0.0.1" }`

### Prisma (Database)

```bash
# Generate Prisma client (run after any schema change)
pnpm --filter @dailystar/api prisma:generate

# Create and apply a new migration (development only)
pnpm --filter @dailystar/api prisma:migrate:dev

# Apply existing migrations (CI / production)
pnpm --filter @dailystar/api prisma:migrate:deploy

# Open Prisma Studio (visual database browser)
pnpm --filter @dailystar/api prisma:studio
```

---

## Running Tests

```bash
# Run all tests across the monorepo
pnpm test

# Run tests for a specific package
pnpm --filter @dailystar/api test
pnpm --filter @dailystar/web test

# Run with coverage
pnpm test:ci

# Run API e2e tests
pnpm --filter @dailystar/api test:e2e

# Run in watch mode (development)
pnpm --filter @dailystar/api test:watch
```

---

## Lint, Typecheck, and Build

```bash
# Lint all packages
pnpm lint

# Fix lint issues automatically
pnpm --filter @dailystar/api lint --fix

# Type check all packages
pnpm typecheck

# Production build (all apps)
pnpm build

# Build a specific app
pnpm --filter @dailystar/web build
pnpm --filter @dailystar/api build

# Format code with Prettier
pnpm format

# Check formatting (no write)
pnpm format:check
```

---

## Monorepo Structure

```
dailystar/
├── apps/
│   ├── web/          # Next.js frontend (public site + CMS)
│   └── api/          # NestJS backend API
├── packages/
│   ├── types/        # @dailystar/types — shared TS types
│   ├── ui/           # @dailystar/ui — shared design system components
│   └── config/       # @dailystar/config — shared ESLint/TS config
├── infrastructure/
│   ├── docker/       # Docker Compose for local dev
│   └── ci/           # CI documentation (workflows in .github/workflows/)
├── docs/
│   └── architecture/ # Architecture docs and ADRs
├── .github/
│   └── workflows/    # GitHub Actions CI
├── .env.example      # Environment variable reference
├── tsconfig.base.json
├── pnpm-workspace.yaml
└── README.md         # This file
```

---

## Package Manager Commands

This project uses **pnpm workspaces**. Useful commands:

```bash
# Install a dependency in a specific workspace
pnpm --filter @dailystar/api add <package>
pnpm --filter @dailystar/web add -D <package>

# Run a script in all workspaces
pnpm --recursive <script>

# Run a script in parallel across all workspaces
pnpm --recursive --parallel <script>

# Run a script in a specific workspace
pnpm --filter @dailystar/api <script>
```

---

## CI / Continuous Integration

GitHub Actions workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)

Triggered on every push and pull request. Jobs:
1. **Install** — `pnpm install --frozen-lockfile`
2. **Lint** — `pnpm lint`
3. **Typecheck** — `pnpm typecheck`
4. **Test** — `pnpm test:ci`
5. **Build** — `pnpm build`

Jobs 2–5 run in parallel after install completes.

---

## Contributing

1. Create a branch: `git checkout -b feature/your-feature`
2. Make your changes following the [architecture specification](dailystar_architecture.md)
3. Run `pnpm lint && pnpm typecheck && pnpm test` before pushing
4. Open a pull request — CI will run automatically

See **Section 15** of the architecture specification for the full coding agent and contributor guidelines.
