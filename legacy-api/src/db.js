'use strict';

// Load the one project-root environment file before Prisma reads DATABASE_URL.
require('./load-env');

const { PrismaClient } = require('@prisma/client');

// Reuse one PrismaClient/pool for this Node process. This also prevents
// duplicate clients during development reloads when globalThis is retained.
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__emmyjoshPrisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__emmyjoshPrisma = prisma;
}

module.exports = prisma;
