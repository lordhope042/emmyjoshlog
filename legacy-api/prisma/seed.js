'use strict';
require('../src/load-env');
const prisma = require('../src/db');

// Optional category initialization only. Never seed sellable synthetic stock,
// balances, credentials or a public administrator. Root setup owns admin bootstrap.
async function main() {
  for (const category of [
    { name: 'Logs', slug: 'logs', description: 'Authorized digital account products.' },
    { name: 'Virtual Numbers', slug: 'virtual-numbers', description: 'Virtual numbers for permitted communication and verification.' }
  ]) {
    await prisma.productCategory.upsert({ where: { slug: category.slug }, update: {}, create: category });
  }
  console.log('The two marketplace categories are initialized; no users, funds or stock were seeded.');
}

main()
  .catch(() => {
    console.error('Category initialization failed. Check database setup.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
