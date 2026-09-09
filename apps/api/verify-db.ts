import { PrismaClient } from './src/database/generated/prisma';

const prisma = new PrismaClient();

async function verify() {
  const authorRole = await prisma.role.findUnique({ where: { name: 'author' }, include: { permissions: { include: { permission: true } } } });
  const editorRole = await prisma.role.findUnique({ where: { name: 'editor' }, include: { permissions: { include: { permission: true } } } });
  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' }, include: { permissions: { include: { permission: true } } } });

  console.log('--- Author Permissions ---');
  console.log(authorRole?.permissions.map(p => p.permission.action).join(', '));

  console.log('\n--- Editor Permissions ---');
  console.log(editorRole?.permissions.map(p => p.permission.action).join(', '));

  console.log('\n--- Admin Permissions ---');
  console.log(adminRole?.permissions.map(p => p.permission.action).join(', '));
  
  await prisma.$disconnect();
}

verify().catch(console.error);
