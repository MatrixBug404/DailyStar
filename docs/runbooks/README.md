# DailyStar — Runbooks

Operational runbooks are documented here for common tasks and incident response.

Runbooks will be added as the platform evolves:

- Phase 5+: Public site deployment runbook
- Phase 7+: Scheduled publishing troubleshooting
- Phase 9+: AI pipeline incident response
- Production: Database backup restoration procedure
- Production: MinIO / S3 recovery

## Local Development Quick Reference

See [README.md](../../README.md) for the full local development guide.

### Reset local database

```bash
# Bring down services and remove volumes
docker compose -f infrastructure/docker/docker-compose.local.yml down -v

# Restart fresh
docker compose -f infrastructure/docker/docker-compose.local.yml up -d

# Re-run migrations
pnpm --filter @dailystar/api prisma:migrate:dev
```

### Reset MinIO buckets

```bash
docker compose -f infrastructure/docker/docker-compose.local.yml restart minio minio_init
```
