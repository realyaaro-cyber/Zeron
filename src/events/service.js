const EVENT_TYPES = new Set(['1v1_tournament', 'team_vs_team', 'free_for_all', 'custom']);
const EVENT_STATUSES = new Set(['draft', 'registration_open', 'registration_locked', 'preparing', 'active', 'paused', 'completed', 'cancelled']);
const EVENT_STAFF_ROLES = new Set(['host', 'referee', 'scorekeeper']);
const ACTIVE_STATUSES = ['registration_open', 'registration_locked', 'preparing', 'active', 'paused'];

function initializeEventSchema(db) {
  db.exec(\`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      capacity INTEGER NOT NULL CHECK(capacity BETWEEN 2 AND 1000),
      rules TEXT NOT NULL DEFAULT '',
      starts_at INTEGER,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_guild_status ON events(guild_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS event_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'registered',
      joined_at INTEGER NOT NULL,
      UNIQUE(event_id, user_id),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_event_participants_event ON event_participants(event_id, status);

    CREATE TABLE IF NOT EXISTS event_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      round_number INTEGER NOT NULL DEFAULT 1,
      match_number INTEGER NOT NULL,
      participant_a TEXT,
      participant_b TEXT,
      winner_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      bracket_locked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      UNIQUE(event_id, round_number, match_number),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      score REAL NOT NULL,
      recorded_by TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      FOREIGN KEY(match_id) REFERENCES event_matches(id) ON DELETE CASCADE,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount TEXT NOT NULL DEFAULT '',
      placement INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_staff (
      event_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('host', 'referee', 'scorekeeper')),
      assigned_by TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      PRIMARY KEY(event_id, user_id, role),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      announcement_type TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_event_staff_user ON event_staff(guild_id, user_id);
  \`);
}

function createEventService(db) {
  initializeEventSchema(db);

  function getEvent(guildId, eventId) {
    return db.prepare('SELECT * FROM events WHERE guild_id = ? AND id = ?')
      .get(String(guildId), Number(eventId)) || null;
  }

  function log(eventId, guildId, actorId, action, details = {}) {
    db.prepare(\`INSERT INTO event_activity (event_id, guild_id, actor_id, action, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)\`)
      .run(Number(eventId), String(guildId), String(actorId), String(action), JSON.stringify(details), Date.now());
  }

  return {
    createEvent(guildId, actorId, input) {
      const name = String(input.name || '').trim();
      const description = String(input.description || '').trim();
      const type = String(input.type || '');
      const capacity = Number(input.capacity);
      if (name.length < 3 || name.length > 80) throw new Error('Event name must be 3–80 characters.');
      if (description.length > 1500) throw new Error('Description must be 1500 characters or less.');
      if (!EVENT_TYPES.has(type)) throw new Error('Choose a valid event format.');
      if (!Number.isInteger(capacity) || capacity < 2 || capacity > 1000) throw new Error('Capacity must be between 2 and 1000.');
      const now = Date.now();
      const result = db.prepare(\`INSERT INTO events
        (guild_id, name, description, event_type, status, capacity, rules, starts_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)\`)
        .run(String(guildId), name, description, type, capacity, String(input.rules || '').slice(0, 4000),
          Number.isFinite(Number(input.startsAt)) && input.startsAt ? Number(input.startsAt) : null,
          String(actorId), now, now);
      const id = Number(result.lastInsertRowid);
      log(id, guildId, actorId, 'event_created', { name, type, capacity });
      return getEvent(guildId, id);
    },

    getEvent,
    listEvents(guildId, statuses = null) {
      if (!statuses) return db.prepare('SELECT * FROM events WHERE guild_id = ? ORDER BY created_at DESC').all(String(guildId));
      const valid = statuses.filter(status => EVENT_STATUSES.has(status));
      if (!valid.length) return [];
      return db.prepare(\`SELECT * FROM events WHERE guild_id = ? AND status IN (\${valid.map(() => '?').join(',')}) ORDER BY created_at DESC\`)
        .all(String(guildId), ...valid);
    },

    openRegistration(guildId, eventId, actorId) {
      const event = getEvent(guildId, eventId);
      if (!event) throw new Error('Event not found.');
      if (event.status !== 'draft') throw new Error('Registration can only be opened for a draft event.');
      const now = Date.now();
      db.prepare("UPDATE events SET status = 'registration_open', updated_at = ? WHERE guild_id = ? AND id = ?")
        .run(now, String(guildId), Number(eventId));
      log(eventId, guildId, actorId, 'registration_opened');
      return getEvent(guildId, eventId);
    },

    joinEvent(guildId, eventId, userId) {
      return db.transaction(() => {
        const event = getEvent(guildId, eventId);
        if (!event) return { ok: false, reason: 'not_found' };
        if (event.status !== 'registration_open') return { ok: false, reason: 'closed' };
        const alreadyJoined = db.prepare("SELECT 1 FROM event_participants WHERE event_id = ? AND user_id = ? AND status = 'registered'")
          .get(Number(eventId), String(userId));
        if (alreadyJoined) return { ok: false, reason: 'already_joined' };
        const active = db.prepare(\`SELECT e.id, e.name FROM event_participants p
          JOIN events e ON e.id = p.event_id
          WHERE p.guild_id = ? AND p.user_id = ? AND p.status = 'registered'
          AND e.status IN (\${ACTIVE_STATUSES.map(() => '?').join(',')}) LIMIT 1\`)
          .get(String(guildId), String(userId), ...ACTIVE_STATUSES);
        if (active) return { ok: false, reason: 'already_in_event', event: active };
        const count = db.prepare("SELECT COUNT(*) AS count FROM event_participants WHERE event_id = ? AND status = 'registered'")
          .get(Number(eventId)).count;
        if (count >= event.capacity) {
          db.prepare("UPDATE events SET status = 'registration_locked', updated_at = ? WHERE id = ?")
            .run(Date.now(), Number(eventId));
          return { ok: false, reason: 'full' };
        }
        db.prepare(\`INSERT INTO event_participants (event_id, guild_id, user_id, status, joined_at)
          VALUES (?, ?, ?, 'registered', ?)\`).run(Number(eventId), String(guildId), String(userId), Date.now());
        const newCount = count + 1;
        if (newCount >= event.capacity) {
          db.prepare("UPDATE events SET status = 'registration_locked', updated_at = ? WHERE id = ?")
            .run(Date.now(), Number(eventId));
        }
        log(eventId, guildId, userId, 'participant_registered', { count: newCount });
        return { ok: true, count: newCount, capacity: event.capacity, locked: newCount >= event.capacity };
      })();
    },

    listParticipants(guildId, eventId) {
      return db.prepare(\`SELECT p.*, e.name AS event_name FROM event_participants p
        JOIN events e ON e.id = p.event_id
        WHERE p.guild_id = ? AND p.event_id = ? ORDER BY p.joined_at ASC\`)
        .all(String(guildId), Number(eventId));
    },

    assignStaff(guildId, eventId, userId, role, actorId) {
      if (!EVENT_STAFF_ROLES.has(role)) throw new Error('Invalid event staff role.');
      const event = getEvent(guildId, eventId);
      if (!event) throw new Error('Event not found.');
      db.prepare(\`INSERT INTO event_staff (event_id, guild_id, user_id, role, assigned_by, assigned_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, user_id, role) DO NOTHING\`)
        .run(Number(eventId), String(guildId), String(userId), role, String(actorId), Date.now());
      log(eventId, guildId, actorId, 'staff_assigned', { userId: String(userId), role });
      return true;
    },

    removeStaff(guildId, eventId, userId, role, actorId) {
      const removed = db.prepare('DELETE FROM event_staff WHERE event_id = ? AND guild_id = ? AND user_id = ? AND role = ?')
        .run(Number(eventId), String(guildId), String(userId), String(role)).changes > 0;
      if (removed) log(eventId, guildId, actorId, 'staff_removed', { userId: String(userId), role });
      return removed;
    },

    getStaffRoles(guildId, eventId, userId) {
      return db.prepare('SELECT role FROM event_staff WHERE guild_id = ? AND event_id = ? AND user_id = ?')
        .all(String(guildId), Number(eventId)).map(row => row.role);
    },

    canManageEvent(guildId, eventId, userId) {
      return this.getStaffRoles(guildId, eventId, userId).length > 0;
    },

    setEventStatus(guildId, eventId, status, actorId) {
      if (!EVENT_STATUSES.has(status)) throw new Error('Invalid event status.');
      const event = getEvent(guildId, eventId);
      if (!event) throw new Error('Event not found.');
      const allowed = {
        draft: ['registration_open', 'cancelled'],
        registration_open: ['registration_locked', 'cancelled'],
        registration_locked: ['preparing', 'cancelled'],
        preparing: ['active', 'cancelled'],
        active: ['paused', 'completed', 'cancelled'],
        paused: ['active', 'cancelled'],
        completed: [],
        cancelled: []
      };
      if (!allowed[event.status].includes(status)) throw new Error('That event status change is not allowed.');
      db.prepare('UPDATE events SET status = ?, updated_at = ? WHERE guild_id = ? AND id = ?')
        .run(status, Date.now(), String(guildId), Number(eventId));
      log(eventId, guildId, actorId, 'status_changed', { from: event.status, to: status });
      return getEvent(guildId, eventId);
    },

    recordAnnouncement(guildId, eventId, channelId, messageId, type, actorId) {
      if (!getEvent(guildId, eventId)) throw new Error('Event not found.');
      const result = db.prepare(\`INSERT INTO event_announcements
        (event_id, guild_id, channel_id, message_id, announcement_type, published_by, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)\`)
        .run(Number(eventId), String(guildId), String(channelId), messageId ? String(messageId) : null,
          String(type), String(actorId), Date.now());
      log(eventId, guildId, actorId, 'announcement_published', { channelId: String(channelId), type: String(type) });
      return Number(result.lastInsertRowid);
    },

    getActivity(guildId, eventId, limit = 50) {
      return db.prepare('SELECT * FROM event_activity WHERE guild_id = ? AND event_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(String(guildId), Number(eventId), Math.max(1, Math.min(200, Number(limit) || 50)));
    }
  };
}

module.exports = { createEventService, initializeEventSchema, EVENT_TYPES, EVENT_STATUSES, EVENT_STAFF_ROLES };
