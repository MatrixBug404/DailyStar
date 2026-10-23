import { PrismaClient } from './generated/prisma';

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ||
        'postgresql://dailystar:changeme_local@localhost:5432/dailystar_dev?schema=public',
    },
  },
});
