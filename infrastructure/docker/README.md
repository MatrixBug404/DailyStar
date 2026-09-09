# Infrastructure — Docker

This directory contains Docker configuration for local development.

## Files

| File | Description |
|---|---|
| [`docker-compose.local.yml`](docker-compose.local.yml) | Local development services (PostgreSQL, Redis, MinIO) |

## Services

| Service | Port | Description |
|---|---|---|
| `postgres` | 5432 | PostgreSQL 16 database |
| `redis` | 6379 | Redis 7 cache and queue |
| `minio` | 9000 (API), 9001 (console) | MinIO S3-compatible object storage |

## Usage

```bash
# Start all services
docker compose -f infrastructure/docker/docker-compose.local.yml up -d

# Check health
docker compose -f infrastructure/docker/docker-compose.local.yml ps

# Stop (keeps data)
docker compose -f infrastructure/docker/docker-compose.local.yml down

# Stop and remove volumes (destroys all local data)
docker compose -f infrastructure/docker/docker-compose.local.yml down -v
```

## Future

- `Dockerfile.api` — production container for the NestJS API (added in deployment phase)
- `Dockerfile.web` — production container for Next.js (if self-hosting, otherwise Vercel handles it)
