const crypto = require('node:crypto');

const EVENT_TYPES = new Set(['1v1_tournament', 'team_vs_team', 'free_for_all', 'custom']);
const EVENT_STATUSES = new Set(['draft', 'registration_open', 'registration_locked', 'preparing', 'active', 'paused', 'completed', 'cancelled']);
const EVENT_STAFF_ROLES = new Set(['host', 'referee', 'scorekeeper']);
const ACTIVE_STATUSES = ['registration_open', 'registration_locked', 'preparing', 'active', 'paused'];

function initializeEventSchema(db) {
  db.exec(`
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
  `);
  const eventColumns = db.prepare('PRAGMA table_info(events)').all().map(column => column.name);
  if (!eventColumns.includes('announcement_channel_id')) db.exec('ALTER TABLE events ADD COLUMN announcement_channel_id TEXT');
}

function createEventService(db) {
  initializeEventSchema(db);

  function getEvent(guildId, eventId) {
    return db.prepare('SELECT * FROM events WHERE guild_id = ? AND id = ?')
      .get(String(guildId), Number(eventId)) || null;
  }

  function log(eventId, guildId, actorId, action, details = {}) {
    db.prepare(`INSERT INTO event_activity (event_id, guild_id, actor_id, action, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
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
      const announcementChannelId = String(input.announcementChannelId || '');
      if (!/^\d{17,20}$/.test(announcementChannelId)) throw new Error('Choose an announcement channel for this event.');
      const now = Date.now();
      const result = db.prepare(`INSERT INTO events
        (guild_id, name, description, event_type, status, capacity, rules, starts_at, created_by, created_at, updated_at, announcement_channel_id)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`)
        .run(String(guildId), name, description, type, capacity, String(input.rules || '').slice(0, 4000),
          Number.isFinite(Number(input.startsAt)) && input.startsAt ? Number(input.startsAt) : null,
          String(actorId), now, now, announcementChannelId);
      const id = Number(result.lastInsertRowid);
      log(id, guildId, actorId, 'event_created', { name, type, capacity });
      return getEvent(guildId, id);
    },

    getEvent,
    listEvents(guildId, statuses = null) {
      if (!statuses) return db.prepare('SELECT * FROM events WHERE guild_id = ? ORDER BY created_at DESC').all(String(guildId));
      const valid = statuses.filter(status => EVENT_STATUSES.has(status));
      if (!valid.length) return [];
      return db.prepare(`SELECT * FROM events WHERE guild_id = ? AND status IN (${valid.map(() => '?').join(',')}) ORDER BY created_at DESC`)
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
        const active = db.prepare(`SELECT e.id, e.name FROM event_participants p
          JOIN events e ON e.id = p.event_id
          WHERE p.guild_id = ? AND p.user_id = ? AND p.status = 'registered'
          AND e.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')}) LIMIT 1`)
          .get(String(guildId), String(userId), ...ACTIVE_STATUSES);
        if (active) return { ok: false, reason: 'already_in_event', event: active };
        const count = db.prepare("SELECT COUNT(*) AS count FROM event_participants WHERE event_id = ? AND status = 'registered'")
          .get(Number(eventId)).count;
        if (count >= event.capacity) {
          db.prepare("UPDATE events SET status = 'registration_locked', updated_at = ? WHERE id = ?")
            .run(Date.now(), Number(eventId));
          return { ok: false, reason: 'full' };
        }
        db.prepare(`INSERT INTO event_participants (event_id, guild_id, user_id, status, joined_at)
          VALUES (?, ?, ?, 'registered', ?)`).run(Number(eventId), String(guildId), String(userId), Date.now());
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
      return db.prepare(`SELECT p.*, e.name AS event_name FROM event_participants p
        JOIN events e ON e.id = p.event_id
        WHERE p.guild_id = ? AND p.event_id = ? ORDER BY p.joined_at ASC`)
        .all(String(guildId), Number(eventId));
    },

    assignStaff(guildId, eventId, userId, role, actorId) {
      if (!EVENT_STAFF_ROLES.has(role)) throw new Error('Invalid event staff role.');
      const event = getEvent(guildId, eventId);
      if (!event) throw new Error('Event not found.');
      db.prepare(`INSERT INTO event_staff (event_id, guild_id, user_id, role, assigned_by, assigned_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, user_id, role) DO NOTHING`)
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

    listStaffEvents(guildId, userId) {
      return db.prepare(`SELECT e.*, GROUP_CONCAT(s.role) AS staff_roles
        FROM event_staff s JOIN events e ON e.id = s.event_id
        WHERE s.guild_id = ? AND s.user_id = ?
        GROUP BY e.id ORDER BY e.created_at DESC`)
        .all(String(guildId), String(userId));
    },

    listStaff(guildId, eventId) {
      return db.prepare('SELECT user_id, role, assigned_by, assigned_at FROM event_staff WHERE guild_id = ? AND event_id = ? ORDER BY role, assigned_at')
        .all(String(guildId), Number(eventId));
    },

    getStaffRoles(guildId, eventId, userId) {
      return db.prepare('SELECT role FROM event_staff WHERE guild_id = ? AND event_id = ? AND user_id = ?')
        .all(String(guildId), Number(eventId), String(userId)).map(row => row.role);
    },

    canManageEvent(guildId, eventId, userId) {
      return Boolean(db.prepare('SELECT 1 FROM event_staff WHERE guild_id = ? AND event_id = ? AND user_id = ? LIMIT 1')
        .get(String(guildId), Number(eventId), String(userId)));
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

    createTournamentBracket(guildId, eventId, actorId) {
      return db.transaction(() => {
        const event = getEvent(guildId, eventId);
        if (!event) throw new Error('Event not found.');
        if (event.event_type !== '1v1_tournament') throw new Error('Brackets are only available for 1v1 tournament events.');
        if (event.status !== 'registration_locked') throw new Error('Lock registration before generating the bracket.');
        const existing = db.prepare('SELECT COUNT(*) AS count FROM event_matches WHERE event_id = ?').get(Number(eventId)).count;
        if (existing) throw new Error('The bracket already exists and cannot be regenerated.');
        const participants = db.prepare("SELECT user_id FROM event_participants WHERE event_id = ? AND status = 'registered' ORDER BY joined_at")
          .all(Number(eventId)).map(row => row.user_id);
        if (participants.length < 2 || (participants.length & (participants.length - 1)) !== 0) {
          throw new Error('A no-bye single-elimination bracket needs 2, 4, 8, 16, 32, 64, or another power-of-two participant count.');
        }
        for (let i = participants.length - 1; i > 0; i--) {
          const j = crypto.randomInt(i + 1);
          [participants[i], participants[j]] = [participants[j], participants[i]];
        }
        const now = Date.now();
        const insert = db.prepare(`INSERT INTO event_matches
          (event_id, guild_id, round_number, match_number, participant_a, participant_b, status, bracket_locked, created_at)
          VALUES (?, ?, 1, ?, ?, ?, 'pending', 1, ?)`);
        for (let i = 0; i < participants.length; i += 2) {
          insert.run(Number(eventId), String(guildId), (i / 2) + 1, participants[i], participants[i + 1], now);
        }
        db.prepare("UPDATE events SET status = 'preparing', updated_at = ? WHERE id = ?")
          .run(now, Number(eventId));
        log(eventId, guildId, actorId, 'bracket_generated', { participantCount: participants.length, matchCount: participants.length / 2 });
        return db.prepare('SELECT * FROM event_matches WHERE event_id = ? ORDER BY round_number, match_number')
          .all(Number(eventId));
      })();
    },

    listMatches(guildId, eventId) {
      return db.prepare('SELECT * FROM event_matches WHERE guild_id = ? AND event_id = ? ORDER BY round_number, match_number')
        .all(String(guildId), Number(eventId));
    },

    recordMatchResult(guildId, eventId, matchId, scoreA, scoreB, actorId) {
      return db.transaction(() => {
        const event = getEvent(guildId, eventId);
        if (!event) throw new Error('Event not found.');
        if (event.event_type !== '1v1_tournament') throw new Error('Match scoring for this event format is not available yet.');
        if (event.status !== 'active') throw new Error('The event must be active before match results can be recorded.');
        const match = db.prepare('SELECT * FROM event_matches WHERE guild_id = ? AND event_id = ? AND id = ?')
          .get(String(guildId), Number(eventId), Number(matchId));
        if (!match) throw new Error('Match not found.');
        if (match.status === 'completed') throw new Error('This match result is already locked.');
        const a = Number(scoreA), b = Number(scoreB);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a > 1000000 || b > 1000000) {
          throw new Error('Scores must be valid numbers between 0 and 1,000,000.');
        }
        if (a === b) throw new Error('A tied score needs to be resolved before the result can be recorded.');
        const winnerId = a > b ? match.participant_a : match.participant_b;
        const now = Date.now();
        const insertScore = db.prepare(`INSERT INTO event_scores
          (match_id, event_id, guild_id, user_id, score, recorded_by, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`);
        insertScore.run(match.id, Number(eventId), String(guildId), match.participant_a, a, String(actorId), now);
        insertScore.run(match.id, Number(eventId), String(guildId), match.participant_b, b, String(actorId), now);
        db.prepare("UPDATE event_matches SET winner_id = ?, status = 'completed', completed_at = ? WHERE id = ?")
          .run(winnerId, now, match.id);
        log(eventId, guildId, actorId, 'match_result_recorded', {
          matchId: match.id, participantA: match.participant_a, scoreA: a,
          participantB: match.participant_b, scoreB: b, winnerId
        });

        const unfinished = db.prepare("SELECT COUNT(*) AS count FROM event_matches WHERE event_id = ? AND round_number = ? AND status != 'completed'")
          .get(Number(eventId), match.round_number).count;
        let championId = null;
        let nextRound = null;
        if (unfinished === 0) {
          const winners = db.prepare('SELECT winner_id FROM event_matches WHERE event_id = ? AND round_number = ? ORDER BY match_number')
            .all(Number(eventId), match.round_number).map(row => row.winner_id).filter(Boolean);
          if (winners.length === 1) {
            championId = winners[0];
            db.prepare("UPDATE events SET status = 'completed', updated_at = ? WHERE id = ?")
              .run(now, Number(eventId));
            log(eventId, guildId, actorId, 'event_champion_decided', { championId });
          } else {
            const roundNumber = match.round_number + 1;
            const insertNext = db.prepare(`INSERT INTO event_matches
              (event_id, guild_id, round_number, match_number, participant_a, participant_b, status, bracket_locked, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?)`);
            for (let i = 0; i < winners.length; i += 2) {
              insertNext.run(Number(eventId), String(guildId), roundNumber, (i / 2) + 1, winners[i], winners[i + 1], now);
            }
            nextRound = roundNumber;
            log(eventId, guildId, actorId, 'bracket_round_advanced', { roundNumber, matchCount: winners.length / 2 });
          }
        }
        return { ok: true, match: db.prepare('SELECT * FROM event_matches WHERE id = ?').get(match.id), nextRound, championId };
      })();
    },

    getScoreLeaderboard(guildId, eventId) {
      return db.prepare(`SELECT user_id, MAX(score) AS highest_score, SUM(score) AS total_score, COUNT(*) AS scored_matches
        FROM event_scores WHERE guild_id = ? AND event_id = ?
        GROUP BY user_id ORDER BY highest_score DESC, total_score DESC, user_id ASC`)
        .all(String(guildId), Number(eventId));
    },

    recordAnnouncement(guildId, eventId, channelId, messageId, type, actorId) {
      if (!getEvent(guildId, eventId)) throw new Error('Event not found.');
      const result = db.prepare(`INSERT INTO event_announcements
        (event_id, guild_id, channel_id, message_id, announcement_type, published_by, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(Number(eventId), String(guildId), String(channelId), messageId ? String(messageId) : null,
          String(type), String(actorId), Date.now());
      log(eventId, guildId, actorId, 'announcement_published', { channelId: String(channelId), type: String(type) });
      return Number(result.lastInsertRowid);
    },

    deleteCompletedEvent(guildId, eventId) {
      return db.transaction(() => {
        const event = getEvent(guildId, eventId);
        if (!event) throw new Error('Event not found.');
        if (event.status !== 'completed') throw new Error('Only completed events can be deleted.');
        const id = Number(eventId);
        const serverId = String(guildId);
        db.prepare('DELETE FROM event_scores WHERE guild_id = ? AND event_id = ?').run(serverId, id);
        db.prepare('DELETE FROM event_matches WHERE guild_id = ? AND event_id = ?').run(serverId, id);
        db.prepare('DELETE FROM event_participants WHERE guild_id = ? AND event_id = ?').run(serverId, id);
        db.prepare('DELETE FROM event_teams WHERE guild_id = ? AND event_id = ?').run(serverId, id);
        db.prepare('DELETE FROM event_rewards WHERE guild_id = ? AND event_id = ?').run(serverId, id);
        db.prepare('DELETE FROM event_staff WHERE guild_id = ? AND event_id = ?').run(serverId, id);
        db.prepare('DELETE FROM event_announcements WHERE guild_id = ? AND event_id = ?').run(serverId, id);
        db.prepare('DELETE FROM event_activity WHERE guild_id = ? AND event_id = ?').run(serverId, id);
        const deleted = db.prepare("DELETE FROM events WHERE guild_id = ? AND id = ? AND status = 'completed'").run(serverId, id);
        if (!deleted.changes) throw new Error('Completed event could not be deleted.');
        return { id, name: event.name };
      })();
    },

    getActivity(guildId, eventId, limit = 50) {
      return db.prepare('SELECT * FROM event_activity WHERE guild_id = ? AND event_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(String(guildId), Number(eventId), Math.max(1, Math.min(200, Number(limit) || 50)));
    }
  };
}

module.exports = { createEventService, initializeEventSchema, EVENT_TYPES, EVENT_STATUSES, EVENT_STAFF_ROLES };
