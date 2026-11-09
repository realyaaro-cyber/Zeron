const { ActivityType } = require('discord.js');

// The only Discord user allowed to change the bot's status. Can be overridden with DEVELOPER_ID in .env.
const DEVELOPER_ID = process.env.DEVELOPER_ID || '1560621828982968470';

const STATUSES = ['online', 'idle', 'dnd', 'invisible'];
const DEFAULT_PRESENCE = { text: 'Chilling now', status: 'online' };

function getPresence(db) {
  const raw = db.getBotSetting('presence');
  if (!raw) return { ...DEFAULT_PRESENCE };
  try {
    const saved = JSON.parse(raw);
    return {
      text: saved.text || DEFAULT_PRESENCE.text,
      status: STATUSES.includes(saved.status) ? saved.status : DEFAULT_PRESENCE.status
    };
  } catch {
    return { ...DEFAULT_PRESENCE };
  }
}

function validatePresence(body) {
  const text = String(body?.text ?? '').trim();
  if (text.length === 0 || text.length > 128) return { error: 'Status text must be 1 to 128 characters.' };
  if (!STATUSES.includes(body?.status)) return { error: 'Choose a valid status.' };
  return { value: { text, status: body.status } };
}

// Always a custom status, so the text shows exactly as written.
function applyPresence(client, presence) {
  if (!client.user) return;
  client.user.setPresence({
    activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: presence.text }],
    status: presence.status
  });
}

module.exports = { DEVELOPER_ID, getPresence, validatePresence, applyPresence };
