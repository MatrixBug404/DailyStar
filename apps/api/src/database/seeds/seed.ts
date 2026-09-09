/**
 * Database seed file — Phase 0 placeholder.
 *
 * Seeds will be added phase by phase:
 *   Phase 1: Default roles (author, editor, admin) and permissions
 *   Phase 2: Sample categories
 *
 * Run via: pnpm --filter @dailystar/api prisma db seed
 */

async function main(): Promise<void> {
  console.log('Phase 0: No seed data to insert yet.');
  console.log('Seed data will be added starting in Phase 1 (roles and permissions).');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    console.log('Seed script complete.');
  });
