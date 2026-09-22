import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Database (Phase 1: Identity & RBAC)...');

  // Define permissions
  const permissionsData = [
    { name: 'user:read', description: 'Read user information' },
    { name: 'user:manage', description: 'Manage users (create, update, delete)' },
    { name: 'role:read', description: 'Read roles and permissions' },
    { name: 'role:manage', description: 'Manage roles and permissions' },
    { name: 'article:create', description: 'Create articles' },
    { name: 'article:read', description: 'Read articles' },
    { name: 'article:edit', description: 'Edit articles' },
    { name: 'article:delete', description: 'Delete articles' },
    // Phase 2 Permissions
    { name: 'article.create', description: 'Can create a new article' },
    { name: 'article.read.own', description: 'Can read own articles' },
    { name: 'article.read.any', description: 'Can read any non-deleted article' },
    { name: 'article.update.own', description: 'Can edit own articles' },
    { name: 'article.update.any', description: 'Can edit any draft' },
    { name: 'article.delete.own', description: 'Can soft-delete own draft' },
    { name: 'article.delete.any', description: 'Can soft-delete any draft' },
    {
      name: 'article.revision.create.own',
      description: 'Can create a new revision on own article',
    },
    { name: 'article.revision.create.any', description: 'Can create a new revision on any draft' },
    { name: 'category.manage', description: 'Create/update/delete categories' },
    { name: 'tag.manage', description: 'Tag management operations beyond inline find-or-create' },
    // Phase 3 Permissions
    { name: 'article.submit-review', description: 'Can submit an article for review' },
    { name: 'article.start-review', description: 'Can start reviewing or request changes' },
    { name: 'article.request-changes', description: 'Can request changes' },
    { name: 'article.reject', description: 'Can reject an article' },
    { name: 'article.approve', description: 'Can approve an article' },
    { name: 'article.publish', description: 'Can publish an article' },
    { name: 'article.schedule', description: 'Can schedule an article' },
    { name: 'article.cancel-schedule', description: 'Can cancel a scheduled article' },
    { name: 'article.archive', description: 'Can archive a published article' },
    // Phase 4 Permissions
    { name: 'media.upload', description: 'Upload a new media file' },
    {
      name: 'media.read.own',
      description: 'Read own media metadata and generate signed URL for own media',
    },
    {
      name: 'media.read.any',
      description: 'Read any media metadata and generate signed URL for any media',
    },
    { name: 'media.delete.own', description: 'Soft-delete own media (blocked if in use)' },
    {
      name: 'media.delete.any',
      description: 'Soft-delete any media (admin only, blocked if in use)',
    },
  ];

  const permissionRecords: Record<string, { id: string }> = {};

  for (const p of permissionsData) {
    const permission = await prisma.permission.upsert({
      where: { name: p.name },
      update: { description: p.description },
      create: p,
    });
    permissionRecords[p.name] = permission;
  }

  // Define roles and their associated permissions
  const rolesData = [
    {
      name: 'author',
      description: 'Standard content author',
      permissions: [
        'user:read',
        'article:create',
        'article:read',
        'article:edit',
        'article.create',
        'article.read.own',
        'article.update.own',
        'article.delete.own',
        'article.revision.create.own',
        'article.submit-review',
        'media.upload',
        'media.read.own',
        'media.delete.own',
      ],
    },
    {
      name: 'editor',
      description: 'Editorial staff',
      permissions: [
        'user:read',
        'article:create',
        'article:read',
        'article:edit',
        'article:delete',
        'article.create',
        'article.read.any',
        'article.update.any',
        'article.revision.create.any',
        'category.manage',
        'tag.manage',
        'article.submit-review',
        'article.start-review',
        'article.request-changes',
        'article.reject',
        'article.approve',
        'article.publish',
        'article.schedule',
        'article.cancel-schedule',
        'article.archive',
        'media.upload',
        'media.read.own',
        'media.read.any',
        'media.delete.own',
      ],
    },
    {
      name: 'admin',
      description: 'Administrator with full access',
      permissions: [
        'user:read',
        'user:manage',
        'role:read',
        'role:manage',
        'article:create',
        'article:read',
        'article:edit',
        'article:delete',
        'article.create',
        'article.read.any',
        'article.update.any',
        'article.delete.any',
        'article.revision.create.any',
        'category.manage',
        'tag.manage',
        'article.submit-review',
        'article.start-review',
        'article.request-changes',
        'article.reject',
        'article.approve',
        'article.publish',
        'article.schedule',
        'article.cancel-schedule',
        'article.archive',
        'media.upload',
        'media.read.own',
        'media.read.any',
        'media.delete.own',
        'media.delete.any',
      ],
    },
  ];

  for (const r of rolesData) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: { name: r.name, description: r.description },
    });

    // Assign permissions to the role
    for (const pName of r.permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permissionRecords[pName].id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permissionRecords[pName].id,
        },
      });
    }
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
