'use strict';

// Admin announcements (ej_broadcast_notifications) shown to every customer. They live in their own tables, so
// every function here degrades to "no announcements" instead of failing if those tables do not exist yet.

const LIST_SQL = `SELECT b.id, b.title, b.body, b.link_url, b.link_label, b.link_kind, b.created_at, r.read_at
  FROM ej_broadcast_notifications b
  LEFT JOIN ej_broadcast_reads r ON r.broadcast_id = b.id AND r.user_id = $1
  WHERE b.active = TRUE
  ORDER BY b.created_at DESC
  LIMIT 50`;

function safeLink(url) {
  try {
    const parsed = new URL(String(url));
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch { return null; }
}

function shape(row) {
  const linkUrl = row.link_url ? safeLink(row.link_url) : null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: 'ANNOUNCEMENT',
    broadcast: true,
    createdAt: row.created_at,
    readAt: row.read_at || null,
    linkUrl,
    linkLabel: linkUrl ? row.link_label || 'Open link' : null,
    linkKind: linkUrl ? row.link_kind || 'LINK' : null,
  };
}

async function listBroadcasts(prisma, userId) {
  try {
    const found = await prisma.$queryRawUnsafe(LIST_SQL, userId);
    return found.map(shape);
  } catch { return []; }
}

async function countUnreadBroadcasts(prisma, userId) {
  try {
    const found = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM ej_broadcast_notifications b
       WHERE b.active = TRUE
         AND NOT EXISTS (SELECT 1 FROM ej_broadcast_reads r WHERE r.broadcast_id = b.id AND r.user_id = $1)`,
      userId,
    );
    return Number(found[0]?.n || 0);
  } catch { return 0; }
}

async function markBroadcastRead(prisma, userId, broadcastId) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ej_broadcast_reads (user_id, broadcast_id)
       SELECT $1, id FROM ej_broadcast_notifications WHERE id = $2
       ON CONFLICT (user_id, broadcast_id) DO NOTHING`,
      userId, broadcastId,
    );
  } catch { /* announcements are optional */ }
}

async function markAllBroadcastsRead(prisma, userId) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ej_broadcast_reads (user_id, broadcast_id)
       SELECT $1, id FROM ej_broadcast_notifications WHERE active = TRUE
       ON CONFLICT (user_id, broadcast_id) DO NOTHING`,
      userId,
    );
  } catch { /* announcements are optional */ }
}

const isBroadcastId = (id) => /^bc_[A-Za-z0-9_-]+$/.test(String(id || ''));

module.exports = { listBroadcasts, countUnreadBroadcasts, markBroadcastRead, markAllBroadcastsRead, isBroadcastId, shape };
