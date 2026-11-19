const prisma = require('../db');

// Log sensitive admin actions: actor, action, target, before/after values.
async function audit(actorId, action, targetType, targetId, before, after) {
  await prisma.adminAuditLog.create({
    data: { actorId, action, targetType, targetId, before: before ?? undefined, after: after ?? undefined },
  });
}
module.exports = { audit };
