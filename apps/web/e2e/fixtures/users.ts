import { test as base } from '@playwright/test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../../../api/src/database/client');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const argon2 = require('../../../api/node_modules/argon2');

const E2E_PASSWORD = 'Password123!';

async function provisionUser(email: string, roleName: string) {
  const passwordHash = await argon2.hash(E2E_PASSWORD);

  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`Role ${roleName} not found. Did you seed the database?`);
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      isActive: true,
    },
    create: {
      email,
      passwordHash,
      displayName: `E2E ${roleName}`,
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: role.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: role.id,
    },
  });

  return { email, password: E2E_PASSWORD, id: user.id };
}

export type E2EUsers = {
  authorUser: { email: string; password: string; id: string };
  editorUser: { email: string; password: string; id: string };
};

export const test = base.extend<E2EUsers>({
  authorUser: async ({}, use) => {
    const author = await provisionUser('author_e2e@dailystar.local', 'author');
    await use(author);
    // Cleanup/isolation expectation:
    // The user record is reused idempotently across runs to speed up testing.
    // E2E tests are responsible for isolating or cleaning up any articles they create.
  },
  editorUser: async ({}, use) => {
    const editor = await provisionUser('editor_e2e@dailystar.local', 'editor');
    await use(editor);
  },
});
