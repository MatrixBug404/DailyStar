const fs = require('fs');
const glob = require('glob');
const path = require('path');

const files = glob.sync('apps/api/src/**/*.ts').concat(glob.sync('apps/api/test/**/*.ts'));
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('new PrismaClient()') || content.includes('PrismaClient } from')) {
    if (file.includes('database/client.ts') || file.includes('database\\\\client.ts')) continue;
    
    // Calculate relative path
    let depth = file.split('/').length;
    let relativePrefix = '../'.repeat(depth - 4) + 'database/client';
    if (file.includes('test/')) {
        relativePrefix = '../src/database/client';
    }
    
    content = content.replace(/import \{ PrismaClient \} from '[^']+';\r?\n?/g, '');
    content = content.replace(/const prisma = new PrismaClient\([^)]*\);\r?\n?/g, 'import { prisma } from \'' + relativePrefix + '\';\n');
    fs.writeFileSync(file, content);
  }
}
console.log('Replaced all PrismaClient instantiations with shared client.');
