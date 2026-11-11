// All player guilds share one network scope, so a guild and its members work across every server.
const GUILD_NETWORK = 'global';
const Database = require('better-sqlite3');

// Monday (UTC) of the week a timestamp falls in, as YYYY-MM-DD. Used for weekly XP.
const DEFAULT_BIRTHDAY_MESSAGE = 'Wish {users} a happy birthday today! 🥳';

function weekKeyFor(timestamp) {
  const d = new Date(timestamp);
  const day = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1));
  return monday.toISOString().slice(0, 10);
}

// Which table and columns a leaderboard type reads from.
function leaderboardSource(type) {
  if (type === 'coins') {
    return { table: 'economy_users', column: 'coins', select: 'user_id, coins AS value', where: 'guild_id = ?', params: guildId => [guildId] };
  }
  if (type === 'weekly') {
    return { table: 'xp_weekly', column: 'xp', select: 'user_id, xp AS value', where: 'guild_id = ? AND week = ?', params: guildId => [guildId, weekKeyFor(Date.now())] };
  }
  return { table: 'xp_users', column: 'xp', select: 'user_id, xp AS value, level', where: 'guild_id = ?', params: guildId => [guildId] };
}

function initializeDatabase(filename) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      welcome_enabled INTEGER NOT NULL DEFAULT 0,
      welcome_channel_id TEXT,
      welcome_message TEXT NOT NULL DEFAULT 'Welcome {user} to **{server}**!',
      mod_log_channel_id TEXT,
      bot_log_channel_id TEXT,
      announcement_channel_id TEXT,
      xp_channel_id TEXT,
      xp_channel_ids TEXT NOT NULL DEFAULT '[]',
      personal_channel_id TEXT,
      xp_enabled INTEGER NOT NULL DEFAULT 1,
      xp_cooldown INTEGER NOT NULL DEFAULT 60,
      xp_min INTEGER NOT NULL DEFAULT 10,
      xp_max INTEGER NOT NULL DEFAULT 20,
      levelup_enabled INTEGER NOT NULL DEFAULT 1,
      levelup_message TEXT NOT NULL DEFAULT '🎉 Congratulations {user}! You reached level {level} in {server}!',
      prefix TEXT NOT NULL DEFAULT '!',
      spam_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS xp_users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      last_message_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS economy_users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0 CHECK(coins >= 0),
      last_daily_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS economy_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS economy_bank (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
      last_interest_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS stats_channels (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      template TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );
    CREATE TABLE IF NOT EXISTS onboarding_config (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      channel_id TEXT,
      steps TEXT NOT NULL DEFAULT '[]',
      roles TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS trivia_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      reward INTEGER NOT NULL,
      started_by TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      winner_id TEXT
    );
    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      anonymous INTEGER NOT NULL DEFAULT 0,
      multiple INTEGER NOT NULL DEFAULT 0,
      allow_change INTEGER NOT NULL DEFAULT 1,
      required_role_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      closed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_polls_due ON polls(status, ends_at);
    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      options TEXT NOT NULL,
      voted_at INTEGER NOT NULL,
      PRIMARY KEY (poll_id, user_id),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS economy_collectibles (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, collectible_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      PRIMARY KEY (guild_id, user_id, collectible_id)
    );
    CREATE TABLE IF NOT EXISTS moderation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      moderator_id TEXT,
      target_id TEXT,
      action TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Invite tracking uses separate tables; existing records remain untouched.
  db.exec(`
    CREATE TABLE IF NOT EXISTS invite_tracker_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invite_tracker_joins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      inviter_id TEXT,
      joined_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invite_tracker_inviter
      ON invite_tracker_joins (guild_id, inviter_id);
  `);

  // Starboard configuration and published-message mapping.
  db.exec(`
    CREATE TABLE IF NOT EXISTS starboard_settings (
      guild_id TEXT PRIMARY KEY,
      source_channel_id TEXT NOT NULL,
      destination_channel_id TEXT NOT NULL,
      threshold INTEGER NOT NULL DEFAULT 5,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS starboard_posts (
      guild_id TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      destination_message_id TEXT NOT NULL,
      star_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, source_message_id),
      UNIQUE (guild_id, destination_message_id)
    );
  `);

  // Safe economy expansion: retain existing balances and XP.
  const economyColumns = db.prepare('PRAGMA table_info(economy_users)').all()
    .map(column => column.name);

  if (!economyColumns.includes('last_work_at')) {
    db.exec('ALTER TABLE economy_users ADD COLUMN last_work_at INTEGER NOT NULL DEFAULT 0');
  }
  if (!economyColumns.includes('last_weekly_at')) {
    db.exec('ALTER TABLE economy_users ADD COLUMN last_weekly_at INTEGER NOT NULL DEFAULT 0');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_inventory (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      PRIMARY KEY (guild_id, user_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS economy_achievements (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id, achievement_id)
    );
  `);

  db.exec(
    'CREATE TABLE IF NOT EXISTS fishing_inventory (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
    'guild_id TEXT NOT NULL, user_id TEXT NOT NULL, ' +
    'fish_name TEXT NOT NULL, emoji TEXT NOT NULL, ' +
    'value INTEGER NOT NULL CHECK(value > 0), ' +
    'caught_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS owner_gift_wallets (
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 99999 CHECK(coins >= 0),
      PRIMARY KEY (guild_id, owner_id)
    );
  `);

  // Persistent spam strikes; existing guild and economy data are untouched.
  db.exec(`
    CREATE TABLE IF NOT EXISTS spam_strikes (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      strikes INTEGER NOT NULL DEFAULT 0,
      last_strike_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // Premium: level rewards (one role per level, stacking).
  db.exec(`
    CREATE TABLE IF NOT EXISTS level_rewards (
      guild_id TEXT NOT NULL,
      level INTEGER NOT NULL CHECK(level >= 1),
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, level)
    );
  `);

  // Safe migration for existing databases.
  const settingsColumns = db.prepare("PRAGMA table_info(guild_settings)").all();
  if (!settingsColumns.some(column => column.name === 'spam_enabled')) {
    db.exec('ALTER TABLE guild_settings ADD COLUMN spam_enabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!settingsColumns.some(column => column.name === 'strike_enabled')) {
    db.exec('ALTER TABLE guild_settings ADD COLUMN strike_enabled INTEGER NOT NULL DEFAULT 1');
  }



if (!settingsColumns.some(column => column.name === 'levelup_message')) {
db.exec("ALTER TABLE guild_settings ADD COLUMN levelup_message TEXT NOT NULL DEFAULT '🎉 Congratulations {user}! You reached level {level} in {server}!'");
}

  if (!settingsColumns.some(column => column.name === 'xp_channel_ids')) {
    db.exec("ALTER TABLE guild_settings ADD COLUMN xp_channel_ids TEXT NOT NULL DEFAULT '[]'");
  }

  // Module on/off switches. Default 1 (on) so existing servers keep working.
  for (const column of ['panel_title TEXT', 'panel_message TEXT', 'approve_message TEXT', 'reject_message TEXT']) {
    try { db.exec('ALTER TABLE verification_config ADD COLUMN ' + column); } catch (e) { /* already added */ }
  }
  for (const moduleColumn of ['module_xp', 'module_economy', 'module_fishing', 'module_games', 'module_welcome', 'module_invites']) {
    if (!settingsColumns.some(column => column.name === moduleColumn)) {
      db.exec(`ALTER TABLE guild_settings ADD COLUMN ${moduleColumn} INTEGER NOT NULL DEFAULT 1`);
    }
  }

  // Rank card accent color, chosen per server.
  if (!settingsColumns.some(column => column.name === 'rank_accent')) {
    db.exec("ALTER TABLE guild_settings ADD COLUMN rank_accent TEXT NOT NULL DEFAULT '#46BBFF'");
  }

  // Auto-role on join: role list plus an on/off switch.
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_roles (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    );
  `);
  for (const [name, ddl] of [
    ['vault_alert_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['vault_alert_channel_id', "TEXT NOT NULL DEFAULT ''"],
    ['vault_alert_role_id', "TEXT NOT NULL DEFAULT ''"],
    ['vault_alert_trigger', "TEXT NOT NULL DEFAULT 'Sapphire Vault'"]
  ]) {
    if (!settingsColumns.some(column => column.name === name)) db.exec(`ALTER TABLE guild_settings ADD COLUMN ${name} ${ddl}`);
  }
  if (!settingsColumns.some(column => column.name === 'jail_role_id')) {
    db.exec("ALTER TABLE guild_settings ADD COLUMN jail_role_id TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColumns.some(column => column.name === 'autorole_enabled')) {
    db.exec('ALTER TABLE guild_settings ADD COLUMN autorole_enabled INTEGER NOT NULL DEFAULT 0');
  }

  // Reaction roles: one emoji per message maps to one role.
  db.exec(`
    CREATE TABLE IF NOT EXISTS reaction_roles (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (message_id, emoji)
    );
  `);

  // Global bot settings (not per server), e.g. the bot's presence.
  db.exec('CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  // Tickets: support roles per server, and open tickets (one open ticket per member per server).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_support_roles (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    );
    CREATE TABLE IF NOT EXISTS tickets (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Advanced tickets: categories, ticket types (each with its own support roles), claims, and transcripts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_config (
      guild_id TEXT PRIMARY KEY,
      category_id TEXT,
      log_channel_id TEXT
    );
    CREATE TABLE IF NOT EXISTS ticket_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      button_label TEXT NOT NULL,
      color TEXT NOT NULL,
      support_role_ids TEXT NOT NULL DEFAULT '[]'
    );
  `);
  const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all();
  if (!ticketColumns.some(column => column.name === 'type_id')) db.exec('ALTER TABLE tickets ADD COLUMN type_id INTEGER');
  if (!ticketColumns.some(column => column.name === 'claimed_by')) db.exec('ALTER TABLE tickets ADD COLUMN claimed_by TEXT');

  // Custom commands: text or embed replies triggered by "<prefix><name>".
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      title TEXT,
      color TEXT NOT NULL,
      image_url TEXT,
      UNIQUE (guild_id, name)
    );
  `);

  // Weekly XP per member, for the weekly leaderboard.
  db.exec('CREATE TABLE IF NOT EXISTS xp_weekly (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, week TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id, week))');

  // Birthdays: each member's day and month, and the server's announcement settings.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rank_card_backgrounds (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      preset TEXT,
      image BLOB,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS rank_avatar_cache (
      user_id TEXT PRIMARY KEY,
      avatar_key TEXT NOT NULL,
      image BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rank_avatar_cache_updated
      ON rank_avatar_cache (updated_at);
    CREATE TABLE IF NOT EXISTS afk_status (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      since INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS jail_records (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      jailed_role_id TEXT NOT NULL,
      roles TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS disabled_commands (
      guild_id TEXT NOT NULL,
      command TEXT NOT NULL,
      PRIMARY KEY (guild_id, command)
    );
    CREATE TABLE IF NOT EXISTS user_command_restrictions (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      command TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id, command)
    );
    CREATE TABLE IF NOT EXISTS vault_alert_rules (
      guild_id TEXT NOT NULL,
      vault TEXT NOT NULL,
      label TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, vault)
    );
    CREATE TABLE IF NOT EXISTS roblox_links (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      roblox_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS user_tips (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tip TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id, tip)
    );
    CREATE TABLE IF NOT EXISTS vault_request_channels (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS owner_wallets (
      guild_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL,
      cooldown_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS owner_gift_log (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS ai_chat_channels (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_chat_channel_list (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );
    INSERT OR IGNORE INTO ai_chat_channel_list (guild_id, channel_id)
      SELECT guild_id, channel_id FROM ai_chat_channels;
    DELETE FROM ai_chat_channels;
    CREATE TABLE IF NOT EXISTS ai_builder_channels (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );
    CREATE TABLE IF NOT EXISTS guild_birthdays (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      day INTEGER NOT NULL,
      month INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS birthday_config (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT,
      message TEXT NOT NULL DEFAULT 'Wish {users} a happy birthday today! 🥳',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sent TEXT
    );
  `);

  // Giveaways and their entries.
  db.exec(`
    CREATE TABLE IF NOT EXISTS giveaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      winners_count INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      min_level INTEGER,
      required_role_id TEXT,
      color TEXT NOT NULL,
      winner_ids TEXT NOT NULL DEFAULT '[]',
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (giveaway_id, user_id)
    );
  `);

  // Automod settings per server.
  db.exec(`
    CREATE TABLE IF NOT EXISTS automod_config (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      bad_words TEXT NOT NULL DEFAULT '[]',
      link_mode TEXT NOT NULL DEFAULT 'off',
      max_mentions INTEGER NOT NULL DEFAULT 5,
      strike_limit INTEGER NOT NULL DEFAULT 3,
      timeout_minutes INTEGER NOT NULL DEFAULT 10
    );
  `);

  // Stats for the overview: member joins/leaves, and messages counted per hour.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fishing_gear (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rod TEXT NOT NULL DEFAULT 'plastic',
      bait TEXT,
      owned TEXT NOT NULL DEFAULT '["plastic"]',
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS fishing_bait (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bait TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, bait)
    );
    CREATE TABLE IF NOT EXISTS verification_config (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      unverified_role_id TEXT,
      verified_role_id TEXT,
      review_channel_id TEXT,
      panel_channel_id TEXT,
      questions TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS verification_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      answers TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_by TEXT,
      reviewed_at INTEGER,
      review_message_id TEXT
    );
    CREATE TABLE IF NOT EXISTS fishing_profile (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS announcement_settings (
      guild_id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL DEFAULT 'UTC'
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      use_embed INTEGER NOT NULL DEFAULT 1,
      repeat_mode TEXT NOT NULL DEFAULT 'once',
      start_date TEXT NOT NULL,
      time_of_day TEXT NOT NULL,
      next_run INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      last_sent INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fishing_stats (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      shark INTEGER NOT NULL DEFAULT 0,
      legendary INTEGER NOT NULL DEFAULT 0,
      day TEXT,
      day_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS fishing_daily (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      catches INTEGER NOT NULL DEFAULT 0,
      sharks INTEGER NOT NULL DEFAULT 0,
      legendary INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, day)
    );
    CREATE TABLE IF NOT EXISTS fishing_quest_claims (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      claim_key TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, claim_key)
    );
    CREATE TABLE IF NOT EXISTS member_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS message_activity (
      guild_id TEXT NOT NULL,
      hour INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, hour)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_guilds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      leader_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      bank_balance INTEGER NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(guild_id, name)
    );
    CREATE TABLE IF NOT EXISTS player_guild_members (
      guild_id TEXT NOT NULL,
      player_guild_id INTEGER NOT NULL REFERENCES player_guilds(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('leader','member')),
      joined_at INTEGER NOT NULL,
      PRIMARY KEY(guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS player_guild_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      player_guild_id INTEGER NOT NULL REFERENCES player_guilds(id) ON DELETE CASCADE,
      inviter_id TEXT NOT NULL,
      invitee_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE(guild_id, player_guild_id, invitee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_player_guild_members_guild ON player_guild_members(guild_id, player_guild_id);
    CREATE INDEX IF NOT EXISTS idx_player_guilds_rank ON player_guilds(guild_id, id);
    CREATE TABLE IF NOT EXISTS player_guild_reward_claims (
      guild_id TEXT NOT NULL, player_guild_id INTEGER NOT NULL, level INTEGER NOT NULL,
      claimed_at INTEGER NOT NULL, PRIMARY KEY(guild_id, player_guild_id, level)
    );
    CREATE TABLE IF NOT EXISTS player_guild_war_origins (
      war_id INTEGER PRIMARY KEY,
      origin_guild_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player_guild_wars (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
      challenger_id INTEGER NOT NULL, opponent_id INTEGER NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('fishing','mixed')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','completed','declined')),
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL, starts_at INTEGER, ends_at INTEGER,
      challenger_fish_start INTEGER NOT NULL DEFAULT 0, opponent_fish_start INTEGER NOT NULL DEFAULT 0,
      challenger_xp_start INTEGER NOT NULL DEFAULT 0, opponent_xp_start INTEGER NOT NULL DEFAULT 0,
      challenger_score INTEGER NOT NULL DEFAULT 0, opponent_score INTEGER NOT NULL DEFAULT 0,
      winner_id INTEGER, rewarded_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_player_guild_wars_status ON player_guild_wars(guild_id, status);
  `);

  // Safe migrations for databases created before guild progression was added.
  const playerGuildColumns = new Set(db.prepare('PRAGMA table_info(player_guilds)').all().map(row => row.name));
  if (!playerGuildColumns.has('bank_balance')) db.exec('ALTER TABLE player_guilds ADD COLUMN bank_balance INTEGER NOT NULL DEFAULT 0');
  if (!playerGuildColumns.has('xp')) db.exec('ALTER TABLE player_guilds ADD COLUMN xp INTEGER NOT NULL DEFAULT 0');
  if (!playerGuildColumns.has('level')) db.exec('ALTER TABLE player_guilds ADD COLUMN level INTEGER NOT NULL DEFAULT 1');

  const ensure = db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)');
  return Object.assign(db, {
    claimPlayerGuildLevelRewards(guildId, playerGuildId) {
      const g = db.prepare('SELECT * FROM player_guilds WHERE guild_id = ? AND id = ?').get(GUILD_NETWORK, playerGuildId);
      if (!g) return [];
      const rewards = [{ level: 2, coins: 500 }, { level: 3, coins: 1000 }, { level: 5, coins: 2500 }, { level: 10, coins: 5000 }];
      return db.transaction(() => {
        const granted = [];
        for (const reward of rewards) {
          if (g.level < reward.level) continue;
          const exists = db.prepare('SELECT 1 FROM player_guild_reward_claims WHERE guild_id = ? AND player_guild_id = ? AND level = ?').get(GUILD_NETWORK, playerGuildId, reward.level);
          if (exists) continue;
          db.prepare('INSERT INTO player_guild_reward_claims (guild_id, player_guild_id, level, claimed_at) VALUES (?, ?, ?, ?)').run(GUILD_NETWORK, playerGuildId, reward.level, Date.now());
          db.prepare('UPDATE player_guilds SET bank_balance = bank_balance + ? WHERE guild_id = ? AND id = ?').run(reward.coins, GUILD_NETWORK, playerGuildId);
          granted.push(reward);
        }
        return granted;
      })();
    },
    guildLeaderInfo(playerGuildId) {
      return db.prepare('SELECT id, name, leader_id FROM player_guilds WHERE guild_id = ? AND id = ?').get(GUILD_NETWORK, playerGuildId) || null;
    },
    getGuildWar(guildId, warId) {
      return db.prepare('SELECT * FROM player_guild_wars WHERE guild_id = ? AND id = ?').get(GUILD_NETWORK, warId) || null;
    },
    listGuildWars(guildId, playerGuildId) {
      return db.prepare(`SELECT w.*, a.name AS challenger_name, b.name AS opponent_name FROM player_guild_wars w
        JOIN player_guilds a ON a.id = w.challenger_id JOIN player_guilds b ON b.id = w.opponent_id
        WHERE w.guild_id = ? AND (w.challenger_id = ? OR w.opponent_id = ?) ORDER BY w.created_at DESC LIMIT 8`).all(GUILD_NETWORK, playerGuildId, playerGuildId);
    },
    createGuildWar(guildId, userId, opponentId, mode) {
      if (mode !== 'fishing') return { ok: false, reason: 'mode' };
      return db.transaction(() => {
        const own = this.getPlayerGuild(GUILD_NETWORK, userId);
        if (!own || own.role !== 'leader') return { ok: false, reason: 'permission' };
        if (own.id === Number(opponentId)) return { ok: false, reason: 'self' };
        const opponent = db.prepare('SELECT * FROM player_guilds WHERE guild_id = ? AND id = ?').get(GUILD_NETWORK, Number(opponentId));
        if (!opponent) return { ok: false, reason: 'missing' };
        const active = db.prepare(`SELECT 1 FROM player_guild_wars WHERE guild_id = ? AND status IN ('pending','active') AND (challenger_id IN (?, ?) OR opponent_id IN (?, ?))`).get(GUILD_NETWORK, own.id, opponent.id, own.id, opponent.id);
        if (active) return { ok: false, reason: 'busy' };
        const now = Date.now();
        const result = db.prepare(`INSERT INTO player_guild_wars (guild_id, challenger_id, opponent_id, mode, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(GUILD_NETWORK, own.id, opponent.id, mode, userId, now);
        db.prepare('INSERT INTO player_guild_war_origins (war_id, origin_guild_id) VALUES (?, ?)').run(result.lastInsertRowid, String(guildId));
        return { ok: true, war: this.getGuildWar(GUILD_NETWORK, result.lastInsertRowid) };
      })();
    },
    respondGuildWar(guildId, userId, warId, accept) {
      return db.transaction(() => {
        const war = this.getGuildWar(GUILD_NETWORK, warId);
        if (!war || war.status !== 'pending') return { ok: false, reason: 'missing' };
        const own = this.getPlayerGuild(GUILD_NETWORK, userId);
        if (!own || own.role !== 'leader' || own.id !== war.opponent_id) return { ok: false, reason: 'permission' };
        if (!accept) { db.prepare("UPDATE player_guild_wars SET status = 'declined' WHERE id = ?").run(warId); return { ok: true, declined: true }; }
        const fish = id => db.prepare(`SELECT COALESCE(SUM(fs.total),0) AS n FROM fishing_stats fs JOIN player_guild_members m ON m.user_id = fs.user_id WHERE m.guild_id = ? AND m.player_guild_id = ?`).get(GUILD_NETWORK, id).n;
        const xp = id => Number(db.prepare('SELECT xp FROM player_guilds WHERE guild_id = ? AND id = ?').get(GUILD_NETWORK, id)?.xp || 0);
        db.prepare(`UPDATE player_guild_wars SET status = 'active', starts_at = ?, ends_at = ?, challenger_fish_start = ?, opponent_fish_start = ?, challenger_xp_start = ?, opponent_xp_start = ? WHERE id = ?`)
          .run(Date.now(), Date.now() + 24*60*60*1000, fish(war.challenger_id), fish(war.opponent_id), xp(war.challenger_id), xp(war.opponent_id), warId);
        return { ok: true, war: this.getGuildWar(GUILD_NETWORK, warId) };
      })();
    },
    resolveGuildWar(guildId, warId) {
      return db.transaction(() => {
        const war = this.getGuildWar(GUILD_NETWORK, warId);
        if (!war) return { ok: false, reason: 'missing' };
        if (war.status === 'completed') return { ok: true, war, already: true };
        if (war.status !== 'active' || Date.now() < war.ends_at) return { ok: false, reason: 'running', war };
        const fish = id => db.prepare(`SELECT COALESCE(SUM(fs.total),0) AS n FROM fishing_stats fs JOIN player_guild_members m ON m.user_id = fs.user_id WHERE m.guild_id = ? AND m.player_guild_id = ?`).get(GUILD_NETWORK, id).n;
        const xp = id => Number(db.prepare('SELECT xp FROM player_guilds WHERE guild_id = ? AND id = ?').get(GUILD_NETWORK, id)?.xp || 0);
        const cf = Math.max(0, fish(war.challenger_id) - war.challenger_fish_start), of = Math.max(0, fish(war.opponent_id) - war.opponent_fish_start);
        const cx = Math.max(0, xp(war.challenger_id) - war.challenger_xp_start), ox = Math.max(0, xp(war.opponent_id) - war.opponent_xp_start);
        const cs = war.mode === 'fishing' ? cf : cf + cx, os = war.mode === 'fishing' ? of : of + ox;
        const winner = cs === os ? null : cs > os ? war.challenger_id : war.opponent_id;
        db.prepare(`UPDATE player_guild_wars SET status = 'completed', challenger_score = ?, opponent_score = ?, winner_id = ?, rewarded_at = ? WHERE id = ?`).run(cs, os, winner, Date.now(), warId);
        // Rewards are applied in the same transaction and only once, when the result is finalized.
        const originGuildId = db.prepare('SELECT origin_guild_id FROM player_guild_war_origins WHERE war_id = ?').get(warId)?.origin_guild_id || guildId;
        // Winning members get 1,000 coins each, everyone else (including ties) gets 250 coins each, paid in this server.
        for (const teamId of [war.challenger_id, war.opponent_id]) {
          const amount = winner === teamId ? 1000 : 250;
          const members = db.prepare('SELECT user_id FROM player_guild_members WHERE guild_id = ? AND player_guild_id = ?').all(GUILD_NETWORK, teamId);
          for (const member of members) this.addCoins(originGuildId, member.user_id, amount, 'guild war reward');
        }
        return { ok: true, war: this.getGuildWar(GUILD_NETWORK, warId), challengerScore: cs, opponentScore: os };
      })();
    },
    getPlayerGuildProgress(guildId, playerGuildId) {
      const g = db.prepare('SELECT id, name, bank_balance, xp, level FROM player_guilds WHERE guild_id = ? AND id = ?').get(GUILD_NETWORK, playerGuildId);
      if (!g) return null;
      const needed = 100;
      const xpIntoLevel = Math.max(0, g.xp - ((g.level - 1) * needed));
      return { ...g, xp_into_level: xpIntoLevel, xp_needed: needed };
    },
    addPlayerGuildXp(guildId, userId, amount = 1) {
      const membership = this.getPlayerGuild(GUILD_NETWORK, userId);
      if (!membership || !Number.isSafeInteger(amount) || amount <= 0) return null;
      db.prepare('UPDATE player_guilds SET xp = xp + ?, level = CAST((xp + ?) / 100 AS INTEGER) + 1 WHERE guild_id = ? AND id = ?')
        .run(amount, amount, GUILD_NETWORK, membership.id);
      return this.getPlayerGuildProgress(GUILD_NETWORK, membership.id);
    },
    playerGuildBank(guildId, userId, action, amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'amount' };
      return db.transaction(() => {
        const membership = this.getPlayerGuild(GUILD_NETWORK, userId);
        if (!membership) return { ok: false, reason: 'member' };
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
        const balance = this.getBalance(guildId, userId).coins;
        const bank = Number(membership.bank_balance || 0);
        if (action === 'deposit') {
          if (balance < amount) return { ok: false, reason: 'funds', balance };
          db.prepare('UPDATE economy_users SET coins = coins - ? WHERE guild_id = ? AND user_id = ?').run(amount, guildId, userId);
          db.prepare('UPDATE player_guilds SET bank_balance = bank_balance + ? WHERE guild_id = ? AND id = ?').run(amount, GUILD_NETWORK, membership.id);
          db.prepare('INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, -amount, 'guild bank deposit');
          return { ok: true, balance: balance - amount, bank: bank + amount };
        }
        if (action === 'withdraw') {
          if (membership.role !== 'leader') return { ok: false, reason: 'permission' };
          if (bank < amount) return { ok: false, reason: 'bank_funds', bank };
          db.prepare('UPDATE player_guilds SET bank_balance = bank_balance - ? WHERE guild_id = ? AND id = ?').run(amount, GUILD_NETWORK, membership.id);
          db.prepare('UPDATE economy_users SET coins = coins + ? WHERE guild_id = ? AND user_id = ?').run(amount, guildId, userId);
          db.prepare('INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, amount, 'guild bank withdrawal');
          return { ok: true, balance: balance + amount, bank: bank - amount };
        }
        return { ok: false, reason: 'action' };
      })();
    },
    transferPlayerGuildBank(guildId, userId, targetUserId, amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'amount' };
      if (userId === targetUserId) return { ok: false, reason: 'target' };
      return db.transaction(() => {
        const membership = this.getPlayerGuild(GUILD_NETWORK, userId);
        if (!membership) return { ok: false, reason: 'member' };
        if (membership.role !== 'leader') return { ok: false, reason: 'permission' };
        const target = this.getPlayerGuild(GUILD_NETWORK, targetUserId);
        if (!target || target.id !== membership.id) return { ok: false, reason: 'target' };
        const bank = Number(membership.bank_balance || 0);
        if (bank < amount) return { ok: false, reason: 'bank_funds', bank };
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)').run(guildId, targetUserId);
        const targetBalance = this.getBalance(guildId, targetUserId).coins;
        if (!Number.isSafeInteger(targetBalance + amount)) return { ok: false, reason: 'amount' };
        db.prepare('UPDATE player_guilds SET bank_balance = bank_balance - ? WHERE guild_id = ? AND id = ?').run(amount, GUILD_NETWORK, membership.id);
        db.prepare('UPDATE economy_users SET coins = coins + ? WHERE guild_id = ? AND user_id = ?').run(amount, guildId, targetUserId);
        db.prepare('INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, -amount, `guild bank transfer to ${targetUserId}`);
        db.prepare('INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)').run(guildId, targetUserId, amount, `guild bank transfer from ${membership.name}`);
        return { ok: true, guild: membership, bank: bank - amount, targetBalance: targetBalance + amount };
      })();
    },
    getPlayerGuild(guildId, userId) {
      return db.prepare(`SELECT g.*, m.role FROM player_guild_members m
        JOIN player_guilds g ON g.id = m.player_guild_id
        WHERE m.guild_id = ? AND m.user_id = ?`).get(GUILD_NETWORK, userId) || null;
    },
    createPlayerGuild(guildId, userId, name, fee = 500) {
      const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
      if (cleanName.length < 3 || cleanName.length > 24 || !/^[\p{L}\p{N} _-]+$/u.test(cleanName)) {
        return { ok: false, reason: 'name' };
      }
      return db.transaction(() => {
        if (this.getPlayerGuild(GUILD_NETWORK, userId)) return { ok: false, reason: 'member' };
        if (db.prepare('SELECT 1 FROM player_guilds WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(GUILD_NETWORK, cleanName)) return { ok: false, reason: 'taken' };
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
        const balance = this.getBalance(guildId, userId).coins;
        if (balance < fee) return { ok: false, reason: 'funds', balance };
        const now = Date.now();
        const result = db.prepare('INSERT INTO player_guilds (guild_id, name, leader_id, created_at) VALUES (?, ?, ?, ?)').run(GUILD_NETWORK, cleanName, userId, now);
        db.prepare("INSERT INTO player_guild_members (guild_id, player_guild_id, user_id, role, joined_at) VALUES (?, ?, ?, 'leader', ?)").run(GUILD_NETWORK, result.lastInsertRowid, userId, now);
        db.prepare('UPDATE economy_users SET coins = coins - ? WHERE guild_id = ? AND user_id = ?').run(fee, guildId, userId);
        db.prepare('INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, -fee, 'guild creation fee');
        return { ok: true, guild: db.prepare('SELECT * FROM player_guilds WHERE id = ?').get(result.lastInsertRowid), balance: balance - fee };
      })();
    },
    listPlayerGuilds(guildId, limit = 10) {
      return db.prepare(`SELECT g.*, COUNT(m.user_id) AS member_count FROM player_guilds g
        LEFT JOIN player_guild_members m ON m.guild_id = g.guild_id AND m.player_guild_id = g.id
        WHERE g.guild_id = ? GROUP BY g.id ORDER BY member_count DESC, g.created_at ASC LIMIT ?`)
        .all(GUILD_NETWORK, Math.max(1, Math.min(10, Math.floor(Number(limit) || 10))));
    },
    getPlayerGuildMembers(guildId, playerGuildId) {
      return db.prepare("SELECT user_id, role, joined_at FROM player_guild_members WHERE guild_id = ? AND player_guild_id = ? ORDER BY CASE role WHEN 'leader' THEN 0 ELSE 1 END, joined_at").all(GUILD_NETWORK, playerGuildId);
    },
    invitePlayerGuild(guildId, playerGuildId, inviterId, inviteeId) {
      return db.transaction(() => {
        const guild = db.prepare('SELECT * FROM player_guilds WHERE guild_id = ? AND id = ?').get(GUILD_NETWORK, playerGuildId);
        if (!guild) return { ok: false, reason: 'missing' };
        const inviter = db.prepare('SELECT role FROM player_guild_members WHERE guild_id = ? AND player_guild_id = ? AND user_id = ?').get(GUILD_NETWORK, playerGuildId, inviterId);
        if (!inviter || inviter.role !== 'leader') return { ok: false, reason: 'permission' };
        if (this.getPlayerGuild(GUILD_NETWORK, inviteeId)) return { ok: false, reason: 'member' };
        const now = Date.now();
        db.prepare('DELETE FROM player_guild_invites WHERE expires_at <= ?').run(now);
        try {
          db.prepare('INSERT INTO player_guild_invites (guild_id, player_guild_id, inviter_id, invitee_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(GUILD_NETWORK, playerGuildId, inviterId, inviteeId, now, now + 24 * 60 * 60 * 1000);
        } catch (e) {
          if (String(e.message).includes('UNIQUE')) return { ok: false, reason: 'pending' };
          throw e;
        }
        return { ok: true, guild };
      })();
    },
    acceptPlayerGuildInvite(guildId, playerGuildId, userId) {
      return db.transaction(() => {
        if (this.getPlayerGuild(GUILD_NETWORK, userId)) return { ok: false, reason: 'member' };
        const now = Date.now();
        const invite = db.prepare('SELECT * FROM player_guild_invites WHERE guild_id = ? AND player_guild_id = ? AND invitee_id = ? AND expires_at > ?').get(GUILD_NETWORK, playerGuildId, userId, now);
        if (!invite) return { ok: false, reason: 'invite' };
        const count = db.prepare('SELECT COUNT(*) AS total FROM player_guild_members WHERE guild_id = ? AND player_guild_id = ?').get(GUILD_NETWORK, playerGuildId).total;
        if (count >= 25) return { ok: false, reason: 'full' };
        db.prepare("INSERT INTO player_guild_members (guild_id, player_guild_id, user_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)").run(GUILD_NETWORK, playerGuildId, userId, now);
        db.prepare('DELETE FROM player_guild_invites WHERE guild_id = ? AND invitee_id = ?').run(GUILD_NETWORK, userId);
        return { ok: true, guild: db.prepare('SELECT * FROM player_guilds WHERE id = ?').get(playerGuildId) };
      })();
    },
    leavePlayerGuild(guildId, userId) {
      return db.transaction(() => {
        const membership = this.getPlayerGuild(GUILD_NETWORK, userId);
        if (!membership) return { ok: false, reason: 'member' };
        if (membership.role === 'leader') return { ok: false, reason: 'leader' };
        db.prepare('DELETE FROM player_guild_members WHERE guild_id = ? AND user_id = ?').run(GUILD_NETWORK, userId);
        db.prepare('DELETE FROM player_guild_invites WHERE guild_id = ? AND invitee_id = ?').run(GUILD_NETWORK, userId);
        return { ok: true, guild: membership };
      })();
    },
    disbandPlayerGuild(guildId, userId) {
      const membership = this.getPlayerGuild(GUILD_NETWORK, userId);
      if (!membership) return { ok: false, reason: 'member' };
      if (membership.role !== 'leader') return { ok: false, reason: 'permission' };
      db.prepare('DELETE FROM player_guilds WHERE guild_id = ? AND id = ?').run(GUILD_NETWORK, membership.id);
      return { ok: true, name: membership.name };
    },
    getPlayerGuildLeaderboard(guildId, limit = 10) {
      return this.listPlayerGuilds(GUILD_NETWORK, limit);
    },
    getSettings(guildId) {
      ensure.run(guildId);
      return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    },
    saveSettings(guildId, patch) {
      ensure.run(guildId);
      const allowed = new Set([
        'welcome_enabled','welcome_channel_id','welcome_message','mod_log_channel_id',
        'bot_log_channel_id','announcement_channel_id','xp_channel_id','xp_channel_ids','personal_channel_id',
        'xp_enabled','xp_cooldown','xp_min','xp_max','levelup_enabled','levelup_message','prefix','spam_enabled','strike_enabled',
        'module_xp','module_economy','module_fishing','module_games','module_welcome','module_invites','autorole_enabled','jail_role_id','vault_alert_enabled','vault_alert_channel_id','vault_alert_role_id','vault_alert_trigger','rank_accent'
      ]);
      const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
      if (!entries.length) return this.getSettings(guildId);
      const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ');
      db.prepare(`UPDATE guild_settings SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = @guild_id`)
        .run({ guild_id: guildId, ...Object.fromEntries(entries) });
      return this.getSettings(guildId);
    },
    getStarboardSettings(guildId) {
      return db.prepare('SELECT guild_id, source_channel_id, destination_channel_id, threshold, enabled FROM starboard_settings WHERE guild_id = ?')
        .get(String(guildId)) || null;
    },
    saveStarboardSettings(guildId, config) {
      db.prepare(`INSERT INTO starboard_settings (guild_id, source_channel_id, destination_channel_id, threshold, enabled)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
          source_channel_id = excluded.source_channel_id,
          destination_channel_id = excluded.destination_channel_id,
          threshold = excluded.threshold,
          enabled = excluded.enabled,
          updated_at = CURRENT_TIMESTAMP`)
        .run(String(guildId), String(config.sourceChannelId), String(config.destinationChannelId), Number(config.threshold), config.enabled ? 1 : 0);
      return this.getStarboardSettings(guildId);
    },
    getStarboardPost(guildId, sourceMessageId) {
      return db.prepare('SELECT guild_id, source_message_id, destination_message_id, star_count FROM starboard_posts WHERE guild_id = ? AND source_message_id = ?')
        .get(String(guildId), String(sourceMessageId)) || null;
    },
    getStarboardPostByDestination(guildId, destinationMessageId) {
      return db.prepare('SELECT guild_id, source_message_id, destination_message_id, star_count FROM starboard_posts WHERE guild_id = ? AND destination_message_id = ?')
        .get(String(guildId), String(destinationMessageId)) || null;
    },
    saveStarboardPost(guildId, sourceMessageId, destinationMessageId, starCount) {
      db.prepare(`INSERT INTO starboard_posts (guild_id, source_message_id, destination_message_id, star_count, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, source_message_id) DO UPDATE SET
          destination_message_id = excluded.destination_message_id,
          star_count = excluded.star_count`)
        .run(String(guildId), String(sourceMessageId), String(destinationMessageId), Number(starCount), Date.now());
      return true;
    },
    updateStarboardPostCount(guildId, sourceMessageId, starCount) {
      return db.prepare('UPDATE starboard_posts SET star_count = ? WHERE guild_id = ? AND source_message_id = ?')
        .run(Number(starCount), String(guildId), String(sourceMessageId)).changes > 0;
    },
    getInviteTrackerSettings(guildId) {
      return db.prepare(
        'SELECT guild_id, channel_id, enabled FROM invite_tracker_settings WHERE guild_id = ?'
      ).get(guildId) || null;
    },
    saveInviteTrackerSettings(guildId, channelId, enabled) {
      db.prepare(`
        INSERT INTO invite_tracker_settings (guild_id, channel_id, enabled)
        VALUES (?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
          channel_id = excluded.channel_id,
          enabled = excluded.enabled,
          updated_at = CURRENT_TIMESTAMP
      `).run(guildId, channelId, enabled ? 1 : 0);
      return this.getInviteTrackerSettings(guildId);
    },
    recordTrackedInvite(guildId, memberId, inviterId, joinedAt) {
      db.prepare(
        'INSERT INTO invite_tracker_joins (guild_id, member_id, inviter_id, joined_at) VALUES (?, ?, ?, ?)'
      ).run(guildId, memberId, inviterId || null, joinedAt);
      if (!inviterId) return null;
      return db.prepare(
        'SELECT COUNT(*) AS total FROM invite_tracker_joins WHERE guild_id = ? AND inviter_id = ?'
      ).get(guildId, inviterId).total;
    },
    addModLog(log) {
      db.prepare(`INSERT INTO moderation_logs (guild_id, moderator_id, target_id, action, reason)
        VALUES (@guild_id, @moderator_id, @target_id, @action, @reason)`).run(log);
    },
    getLogs(guildId, limit = 50) {
      return db.prepare('SELECT * FROM moderation_logs WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit);
    },
    recordSpamStrike(guildId, userId, now) {
      const existing = db.prepare(
        'SELECT strikes, last_strike_at FROM spam_strikes WHERE guild_id = ? AND user_id = ?'
      ).get(guildId, userId);

      const strikes = !existing || now - existing.last_strike_at >= 24 * 60 * 60 * 1000
        ? 1
        : existing.strikes + 1;

      db.prepare(`
        INSERT INTO spam_strikes (guild_id, user_id, strikes, last_strike_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          strikes = excluded.strikes,
          last_strike_at = excluded.last_strike_at
      `).run(guildId, userId, strikes, now);

      return { strikes };
    },
    addXp(guildId, userId, amount, now) {
      db.prepare('INSERT INTO xp_weekly (guild_id, user_id, week, xp) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id, week) DO UPDATE SET xp = xp_weekly.xp + excluded.xp').run(guildId, userId, weekKeyFor(now), amount);
      const existing = db.prepare('SELECT * FROM xp_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
      if (!existing) {
        db.prepare('INSERT INTO xp_users (guild_id,user_id,xp,level,last_message_at) VALUES (?,?,?,?,?)')
          .run(guildId, userId, amount, Math.floor(Math.sqrt(amount / 100)), now);
        return { xp: amount, level: Math.floor(Math.sqrt(amount / 100)), previousLevel: 0 };
      }
      const nextXp = existing.xp + amount;
      const nextLevel = Math.floor(Math.sqrt(nextXp / 100));
      db.prepare('UPDATE xp_users SET xp=?, level=?, last_message_at=? WHERE guild_id=? AND user_id=?')
        .run(nextXp, nextLevel, now, guildId, userId);
      return { xp: nextXp, level: nextLevel, previousLevel: existing.level };
    },
    getXp(guildId, userId) {
      return db.prepare('SELECT * FROM xp_users WHERE guild_id=? AND user_id=?').get(guildId, userId) || { xp: 0, level: 0 };
    },
    getLeaderboard(guildId, limit = 10) {
      return db.prepare('SELECT user_id, xp, level FROM xp_users WHERE guild_id=? ORDER BY xp DESC LIMIT ?').all(guildId, limit);
    },
    getOwnerGiftBalance(guildId, ownerId) {
      db.prepare(
        'INSERT OR IGNORE INTO owner_gift_wallets (guild_id, owner_id, coins) VALUES (?, ?, 99999)'
      ).run(guildId, ownerId);

      return db.prepare(
        'SELECT coins FROM owner_gift_wallets WHERE guild_id = ? AND owner_id = ?'
      ).get(guildId, ownerId).coins;
    },

    giveOwnerGiftCoins(guildId, ownerId, recipientId, amount) {
      if (ownerId === recipientId) return { ok: false, reason: 'self' };
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return { ok: false, reason: 'amount' };
      }

      return db.transaction(() => {
        db.prepare(
          'INSERT OR IGNORE INTO owner_gift_wallets (guild_id, owner_id, coins) VALUES (?, ?, 99999)'
        ).run(guildId, ownerId);

        const wallet = db.prepare(
          'SELECT coins FROM owner_gift_wallets WHERE guild_id = ? AND owner_id = ?'
        ).get(guildId, ownerId);

        if (wallet.coins < amount) {
          return { ok: false, reason: 'funds', balance: wallet.coins };
        }

        db.prepare(
          'INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)'
        ).run(guildId, recipientId);

        const recipient = this.getBalance(guildId, recipientId);
        if (!Number.isSafeInteger(recipient.coins + amount)) {
          return { ok: false, reason: 'limit' };
        }

        db.prepare(
          'UPDATE owner_gift_wallets SET coins = coins - ? WHERE guild_id = ? AND owner_id = ?'
        ).run(amount, guildId, ownerId);

        db.prepare(
          'UPDATE economy_users SET coins = coins + ? WHERE guild_id = ? AND user_id = ?'
        ).run(amount, guildId, recipientId);

        db.prepare(
          'INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)'
        ).run(guildId, recipientId, amount, `gift from server owner ${ownerId}`);

        return { ok: true, balance: recipient.coins + amount, wallet: wallet.coins - amount };
      })();
    },

    giveDeveloperCoins(guildId, recipientId, amount, developerId) {
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return { ok: false, reason: 'amount' };
      }

      return db.transaction(() => {
        db.prepare(
          'INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)'
        ).run(guildId, recipientId);

        const recipient = this.getBalance(guildId, recipientId);
        if (!Number.isSafeInteger(recipient.coins + amount)) {
          return { ok: false, reason: 'limit' };
        }

        db.prepare(
          'UPDATE economy_users SET coins = coins + ? WHERE guild_id = ? AND user_id = ?'
        ).run(amount, guildId, recipientId);

        db.prepare(
          'INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)'
        ).run(guildId, recipientId, amount, `developer gift from ${developerId}`);

        return { ok: true, balance: recipient.coins + amount };
      })();
    },

    getBalance(guildId, userId) {
      return db.prepare(
        'SELECT coins, last_daily_at FROM economy_users WHERE guild_id = ? AND user_id = ?'
      ).get(guildId, userId) || { coins: 0, last_daily_at: 0 };
    },
    getBank(guildId, userId) {
      db.prepare('INSERT OR IGNORE INTO economy_bank (guild_id,user_id) VALUES (?,?)').run(guildId,userId);
      return db.prepare('SELECT balance,last_interest_at FROM economy_bank WHERE guild_id=? AND user_id=?').get(guildId,userId);
    },
    bankMove(guildId, userId, action, amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0) return {ok:false,reason:'amount'};
      return db.transaction(() => {
        const wallet=this.getBalance(guildId,userId), bank=this.getBank(guildId,userId);
        if(action==='deposit') {
          if(wallet.coins<amount) return {ok:false,reason:'funds',wallet:wallet.coins,bank:bank.balance};
          db.prepare('UPDATE economy_users SET coins=coins-? WHERE guild_id=? AND user_id=?').run(amount,guildId,userId);
          db.prepare('UPDATE economy_bank SET balance=balance+? WHERE guild_id=? AND user_id=?').run(amount,guildId,userId);
          db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,userId,-amount,'bank deposit');
        } else {
          if(bank.balance<amount) return {ok:false,reason:'bank_funds',wallet:wallet.coins,bank:bank.balance};
          db.prepare('UPDATE economy_bank SET balance=balance-? WHERE guild_id=? AND user_id=?').run(amount,guildId,userId);
          db.prepare('UPDATE economy_users SET coins=coins+? WHERE guild_id=? AND user_id=?').run(amount,guildId,userId);
          db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,userId,amount,'bank withdrawal');
        }
        return {ok:true,wallet: this.getBalance(guildId,userId).coins,bank:this.getBank(guildId,userId).balance};
      })();
    },
    getCollectibleBonuses(guildId, userId) {
      const rows = this.getCollectibles(guildId, userId);
      const owned = new Map(rows.map(row => [row.collectible_id, Number(row.quantity) || 0]));
      return {
        rewardPercent: Math.min(20, (owned.get('common_crystal') || 0) * 2 + (owned.get('rare_phoenix') || 0) * 3 + (owned.get('epic_dragon') || 0) * 4 + (owned.get('legendary_crown') || 0) * 5),
        bankInterestPercent: Math.min(20, (owned.get('common_crystal') || 0) * 1 + (owned.get('rare_phoenix') || 0) * 2 + (owned.get('epic_dragon') || 0) * 5 + (owned.get('legendary_crown') || 0) * 10)
      };
    },
    claimBankInterest(guildId,userId,now=Date.now()) {
      return db.transaction(() => {
        const bank=this.getBank(guildId,userId), day=24*60*60*1000;
        if(bank.balance<1) return {ok:false,reason:'empty',bank:bank.balance};
        if(bank.last_interest_at && now-bank.last_interest_at<day) return {ok:false,reason:'cooldown',next:bank.last_interest_at+day,bank:bank.balance};
        const bonuses = this.getCollectibleBonuses(guildId, userId);
        const rate = 0.02 + bonuses.bankInterestPercent / 100;
        const interest=Math.max(1,Math.floor(bank.balance*rate));
        db.prepare('UPDATE economy_bank SET balance=balance+?,last_interest_at=? WHERE guild_id=? AND user_id=?').run(interest,now,guildId,userId);
        db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,userId,interest,`bank interest (${(rate*100).toFixed(0)}% incl. collectible bonus)`);
        return {ok:true,interest,bank:bank.balance+interest,rate:rate*100,bonus:bonuses.bankInterestPercent};
      })();
    },
    getCollectibles(guildId,userId) {
      return db.prepare('SELECT collectible_id,quantity FROM economy_collectibles WHERE guild_id=? AND user_id=? AND quantity>0 ORDER BY collectible_id').all(guildId,userId);
    },
    buyCollectible(guildId,userId,id,price) {
      return db.transaction(() => {
        const wallet=this.getBalance(guildId,userId);
        if(wallet.coins<price) return {ok:false,reason:'funds',balance:wallet.coins};
        db.prepare('UPDATE economy_users SET coins=coins-? WHERE guild_id=? AND user_id=?').run(price,guildId,userId);
        db.prepare('INSERT INTO economy_collectibles (guild_id,user_id,collectible_id,quantity) VALUES (?,?,?,1) ON CONFLICT(guild_id,user_id,collectible_id) DO UPDATE SET quantity=quantity+1').run(guildId,userId,id);
        db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,userId,-price,`collectible purchase: ${id}`);
        return {ok:true,balance:wallet.coins-price};
      })();
    },
    getStatsChannels(guildId) {
      return db.prepare('SELECT channel_id, template FROM stats_channels WHERE guild_id = ?').all(guildId);
    },
    statsGuildIds() {
      return db.prepare('SELECT DISTINCT guild_id FROM stats_channels').all().map(row => row.guild_id);
    },
    saveStatsChannels(guildId, items) {
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM stats_channels WHERE guild_id = ?').run(guildId);
        const insert = db.prepare('INSERT INTO stats_channels (guild_id, channel_id, template) VALUES (?, ?, ?)');
        for (const item of items) insert.run(guildId, item.channelId, item.template);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return true;
    },
    getOnboardingConfig(guildId) {
      const row = db.prepare('SELECT * FROM onboarding_config WHERE guild_id = ?').get(guildId);
      if (!row) return { enabled: false, channelId: '', steps: [], roles: [] };
      return {
        enabled: Number(row.enabled) === 1,
        channelId: row.channel_id || '',
        steps: JSON.parse(row.steps || '[]'),
        roles: JSON.parse(row.roles || '[]')
      };
    },
    saveOnboardingConfig(guildId, cfg) {
      db.prepare(`INSERT INTO onboarding_config (guild_id, enabled, channel_id, steps, roles) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
          enabled = excluded.enabled,
          channel_id = excluded.channel_id,
          steps = excluded.steps,
          roles = excluded.roles`).run(
        guildId, cfg.enabled ? 1 : 0, cfg.channelId || null, JSON.stringify(cfg.steps), JSON.stringify(cfg.roles)
      );
      return true;
    },
    listGlobalGuilds() {
      return db.prepare(`SELECT g.id, g.name, g.level, g.xp, g.created_at,
          (SELECT COUNT(*) FROM player_guild_members m WHERE m.player_guild_id = g.id) AS member_count,
          (SELECT COUNT(*) FROM player_guild_wars w WHERE w.guild_id = '${GUILD_NETWORK}' AND w.winner_id = g.id) AS wins
        FROM player_guilds g WHERE g.guild_id = '${GUILD_NETWORK}'
        ORDER BY g.level DESC, g.xp DESC LIMIT 100`).all();
    },
    listGlobalWars(limit) {
      return db.prepare(`SELECT w.id, w.status, w.challenger_id, w.opponent_id, w.challenger_score, w.opponent_score,
          w.winner_id, w.created_at, c.name AS challenger_name, o.name AS opponent_name
        FROM player_guild_wars w
        JOIN player_guilds c ON c.id = w.challenger_id
        JOIN player_guilds o ON o.id = w.opponent_id
        WHERE w.guild_id = '${GUILD_NETWORK}'
        ORDER BY w.created_at DESC LIMIT ?`).all(limit);
    },
    getPoll(guildId, pollId) {
      return db.prepare('SELECT * FROM polls WHERE guild_id = ? AND id = ?').get(String(guildId), Number(pollId)) || null;
    },
    createPoll(guildId, item) {
      return db.prepare(`INSERT INTO polls
        (guild_id, channel_id, question, options, created_by, created_at, ends_at, anonymous, multiple, allow_change, required_role_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        String(guildId), String(item.channelId), item.question, JSON.stringify(item.options),
        String(item.createdBy), item.createdAt, item.endsAt, item.anonymous ? 1 : 0,
        item.multiple ? 1 : 0, item.allowChange ? 1 : 0, item.requiredRoleId ? String(item.requiredRoleId) : null
      ).lastInsertRowid;
    },
    setPollMessage(pollId, messageId) {
      db.prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(String(messageId), Number(pollId));
      return true;
    },
    getPollVotes(pollId) {
      return db.prepare('SELECT user_id, options, voted_at FROM poll_votes WHERE poll_id = ?').all(Number(pollId))
        .map(row => ({ userId: row.user_id, options: JSON.parse(row.options || '[]'), votedAt: row.voted_at }));
    },
    getPollVote(pollId, userId) {
      const row = db.prepare('SELECT user_id, options, voted_at FROM poll_votes WHERE poll_id = ? AND user_id = ?')
        .get(Number(pollId), String(userId));
      return row ? { userId: row.user_id, options: JSON.parse(row.options || '[]'), votedAt: row.voted_at } : null;
    },
    savePollVote(pollId, userId, options, votedAt) {
      db.prepare(`INSERT INTO poll_votes (poll_id, user_id, options, voted_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(poll_id, user_id) DO UPDATE SET options = excluded.options, voted_at = excluded.voted_at`)
        .run(Number(pollId), String(userId), JSON.stringify(options), Number(votedAt));
      return true;
    },
    closePoll(guildId, pollId, closedAt = Date.now()) {
      return db.prepare("UPDATE polls SET status = 'closed', closed_at = ? WHERE guild_id = ? AND id = ? AND status = 'active'")
        .run(Number(closedAt), String(guildId), Number(pollId)).changes > 0;
    },
    getDuePolls(now = Date.now()) {
      return db.prepare("SELECT * FROM polls WHERE status = 'active' AND ends_at <= ?").all(Number(now));
    },
    listActivePolls(guildId) {
      return db.prepare("SELECT id, channel_id, question, ends_at, created_by FROM polls WHERE guild_id = ? AND status = 'active' ORDER BY ends_at ASC LIMIT 20")
        .all(String(guildId));
    },
    getActiveTrivia(guildId) {
      return db.prepare("SELECT * FROM trivia_games WHERE guild_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(guildId) || null;
    },
    startTrivia(guildId, channelId, question, answer, reward, startedBy, endsAt) {
      db.prepare("UPDATE trivia_games SET status = 'cancelled' WHERE guild_id = ? AND status = 'active'").run(guildId);
      return db.prepare('INSERT INTO trivia_games (guild_id, channel_id, question, answer, reward, started_by, started_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(guildId, channelId, question, answer, reward, startedBy, Date.now(), endsAt).lastInsertRowid;
    },
    endTrivia(id, status) {
      db.prepare("UPDATE trivia_games SET status = ? WHERE id = ? AND status = 'active'").run(status, id);
    },
    winTrivia(id, userId) {
      return db.prepare("UPDATE trivia_games SET status = 'won', winner_id = ? WHERE id = ? AND status = 'active'").run(userId, id).changes > 0;
    },
    addCoins(guildId, userId, amount, reason = 'reward') {
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new TypeError('amount must be a positive safe integer');
      }

      const add = db.transaction(() => {
        db.prepare(
          'INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)'
        ).run(guildId, userId);

        const current = this.getBalance(guildId, userId);
        if (!Number.isSafeInteger(current.coins + amount)) {
          throw new RangeError('Coin balance would exceed the safe integer limit');
        }

        db.prepare(
          'UPDATE economy_users SET coins = coins + ? WHERE guild_id = ? AND user_id = ?'
        ).run(amount, guildId, userId);

        db.prepare(
          'INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)'
        ).run(guildId, userId, amount, reason);

        return this.getBalance(guildId, userId);
      });

      return add();
    },
    claimDaily(guildId, userId, now = Date.now(), reward = 100) {
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new TypeError('now must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(reward) || reward <= 0) {
        throw new TypeError('reward must be a positive safe integer');
      }
      const bonus = this.getCollectibleBonuses(guildId, userId).rewardPercent;
      reward = Math.floor(reward * (1 + bonus / 100));

      const claim = db.transaction(() => {
        db.prepare(
          'INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)'
        ).run(guildId, userId);

        const current = this.getBalance(guildId, userId);
        const cooldown = 24 * 60 * 60 * 1000;
        const nextClaimAt = current.last_daily_at + cooldown;

        if (current.last_daily_at > 0 && now < nextClaimAt) {
          return {
            claimed: false,
            balance: current.coins,
            nextClaimAt
          };
        }

        if (!Number.isSafeInteger(current.coins + reward)) {
          throw new RangeError('Coin balance would exceed the safe integer limit');
        }

        db.prepare(
          'UPDATE economy_users SET coins = coins + ?, last_daily_at = ? WHERE guild_id = ? AND user_id = ?'
        ).run(reward, now, guildId, userId);

        db.prepare(
          'INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)'
        ).run(guildId, userId, reward, 'daily reward');

        return {
          claimed: true,
          reward,
          balance: current.coins + reward,
          nextClaimAt: now + cooldown
        };
      });

      return claim();
    },

    claimWork(guildId, userId, now = Date.now()) {
      return this._claimTimedReward(guildId, userId, now, 60 * 60 * 1000, 25, 75, 'work');
    },
    claimWeekly(guildId, userId, now = Date.now()) {
      return this._claimTimedReward(guildId, userId, now, 7 * 24 * 60 * 60 * 1000, 500, 1000, 'weekly');
    },
    _claimTimedReward(guildId, userId, now, cooldown, minReward, maxReward, kind) {
      if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid timestamp');
      const column = kind === 'work' ? 'last_work_at' : 'last_weekly_at';
      const baseReward = minReward + Math.floor(Math.random() * (maxReward - minReward + 1));
      const bonus = this.getCollectibleBonuses(guildId, userId).rewardPercent;
      const reward = Math.floor(baseReward * (1 + bonus / 100));
      return db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id,user_id) VALUES (?,?)').run(guildId,userId);
        const row = db.prepare(`SELECT coins, ${column} AS last_at FROM economy_users WHERE guild_id=? AND user_id=?`).get(guildId,userId);
        const nextClaimAt = row.last_at + cooldown;
        if (row.last_at > 0 && now < nextClaimAt) {
          return { claimed: false, balance: row.coins, nextClaimAt };
        }
        if (!Number.isSafeInteger(row.coins + reward)) throw new RangeError('Balance limit exceeded');
        db.prepare(`UPDATE economy_users SET coins=coins+?, ${column}=? WHERE guild_id=? AND user_id=?`).run(reward,now,guildId,userId);
        db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,userId,reward,`${kind} reward`);
        return { claimed: true, reward, balance: row.coins + reward, nextClaimAt: now + cooldown };
      })();
    },
    transferCoins(guildId, fromUserId, toUserId, amount) {
      if (fromUserId === toUserId) return { ok: false, reason: 'self' };
      if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'amount' };
      return db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id,user_id) VALUES (?,?)').run(guildId,fromUserId);
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id,user_id) VALUES (?,?)').run(guildId,toUserId);
        const from = this.getBalance(guildId,fromUserId);
        const to = this.getBalance(guildId,toUserId);
        if (from.coins < amount) return { ok: false, reason: 'funds', balance: from.coins };
        if (!Number.isSafeInteger(to.coins + amount)) return { ok: false, reason: 'limit' };
        db.prepare('UPDATE economy_users SET coins=coins-? WHERE guild_id=? AND user_id=?').run(amount,guildId,fromUserId);
        db.prepare('UPDATE economy_users SET coins=coins+? WHERE guild_id=? AND user_id=?').run(amount,guildId,toUserId);
        db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,fromUserId,-amount,`payment to ${toUserId}`);
        db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,toUserId,amount,`payment from ${fromUserId}`);
        return { ok: true, balance: from.coins - amount };
      })();
    },
    getRichest(guildId, limit = 10) {
      return db.prepare('SELECT user_id, coins FROM economy_users WHERE guild_id=? ORDER BY coins DESC LIMIT ?').all(guildId, Math.max(1,Math.min(50,Math.floor(Number(limit)||10))));
    },
    getInventory(guildId, userId) {
      return db.prepare('SELECT item_id, quantity FROM economy_inventory WHERE guild_id=? AND user_id=? AND quantity>0 ORDER BY item_id').all(guildId,userId);
    },
    buyItem(guildId, userId, itemId, price) {
      if (!Number.isSafeInteger(price) || price <= 0) return { ok: false, reason: 'item' };
      return db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id,user_id) VALUES (?,?)').run(guildId,userId);
        const balance = this.getBalance(guildId,userId);
        if (balance.coins < price) return { ok: false, reason: 'funds', balance: balance.coins };
        db.prepare('UPDATE economy_users SET coins=coins-? WHERE guild_id=? AND user_id=?').run(price,guildId,userId);
        db.prepare('INSERT INTO economy_inventory (guild_id,user_id,item_id,quantity) VALUES (?,?,?,1) ON CONFLICT(guild_id,user_id,item_id) DO UPDATE SET quantity=quantity+1').run(guildId,userId,itemId);
        db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,userId,-price,`shop purchase: ${itemId}`);
        return { ok: true, balance: balance.coins - price };
      })();
    },
    sellItem(guildId, userId, itemId, resalePrice) {
      if (!Number.isSafeInteger(resalePrice) || resalePrice <= 0) return { ok: false, reason: 'item' };
      return db.transaction(() => {
        const item = db.prepare('SELECT quantity FROM economy_inventory WHERE guild_id=? AND user_id=? AND item_id=?').get(guildId,userId,itemId);
        if (!item || item.quantity < 1) return { ok: false, reason: 'missing' };
        const balance = this.getBalance(guildId,userId);
        if (!Number.isSafeInteger(balance.coins + resalePrice)) return { ok: false, reason: 'limit' };
        db.prepare('UPDATE economy_inventory SET quantity=quantity-1 WHERE guild_id=? AND user_id=? AND item_id=?').run(guildId,userId,itemId);
        db.prepare('UPDATE economy_users SET coins=coins+? WHERE guild_id=? AND user_id=?').run(resalePrice,guildId,userId);
        db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,userId,resalePrice,`shop sale: ${itemId}`);
        return { ok: true, balance: balance.coins + resalePrice };
      })();
    },
    wager(guildId, userId, amount, reason, payout) {
      if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(payout) || payout < 0) return { ok: false, reason: 'amount' };
      return db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id,user_id) VALUES (?,?)').run(guildId,userId);
        const balance = this.getBalance(guildId,userId);
        if (balance.coins < amount) return { ok: false, reason: 'funds', balance: balance.coins };
        if (!Number.isSafeInteger(balance.coins - amount + payout)) return { ok: false, reason: 'limit' };
        db.prepare('UPDATE economy_users SET coins=coins-?+? WHERE guild_id=? AND user_id=?').run(amount,payout,guildId,userId);
        db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,userId,-amount,`${reason} wager`);
        if (payout > 0) db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)').run(guildId,userId,payout,`${reason} payout`);
        return { ok: true, balance: balance.coins - amount + payout };
      })();
    },
    unlockAchievement(guildId, userId, achievementId) {
      const result = db.prepare('INSERT OR IGNORE INTO economy_achievements (guild_id,user_id,achievement_id) VALUES (?,?,?)').run(guildId,userId,achievementId);
      return result.changes > 0;
    },
    getAchievements(guildId, userId) {
      return db.prepare('SELECT achievement_id, unlocked_at FROM economy_achievements WHERE guild_id=? AND user_id=? ORDER BY unlocked_at').all(guildId,userId);
    },
    getAchievementStats(guildId, userId) {
      const xp = db.prepare('SELECT xp FROM xp_users WHERE guild_id=? AND user_id=?').get(guildId,userId);
      const earnings = db.prepare('SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS total FROM economy_transactions WHERE guild_id=? AND user_id=?').get(guildId,userId);
      const fishing = db.prepare('SELECT total, shark, legendary FROM fishing_stats WHERE guild_id=? AND user_id=?').get(guildId,userId) || { total: 0, shark: 0, legendary: 0 };
      const quests = db.prepare('SELECT COUNT(*) AS total FROM fishing_quest_claims WHERE guild_id=? AND user_id=?').get(guildId,userId);
      const collectibles = db.prepare('SELECT COUNT(*) AS total FROM economy_collectibles WHERE guild_id=? AND user_id=? AND quantity>0').get(guildId,userId);
      return {
        xp: xp?.xp || 0,
        totalEarned: earnings.total || 0,
        fishCaught: fishing.total || 0,
        sharks: fishing.shark || 0,
        legendaryFish: fishing.legendary || 0,
        fishingQuests: quests.total || 0,
        uniqueCollectibles: collectibles.total || 0
      };
    },

    catchFish(guildId, userId, fish) {
      if (!fish || typeof fish.name !== 'string' || typeof fish.emoji !== 'string' ||
          !Number.isSafeInteger(fish.value) || fish.value <= 0) {
        throw new TypeError('Invalid fish data');
      }
      db.prepare('INSERT INTO fishing_inventory (guild_id,user_id,fish_name,emoji,value) VALUES (?,?,?,?,?)')
        .run(guildId, userId, fish.name, fish.emoji, fish.value);
      return true;
    },
    getFishingInventory(guildId, userId) {
      return db.prepare('SELECT id, fish_name, emoji, value, caught_at FROM fishing_inventory WHERE guild_id=? AND user_id=? ORDER BY id')
        .all(guildId, userId);
    },
    sellAllFish(guildId, userId) {
      return db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id,user_id) VALUES (?,?)').run(guildId, userId);
        const fish = this.getFishingInventory(guildId, userId);
        const balance = this.getBalance(guildId, userId).coins;
        if (fish.length === 0) return { ok: false, reason: 'empty', count: 0, total: 0, balance };
        const total = fish.reduce((sum, item) => sum + item.value, 0);
        if (!Number.isSafeInteger(total) || !Number.isSafeInteger(balance + total)) {
          return { ok: false, reason: 'limit', count: fish.length, total, balance };
        }
        db.prepare('UPDATE economy_users SET coins=coins+? WHERE guild_id=? AND user_id=?').run(total, guildId, userId);
        db.prepare('INSERT INTO economy_transactions (guild_id,user_id,amount,reason) VALUES (?,?,?,?)')
          .run(guildId, userId, total, 'fishing sale (' + fish.length + ' fish)');
        db.prepare('DELETE FROM fishing_inventory WHERE guild_id=? AND user_id=?').run(guildId, userId);
        return { ok: true, count: fish.length, total, balance: balance + total };
      })();
    },
    getTransactions(guildId, userId, limit = 10) {
      const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
      return db.prepare(
        'SELECT id, amount, reason, created_at FROM economy_transactions WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?'
      ).all(guildId, userId, safeLimit);
    },
    getLevelRewards(guildId) {
      return db.prepare(
        'SELECT level, role_id FROM level_rewards WHERE guild_id = ? ORDER BY level ASC'
      ).all(guildId);
    },
    replaceLevelRewards(guildId, rewards) {
      return db.transaction(() => {
        db.prepare('DELETE FROM level_rewards WHERE guild_id = ?').run(guildId);
        const insert = db.prepare(
          'INSERT INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?)'
        );
        for (const reward of rewards) {
          insert.run(guildId, reward.level, reward.roleId);
        }
        return true;
      })();
    },
    getRewardRoleIdsUpTo(guildId, level) {
      return db.prepare(
        'SELECT role_id FROM level_rewards WHERE guild_id = ? AND level <= ? ORDER BY level ASC'
      ).all(guildId, level).map(row => row.role_id);
    },
    setLevelReward(guildId, level, roleId) {
      db.prepare(`INSERT INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id`).run(guildId, level, roleId);
      return true;
    },
    deleteLevelReward(guildId, level) {
      return db.prepare('DELETE FROM level_rewards WHERE guild_id = ? AND level = ?').run(guildId, level).changes > 0;
    },
    getAutoRoles(guildId) {
      return db.prepare('SELECT role_id FROM auto_roles WHERE guild_id = ?').all(guildId).map(row => row.role_id);
    },
    replaceAutoRoles(guildId, roleIds) {
      return db.transaction(() => {
        db.prepare('DELETE FROM auto_roles WHERE guild_id = ?').run(guildId);
        const insert = db.prepare('INSERT INTO auto_roles (guild_id, role_id) VALUES (?, ?)');
        for (const roleId of roleIds) {
          insert.run(guildId, roleId);
        }
        return true;
      })();
    },
    getReactionRoles(guildId) {
      return db.prepare('SELECT channel_id, message_id, emoji, role_id FROM reaction_roles WHERE guild_id = ? ORDER BY message_id, emoji').all(guildId);
    },
    getReactionRole(messageId, emoji) {
      return db.prepare('SELECT role_id FROM reaction_roles WHERE message_id = ? AND emoji = ?').get(messageId, emoji) || null;
    },
    upsertReactionRole(guildId, channelId, messageId, emoji, roleId) {
      db.prepare(`INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(message_id, emoji) DO UPDATE SET role_id = excluded.role_id, channel_id = excluded.channel_id, guild_id = excluded.guild_id`)
        .run(guildId, channelId, messageId, emoji, roleId);
      return true;
    },
    deleteReactionRole(guildId, messageId, emoji) {
      return db.prepare('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?').run(guildId, messageId, emoji).changes > 0;
    },
    getBotSetting(key) {
      const row = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);
      return row ? row.value : null;
    },
    setBotSetting(key, value) {
      db.prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
      return true;
    },
    getTicketSupportRoles(guildId) {
      return db.prepare('SELECT role_id FROM ticket_support_roles WHERE guild_id = ?').all(guildId).map(row => row.role_id);
    },
    replaceTicketSupportRoles(guildId, roleIds) {
      return db.transaction(() => {
        db.prepare('DELETE FROM ticket_support_roles WHERE guild_id = ?').run(guildId);
        const insert = db.prepare('INSERT INTO ticket_support_roles (guild_id, role_id) VALUES (?, ?)');
        for (const roleId of roleIds) insert.run(guildId, roleId);
        return true;
      })();
    },
    getOpenTicketByUser(guildId, userId) {
      return db.prepare('SELECT channel_id FROM tickets WHERE guild_id = ? AND user_id = ?').get(guildId, userId) || null;
    },
    getTicketByChannel(channelId) {
      return db.prepare('SELECT channel_id, guild_id, user_id, type_id, claimed_by FROM tickets WHERE channel_id = ?').get(channelId) || null;
    },
    addTicket(guildId, channelId, userId, typeId) {
      db.prepare('INSERT INTO tickets (channel_id, guild_id, user_id, created_at, type_id) VALUES (?, ?, ?, ?, ?)').run(channelId, guildId, userId, Date.now(), typeId);
      return true;
    },
    removeTicket(channelId) {
      return db.prepare('DELETE FROM tickets WHERE channel_id = ?').run(channelId).changes > 0;
    },
    getTicketConfig(guildId) {
      return db.prepare('SELECT category_id, log_channel_id FROM ticket_config WHERE guild_id = ?').get(guildId) || { category_id: null, log_channel_id: null };
    },
    setTicketConfig(guildId, categoryId, logChannelId) {
      db.prepare(`INSERT INTO ticket_config (guild_id, category_id, log_channel_id) VALUES (?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET category_id = excluded.category_id, log_channel_id = excluded.log_channel_id`).run(guildId, categoryId, logChannelId);
      return true;
    },
    listTicketTypes(guildId) {
      return db.prepare('SELECT id, name, button_label, color, support_role_ids FROM ticket_types WHERE guild_id = ? ORDER BY id ASC').all(guildId)
        .map(row => ({ ...row, support_role_ids: JSON.parse(row.support_role_ids || '[]') }));
    },
    getTicketType(guildId, typeId) {
      const row = db.prepare('SELECT id, name, button_label, color, support_role_ids FROM ticket_types WHERE guild_id = ? AND id = ?').get(guildId, typeId);
      return row ? { ...row, support_role_ids: JSON.parse(row.support_role_ids || '[]') } : null;
    },
    countTicketTypes(guildId) {
      return db.prepare('SELECT COUNT(*) AS total FROM ticket_types WHERE guild_id = ?').get(guildId).total;
    },
    addTicketType(guildId, name, buttonLabel, color, roleIds) {
      const result = db.prepare('INSERT INTO ticket_types (guild_id, name, button_label, color, support_role_ids) VALUES (?, ?, ?, ?, ?)')
        .run(guildId, name, buttonLabel, color, JSON.stringify(roleIds));
      return Number(result.lastInsertRowid);
    },
    deleteTicketType(guildId, typeId) {
      return db.prepare('DELETE FROM ticket_types WHERE guild_id = ? AND id = ?').run(guildId, typeId).changes > 0;
    },
    claimTicket(channelId, userId) {
      return db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ? AND claimed_by IS NULL').run(userId, channelId).changes > 0;
    },
    listCustomCommands(guildId) {
      return db.prepare('SELECT id, name, kind, content, title, color, image_url FROM custom_commands WHERE guild_id = ? ORDER BY name ASC').all(guildId);
    },
    getCustomCommand(guildId, name) {
      return db.prepare('SELECT id, name, kind, content, title, color, image_url FROM custom_commands WHERE guild_id = ? AND name = ?').get(guildId, name) || null;
    },
    countCustomCommands(guildId) {
      return db.prepare('SELECT COUNT(*) AS total FROM custom_commands WHERE guild_id = ?').get(guildId).total;
    },
    addCustomCommand(guildId, name, kind, content, title, color, imageUrl) {
      const result = db.prepare('INSERT INTO custom_commands (guild_id, name, kind, content, title, color, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(guildId, name, kind, content, title, color, imageUrl);
      return Number(result.lastInsertRowid);
    },
    deleteCustomCommand(guildId, commandId) {
      return db.prepare('DELETE FROM custom_commands WHERE guild_id = ? AND id = ?').run(guildId, commandId).changes > 0;
    },
    getLeaderboardPage(guildId, type, offset, limit) {
      const source = leaderboardSource(type);
      return db.prepare(`SELECT ${source.select} FROM ${source.table} WHERE ${source.where} AND ${source.column} > 0 ORDER BY ${source.column} DESC LIMIT ? OFFSET ?`)
        .all(...source.params(guildId), limit, offset);
    },
    getLeaderboardTotal(guildId, type) {
      const source = leaderboardSource(type);
      return db.prepare(`SELECT COUNT(*) AS total FROM ${source.table} WHERE ${source.where} AND ${source.column} > 0`)
        .get(...source.params(guildId)).total;
    },
    getLeaderboardRank(guildId, userId, type) {
      const source = leaderboardSource(type);
      const mine = db.prepare(`SELECT ${source.column} AS value FROM ${source.table} WHERE ${source.where} AND user_id = ?`)
        .get(...source.params(guildId), userId);
      if (!mine || !(mine.value > 0)) return null;
      const above = db.prepare(`SELECT COUNT(*) AS total FROM ${source.table} WHERE ${source.where} AND ${source.column} > ?`)
        .get(...source.params(guildId), mine.value).total;
      return above + 1;
    },
    setBirthday(guildId, userId, day, month) {
      db.prepare('INSERT INTO guild_birthdays (guild_id, user_id, day, month) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET day = excluded.day, month = excluded.month')
        .run(guildId, userId, day, month);
      return true;
    },
    removeBirthday(guildId, userId) {
      return db.prepare('DELETE FROM guild_birthdays WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes > 0;
    },
    getBirthday(guildId, userId) {
      return db.prepare('SELECT day, month FROM guild_birthdays WHERE guild_id = ? AND user_id = ?').get(guildId, userId) || null;
    },
    getBirthdaysOn(guildId, day, month) {
      return db.prepare('SELECT user_id FROM guild_birthdays WHERE guild_id = ? AND day = ? AND month = ?').all(guildId, day, month);
    },
    getBirthdayConfig(guildId) {
      return db.prepare('SELECT channel_id, message, enabled, last_sent FROM birthday_config WHERE guild_id = ?').get(guildId)
        || { channel_id: null, message: DEFAULT_BIRTHDAY_MESSAGE, enabled: 0, last_sent: null };
    },
    setBirthdayConfig(guildId, channelId, message, enabled) {
      db.prepare(`INSERT INTO birthday_config (guild_id, channel_id, message, enabled) VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, message = excluded.message, enabled = excluded.enabled`)
        .run(guildId, channelId, message, enabled);
      return true;
    },
    listBirthdayConfigs() {
      return db.prepare('SELECT guild_id, channel_id, message, enabled, last_sent FROM birthday_config').all();
    },
    markBirthdayPosted(guildId, dateKey) {
      db.prepare('INSERT INTO birthday_config (guild_id, message, enabled, last_sent) VALUES (?, ?, 0, ?) ON CONFLICT(guild_id) DO UPDATE SET last_sent = excluded.last_sent')
        .run(guildId, DEFAULT_BIRTHDAY_MESSAGE, dateKey);
      return true;
    },
    createGiveaway(g) {
      const result = db.prepare(`INSERT INTO giveaways (guild_id, channel_id, title, description, winners_count, ends_at, min_level, required_role_id, color, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(g.guildId, g.channelId, g.title, g.description, g.winnersCount, g.endsAt, g.minLevel, g.requiredRoleId, g.color, g.createdBy);
      return Number(result.lastInsertRowid);
    },
    setGiveawayMessage(id, messageId) {
      db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, id);
      return true;
    },
    getGiveaway(id) {
      return db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id) || null;
    },
    listGiveaways(guildId) {
      return db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM giveaway_entries e WHERE e.giveaway_id = g.id) AS entries
        FROM giveaways g WHERE g.guild_id = ? ORDER BY g.id DESC LIMIT 20`).all(guildId);
    },
    hasGiveawayEntry(id, userId) {
      return Boolean(db.prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').get(id, userId));
    },
    addGiveawayEntry(id, userId) {
      db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(id, userId);
      return true;
    },
    removeGiveawayEntry(id, userId) {
      db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(id, userId);
      return true;
    },
    countGiveawayEntries(id) {
      return db.prepare('SELECT COUNT(*) AS total FROM giveaway_entries WHERE giveaway_id = ?').get(id).total;
    },
    getGiveawayEntries(id) {
      return db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(id).map(row => row.user_id);
    },
    endGiveaway(id, winners) {
      db.prepare("UPDATE giveaways SET status = 'ended', winner_ids = ? WHERE id = ?").run(JSON.stringify(winners), id);
      return true;
    },
    getDueGiveaways(now) {
      return db.prepare("SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= ?").all(now);
    },
    getUserLevel(guildId, userId) {
      const row = db.prepare('SELECT level FROM xp_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
      return row ? Number(row.level) : 0;
    },
    getAutomodConfig(guildId) {
      const row = db.prepare('SELECT * FROM automod_config WHERE guild_id = ?').get(guildId);
      if (!row) {
        return { enabled: false, bad_words: [], link_mode: 'off', max_mentions: 5, strike_limit: 3, timeout_minutes: 10 };
      }
      return {
        enabled: Number(row.enabled) === 1,
        bad_words: JSON.parse(row.bad_words || '[]'),
        link_mode: row.link_mode,
        max_mentions: Number(row.max_mentions),
        strike_limit: Number(row.strike_limit),
        timeout_minutes: Number(row.timeout_minutes)
      };
    },
    setAutomodConfig(guildId, cfg) {
      db.prepare(`INSERT INTO automod_config (guild_id, enabled, bad_words, link_mode, max_mentions, strike_limit, timeout_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled, bad_words = excluded.bad_words, link_mode = excluded.link_mode,
          max_mentions = excluded.max_mentions, strike_limit = excluded.strike_limit, timeout_minutes = excluded.timeout_minutes`)
        .run(guildId, cfg.enabled ? 1 : 0, JSON.stringify(cfg.bad_words), cfg.link_mode, cfg.max_mentions, cfg.strike_limit, cfg.timeout_minutes);
      return true;
    },
    accentHex(guildId) {
      const row = guildId ? db.prepare('SELECT rank_accent FROM guild_settings WHERE guild_id = ?').get(guildId) : null;
      return row && /^#[0-9a-fA-F]{6}$/.test(row.rank_accent || '') ? row.rank_accent : '#46BBFF';
    },
    accentColor(guildId) {
      return parseInt(this.accentHex(guildId).slice(1), 16);
    },
    recordMemberEvent(guildId, type) {
      db.prepare('INSERT INTO member_events (guild_id, type, at) VALUES (?, ?, ?)').run(guildId, type, Date.now());
      return true;
    },
    memberEventCount(guildId, type, since) {
      return db.prepare('SELECT COUNT(*) AS total FROM member_events WHERE guild_id = ? AND type = ? AND at >= ?').get(guildId, type, since).total;
    },
    recordMessage(guildId, now) {
      const hour = Math.floor(now / 3600000);
      db.prepare(`INSERT INTO message_activity (guild_id, hour, count) VALUES (?, ?, 1)
        ON CONFLICT(guild_id, hour) DO UPDATE SET count = count + 1`).run(guildId, hour);
      return true;
    },
    dailyActivity(guildId, days) {
      const DAY = 86400000;
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const series = [];
      for (let i = days - 1; i >= 0; i--) {
        const start = today.getTime() - i * DAY;
        const end = start + DAY;
        const hourStart = Math.floor(start / 3600000);
        const messages = db.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM message_activity WHERE guild_id = ? AND hour BETWEEN ? AND ?')
          .get(guildId, hourStart, hourStart + 23).total;
        const joins = db.prepare("SELECT COUNT(*) AS total FROM member_events WHERE guild_id = ? AND type = 'join' AND at >= ? AND at < ?")
          .get(guildId, start, end).total;
        const leaves = db.prepare("SELECT COUNT(*) AS total FROM member_events WHERE guild_id = ? AND type = 'leave' AND at >= ? AND at < ?")
          .get(guildId, start, end).total;
        series.push({ label: new Date(start).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), messages, joins, leaves });
      }
      return series;
    },
    activityLast24h(guildId) {
      const nowHour = Math.floor(Date.now() / 3600000);
      const rows = db.prepare('SELECT hour, count FROM message_activity WHERE guild_id = ? AND hour >= ?').all(guildId, nowHour - 23);
      const byHour = new Map(rows.map(row => [row.hour, row.count]));
      const series = [];
      for (let h = nowHour - 23; h <= nowHour; h++) series.push(byHour.get(h) || 0);
      return series;
    },
    messagesLast24h(guildId) {
      return this.activityLast24h(guildId).reduce((sum, value) => sum + value, 0);
    },
    countBirthdays(guildId) {
      return db.prepare('SELECT COUNT(*) AS total FROM guild_birthdays WHERE guild_id = ?').get(guildId).total;
    },
    recordCatch(guildId, userId, fishName) {
      const today = new Date().toISOString().slice(0, 10);
      db.prepare(`INSERT INTO fishing_daily (guild_id, user_id, day, catches, sharks, legendary)
        VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(guild_id, user_id, day) DO UPDATE SET
          catches = catches + 1,
          sharks = sharks + excluded.sharks,
          legendary = legendary + excluded.legendary`).run(
        guildId, userId, today, fishName === 'Shark' ? 1 : 0, fishName === 'Legendary Fish' ? 1 : 0
      );
      db.prepare(`INSERT INTO fishing_stats (guild_id, user_id, total, shark, legendary, day, day_count)
        VALUES (?, ?, 1, ?, ?, ?, 1)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          total = total + 1,
          shark = shark + excluded.shark,
          legendary = legendary + excluded.legendary,
          day_count = CASE WHEN day = excluded.day THEN day_count + 1 ELSE 1 END,
          day = excluded.day`).run(
        guildId, userId, fishName === 'Shark' ? 1 : 0, fishName === 'Legendary Fish' ? 1 : 0, today
      );
      return true;
    },
    getFishingQuestProgress(guildId, userId, quests) {
      const today = new Date().toISOString().slice(0, 10);
      const claimed = new Set(db.prepare('SELECT claim_key FROM fishing_quest_claims WHERE guild_id = ? AND user_id = ?').all(guildId, userId).map(row => row.claim_key));
      const day = db.prepare('SELECT catches, sharks, legendary FROM fishing_daily WHERE guild_id = ? AND user_id = ? AND day = ?')
        .get(guildId, userId, today) || { catches: 0, sharks: 0, legendary: 0 };
      return quests.map(quest => {
        const value = day[quest.stat] || 0;
        const key = quest.daily ? quest.id + ':' + today : quest.id;
        return { id: quest.id, name: quest.name, desc: quest.desc, target: quest.target, reward: quest.reward, value, claimed: claimed.has(key), key };
      });
    },
    awardFishingQuests(guildId, userId, quests) {
      return db.transaction(() => {
        const awarded = [];
        for (const item of this.getFishingQuestProgress(guildId, userId, quests)) {
          if (item.claimed || item.value < item.target) continue;
          db.prepare('INSERT OR IGNORE INTO fishing_quest_claims (guild_id, user_id, claim_key, claimed_at) VALUES (?, ?, ?, ?)')
            .run(guildId, userId, item.key, Date.now());
          db.prepare('INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
          db.prepare('UPDATE economy_users SET coins = coins + ? WHERE guild_id = ? AND user_id = ?').run(item.reward, guildId, userId);
          db.prepare('INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)')
            .run(guildId, userId, item.reward, 'fishing quest: ' + item.name);
          this.addFishingXp(guildId, userId, Math.max(1, Math.floor(item.reward / 10)));
          awarded.push({ name: item.name, reward: item.reward });
        }
        return awarded;
      })();
    },
    getFishingGear(guildId, userId) {
      db.prepare('INSERT OR IGNORE INTO fishing_gear (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
      const row = db.prepare('SELECT rod, bait, owned FROM fishing_gear WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
      return { rod: row.rod, bait: row.bait, owned: JSON.parse(row.owned) };
    },
    getBaitStock(guildId, userId) {
      const stock = {};
      for (const row of db.prepare('SELECT bait, qty FROM fishing_bait WHERE guild_id = ? AND user_id = ?').all(guildId, userId)) {
        stock[row.bait] = row.qty;
      }
      return stock;
    },
    getUserLevel(guildId, userId) {
      const row = db.prepare('SELECT level FROM xp_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
      return row ? Number(row.level || 0) : 0;
    },
    buyRod(guildId, userId, rodKey, price) {
      return db.transaction(() => {
        const gear = this.getFishingGear(guildId, userId);
        if (gear.owned.includes(rodKey)) return { ok: true };
        const balance = this.getBalance(guildId, userId).coins;
        if (balance < price) return { ok: false, balance };
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
        db.prepare('UPDATE economy_users SET coins = coins - ? WHERE guild_id = ? AND user_id = ?').run(price, guildId, userId);
        db.prepare('INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)')
          .run(guildId, userId, -price, 'fishing rod: ' + rodKey);
        db.prepare('UPDATE fishing_gear SET owned = ? WHERE guild_id = ? AND user_id = ?')
          .run(JSON.stringify([...gear.owned, rodKey]), guildId, userId);
        return { ok: true };
      })();
    },
    selectRod(guildId, userId, rodKey) {
      const gear = this.getFishingGear(guildId, userId);
      if (!gear.owned.includes(rodKey)) return false;
      db.prepare('UPDATE fishing_gear SET rod = ? WHERE guild_id = ? AND user_id = ?').run(rodKey, guildId, userId);
      return true;
    },
    buyBait(guildId, userId, baitKey, qty, price) {
      return db.transaction(() => {
        const balance = this.getBalance(guildId, userId).coins;
        if (balance < price) return { ok: false, balance };
        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
        db.prepare('UPDATE economy_users SET coins = coins - ? WHERE guild_id = ? AND user_id = ?').run(price, guildId, userId);
        db.prepare('INSERT INTO economy_transactions (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)')
          .run(guildId, userId, -price, 'fishing bait: ' + baitKey + ' x' + qty);
        db.prepare(`INSERT INTO fishing_bait (guild_id, user_id, bait, qty) VALUES (?, ?, ?, ?)
          ON CONFLICT(guild_id, user_id, bait) DO UPDATE SET qty = qty + excluded.qty`).run(guildId, userId, baitKey, qty);
        return { ok: true };
      })();
    },
    selectBait(guildId, userId, baitKey) {
      if (baitKey === null) {
        db.prepare('INSERT OR IGNORE INTO fishing_gear (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
        db.prepare('UPDATE fishing_gear SET bait = NULL WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
        return true;
      }
      const row = db.prepare('SELECT qty FROM fishing_bait WHERE guild_id = ? AND user_id = ? AND bait = ?').get(guildId, userId, baitKey);
      if (!row || row.qty <= 0) return false;
      db.prepare('INSERT OR IGNORE INTO fishing_gear (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
      db.prepare('UPDATE fishing_gear SET bait = ? WHERE guild_id = ? AND user_id = ?').run(baitKey, guildId, userId);
      return true;
    },
    consumeBait(guildId, userId) {
      return db.transaction(() => {
        const gear = this.getFishingGear(guildId, userId);
        if (!gear.bait) return null;
        const row = db.prepare('SELECT qty FROM fishing_bait WHERE guild_id = ? AND user_id = ? AND bait = ?').get(guildId, userId, gear.bait);
        if (!row || row.qty <= 0) {
          db.prepare('UPDATE fishing_gear SET bait = NULL WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
          return null;
        }
        db.prepare('UPDATE fishing_bait SET qty = qty - 1 WHERE guild_id = ? AND user_id = ? AND bait = ?').run(guildId, userId, gear.bait);
        if (row.qty - 1 <= 0) {
          db.prepare('UPDATE fishing_gear SET bait = NULL WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
        }
        return gear.bait;
      })();
    },
    getVerificationConfig(guildId) {
      const row = db.prepare('SELECT * FROM verification_config WHERE guild_id = ?').get(guildId);
      if (!row) {
        return { enabled: false, unverifiedRoleId: '', verifiedRoleId: '', reviewChannelId: '', panelChannelId: '', questions: [], panelTitle: '', panelMessage: '', approveMessage: '', rejectMessage: '' };
      }
      return {
        enabled: Number(row.enabled) === 1,
        unverifiedRoleId: row.unverified_role_id || '',
        verifiedRoleId: row.verified_role_id || '',
        reviewChannelId: row.review_channel_id || '',
        panelChannelId: row.panel_channel_id || '',
        questions: JSON.parse(row.questions || '[]'),
        panelTitle: row.panel_title || '',
        panelMessage: row.panel_message || '',
        approveMessage: row.approve_message || '',
        rejectMessage: row.reject_message || ''
      };
    },
    saveVerificationConfig(guildId, cfg) {
      db.prepare(`INSERT INTO verification_config (guild_id, enabled, unverified_role_id, verified_role_id, review_channel_id, panel_channel_id, questions, panel_title, panel_message, approve_message, reject_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
          enabled = excluded.enabled,
          unverified_role_id = excluded.unverified_role_id,
          verified_role_id = excluded.verified_role_id,
          review_channel_id = excluded.review_channel_id,
          panel_channel_id = excluded.panel_channel_id,
          questions = excluded.questions,
          panel_title = excluded.panel_title,
          panel_message = excluded.panel_message,
          approve_message = excluded.approve_message,
          reject_message = excluded.reject_message`).run(
        guildId, cfg.enabled ? 1 : 0, cfg.unverifiedRoleId || null, cfg.verifiedRoleId || null,
        cfg.reviewChannelId || null, cfg.panelChannelId || null, JSON.stringify(cfg.questions),
        cfg.panelTitle || null, cfg.panelMessage || null, cfg.approveMessage || null, cfg.rejectMessage || null
      );
      return true;
    },
    createVerificationApplication(guildId, userId, answers) {
      return db.prepare('INSERT INTO verification_applications (guild_id, user_id, answers, status, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(guildId, userId, JSON.stringify(answers), 'pending', Date.now()).lastInsertRowid;
    },
    hasPendingVerification(guildId, userId) {
      return !!db.prepare("SELECT 1 FROM verification_applications WHERE guild_id = ? AND user_id = ? AND status = 'pending'").get(guildId, userId);
    },
    getVerificationApplication(id) {
      const row = db.prepare('SELECT * FROM verification_applications WHERE id = ?').get(id);
      if (!row) return null;
      return { ...row, answers: JSON.parse(row.answers || '[]') };
    },
    setVerificationReviewMessage(id, messageId) {
      db.prepare('UPDATE verification_applications SET review_message_id = ? WHERE id = ?').run(messageId, id);
      return true;
    },
    failVerificationApplication(id) {
      const result = db.prepare("UPDATE verification_applications SET status = 'failed' WHERE id = ? AND status = 'pending'").run(id);
      return result.changes > 0;
    },
    decideVerificationApplication(id, status, reviewerId) {
      const result = db.prepare("UPDATE verification_applications SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
        .run(status, reviewerId, Date.now(), id);
      return result.changes > 0;
    },
    addFishingXp(guildId, userId, amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0) return false;
      db.prepare(`INSERT INTO fishing_profile (guild_id, user_id, xp) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = xp + excluded.xp`).run(guildId, userId, amount);
      return true;
    },
    getFishingProfile(guildId, userId) {
      const xpRow = db.prepare('SELECT xp FROM fishing_profile WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
      const xp = xpRow ? xpRow.xp : 0;
      const level = Math.floor(Math.sqrt(xp / 100));
      const levelStart = level * level * 100;
      const nextStart = (level + 1) * (level + 1) * 100;
      const stats = db.prepare('SELECT total, shark, legendary FROM fishing_stats WHERE guild_id = ? AND user_id = ?').get(guildId, userId)
        || { total: 0, shark: 0, legendary: 0 };
      const quests = db.prepare('SELECT COUNT(*) AS total FROM fishing_quest_claims WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
      return {
        xp,
        level,
        xpIntoLevel: xp - levelStart,
        xpForNext: nextStart - levelStart,
        totalCaught: stats.total,
        sharks: stats.shark,
        legendary: stats.legendary,
        questsDone: quests.total
      };
    },
    getFishingLevel(guildId, userId) {
      return this.getFishingProfile(guildId, userId).level;
    },
    getAnnouncementTimezone(guildId) {
      const row = db.prepare('SELECT timezone FROM announcement_settings WHERE guild_id = ?').get(guildId);
      return row ? row.timezone : 'UTC';
    },
    setAnnouncementTimezone(guildId, timezone) {
      db.prepare(`INSERT INTO announcement_settings (guild_id, timezone) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET timezone = excluded.timezone`).run(guildId, timezone);
      return true;
    },
    listAnnouncements(guildId) {
      return db.prepare('SELECT * FROM announcements WHERE guild_id = ? ORDER BY next_run').all(guildId);
    },
    countAnnouncements(guildId) {
      return db.prepare('SELECT COUNT(*) AS total FROM announcements WHERE guild_id = ?').get(guildId).total;
    },
    createAnnouncement(guildId, item) {
      return db.prepare(`INSERT INTO announcements (guild_id, channel_id, title, body, use_embed, repeat_mode, start_date, time_of_day, next_run, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`).run(
        guildId, item.channelId, item.title || null, item.body, item.useEmbed ? 1 : 0, item.repeat,
        item.startDate, item.timeOfDay, item.nextRun, Date.now()
      ).lastInsertRowid;
    },
    deleteAnnouncement(guildId, id) {
      return db.prepare('DELETE FROM announcements WHERE guild_id = ? AND id = ?').run(guildId, id).changes > 0;
    },
    dueAnnouncements(now) {
      return db.prepare("SELECT * FROM announcements WHERE status = 'scheduled' AND next_run <= ?").all(now);
    },
    markAnnouncementSent(id, sentAt, nextRun) {
      if (nextRun === null) {
        db.prepare("UPDATE announcements SET status = 'sent', last_sent = ?, next_run = 0 WHERE id = ?").run(sentAt, id);
      } else {
        db.prepare('UPDATE announcements SET last_sent = ?, next_run = ? WHERE id = ?').run(sentAt, nextRun, id);
      }
      return true;
    },
    markAnnouncementFailed(id, error) {
      db.prepare("UPDATE announcements SET status = 'failed', last_error = ? WHERE id = ?").run(String(error).slice(0, 300), id);
      return true;
    },
    getRankBackground(guildId, userId) {
      return db.prepare('SELECT kind, preset, image, updated_at FROM rank_card_backgrounds WHERE guild_id = ? AND user_id = ?')
        .get(String(guildId), String(userId)) || null;
    },
    getRankAvatar(userId, avatarKey) {
      const row = db.prepare('SELECT image FROM rank_avatar_cache WHERE user_id = ? AND avatar_key = ?')
        .get(String(userId), String(avatarKey));
      return row?.image || null;
    },
    setRankAvatar(userId, avatarKey, image) {
      const buffer = Buffer.from(image);
      if (!buffer.length || buffer.length > 512 * 1024) return false;
      db.prepare('INSERT INTO rank_avatar_cache (user_id, avatar_key, image, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET avatar_key = excluded.avatar_key, image = excluded.image, updated_at = excluded.updated_at')
        .run(String(userId), String(avatarKey), buffer, Date.now());
      // Keep the persistent cache bounded on Wispbyte's small storage allocation.
      db.prepare('DELETE FROM rank_avatar_cache WHERE user_id NOT IN ' +
        '(SELECT user_id FROM rank_avatar_cache ORDER BY updated_at DESC LIMIT 250)').run();
      return true;
    },
    getJail(guildId, userId) {
      return db.prepare('SELECT jailed_role_id, roles, created_at FROM jail_records WHERE guild_id = ? AND user_id = ?')
        .get(String(guildId), String(userId)) || null;
    },
    setJail(guildId, userId, jailedRoleId, rolesJson, createdAt) {
      db.prepare(`INSERT INTO jail_records (guild_id, user_id, jailed_role_id, roles, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET jailed_role_id = excluded.jailed_role_id, roles = excluded.roles, created_at = excluded.created_at`)
        .run(String(guildId), String(userId), String(jailedRoleId), rolesJson, createdAt);
      return true;
    },
    clearJail(guildId, userId) {
      db.prepare('DELETE FROM jail_records WHERE guild_id = ? AND user_id = ?').run(String(guildId), String(userId));
      return true;
    },
    setVaultRule(guildId, vault, label, channelId, roleId) {
      db.prepare(`INSERT INTO vault_alert_rules (guild_id, vault, label, channel_id, role_id) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, vault) DO UPDATE SET label = excluded.label, channel_id = excluded.channel_id, role_id = excluded.role_id`)
        .run(String(guildId), vault, label, String(channelId), String(roleId));
      return true;
    },
    deleteVaultRule(guildId, vault) {
      return db.prepare('DELETE FROM vault_alert_rules WHERE guild_id = ? AND vault = ?').run(String(guildId), vault).changes > 0;
    },
    getRequestChannel(guildId) {
      const row = db.prepare('SELECT channel_id FROM vault_request_channels WHERE guild_id = ?').get(String(guildId));
      return row ? row.channel_id : null;
    },
    setRequestChannel(guildId, channelId) {
      db.prepare(`INSERT INTO vault_request_channels (guild_id, channel_id) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id`).run(String(guildId), String(channelId));
      return true;
    },
    clearRequestChannel(guildId) {
      return db.prepare('DELETE FROM vault_request_channels WHERE guild_id = ?').run(String(guildId)).changes > 0;
    },
    listVaultRules(guildId) {
      return db.prepare('SELECT vault, label, channel_id, role_id FROM vault_alert_rules WHERE guild_id = ? ORDER BY label').all(String(guildId));
    },
    getVaultRulesForChannel(guildId, channelId) {
      return db.prepare('SELECT vault, label, role_id FROM vault_alert_rules WHERE guild_id = ? AND channel_id = ?').all(String(guildId), String(channelId));
    },
    getRobloxLink(guildId, userId) {
      return db.prepare('SELECT roblox_id, username, display_name, avatar_url FROM roblox_links WHERE guild_id = ? AND user_id = ?')
        .get(String(guildId), String(userId)) || null;
    },
    setRobloxLink(guildId, userId, info) {
      db.prepare(`INSERT INTO roblox_links (guild_id, user_id, roblox_id, username, display_name, avatar_url) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET roblox_id = excluded.roblox_id, username = excluded.username,
        display_name = excluded.display_name, avatar_url = excluded.avatar_url`)
        .run(String(guildId), String(userId), info.robloxId, info.username, info.displayName, info.avatarUrl || null);
      return true;
    },
    clearRobloxLink(guildId, userId) {
      return db.prepare('DELETE FROM roblox_links WHERE guild_id = ? AND user_id = ?').run(String(guildId), String(userId)).changes > 0;
    },
    hasSeenTip(guildId, userId, tip) {
      return !!db.prepare('SELECT 1 FROM user_tips WHERE guild_id = ? AND user_id = ? AND tip = ?').get(String(guildId), String(userId), tip);
    },
    markTipSeen(guildId, userId, tip) {
      db.prepare('INSERT OR IGNORE INTO user_tips (guild_id, user_id, tip) VALUES (?, ?, ?)').run(String(guildId), String(userId), tip);
      return true;
    },
    ownerWalletStatus(guildId, now) {
      const BATCH = 30;
      if (!db.prepare('PRAGMA table_info(owner_wallets)').all().some(column => column.name === 'batch_count')) {
        db.exec("ALTER TABLE owner_wallets ADD COLUMN batch_count INTEGER NOT NULL DEFAULT 0");
      }
      db.prepare('INSERT OR IGNORE INTO owner_wallets (guild_id, balance, cooldown_until, batch_count) VALUES (?, 1000000, 0, 0)').run(String(guildId));
      const wallet = db.prepare('SELECT balance, cooldown_until, batch_count FROM owner_wallets WHERE guild_id = ?').get(String(guildId));
      const resting = wallet.cooldown_until > now;
      return {
        balance: wallet.balance,
        readyAt: resting ? wallet.cooldown_until : 0,
        leftInBatch: resting ? 0 : BATCH - (wallet.cooldown_until !== 0 ? 0 : wallet.batch_count)
      };
    },
    giftFromOwnerWallet(guildId, recipientId, amount, now) {
      const DAY = 24 * 60 * 60 * 1000;
      const HOUR = 60 * 60 * 1000;
      const BATCH = 30;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000) return { ok: false, reason: 'amount' };
      if (!db.prepare('PRAGMA table_info(owner_wallets)').all().some(column => column.name === 'batch_count')) {
        db.exec("ALTER TABLE owner_wallets ADD COLUMN batch_count INTEGER NOT NULL DEFAULT 0");
      }
      return db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO owner_wallets (guild_id, balance, cooldown_until, batch_count) VALUES (?, 1000000, 0, 0)').run(String(guildId));
        const wallet = db.prepare('SELECT balance, cooldown_until, batch_count FROM owner_wallets WHERE guild_id = ?').get(String(guildId));
        if (wallet.cooldown_until > now) return { ok: false, reason: 'wallet', readyAt: wallet.cooldown_until };
        let batchCount = wallet.batch_count;
        if (wallet.cooldown_until !== 0) batchCount = 0; // the hour rest is over, a new batch starts
        const last = db.prepare('SELECT last_at FROM owner_gift_log WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(recipientId));
        if (last && last.last_at + DAY > now) return { ok: false, reason: 'recipient', readyAt: last.last_at + DAY };
        if (wallet.balance < amount) return { ok: false, reason: 'balance', balance: wallet.balance };

        db.prepare('INSERT OR IGNORE INTO economy_users (guild_id, user_id) VALUES (?, ?)').run(String(guildId), String(recipientId));
        db.prepare('UPDATE economy_users SET coins = coins + ? WHERE guild_id = ? AND user_id = ?').run(amount, String(guildId), String(recipientId));

        const count = batchCount + 1;
        const cooldownUntil = count >= BATCH ? now + HOUR : 0;
        db.prepare('UPDATE owner_wallets SET balance = balance - ?, batch_count = ?, cooldown_until = ? WHERE guild_id = ?')
          .run(amount, cooldownUntil ? 0 : count, cooldownUntil, String(guildId));
        db.prepare(`INSERT INTO owner_gift_log (guild_id, user_id, last_at) VALUES (?, ?, ?)
          ON CONFLICT(guild_id, user_id) DO UPDATE SET last_at = excluded.last_at`).run(String(guildId), String(recipientId), now);
        return { ok: true, balance: wallet.balance - amount, readyAt: cooldownUntil, leftInBatch: BATCH - count };
      });
    },
    markAiCreatedChannel(guildId, channelId, createdBy) {
      db.prepare('INSERT OR REPLACE INTO ai_builder_channels (guild_id, channel_id, created_by, created_at) VALUES (?, ?, ?, ?)')
        .run(String(guildId), String(channelId), String(createdBy), Date.now());
      return true;
    },
    isAiCreatedChannel(guildId, channelId) {
      return Boolean(db.prepare('SELECT 1 FROM ai_builder_channels WHERE guild_id = ? AND channel_id = ?').get(String(guildId), String(channelId)));
    },
    unmarkAiCreatedChannel(guildId, channelId) {
      return db.prepare('DELETE FROM ai_builder_channels WHERE guild_id = ? AND channel_id = ?').run(String(guildId), String(channelId)).changes > 0;
    },
    getAiChannels(guildId) {
      return db.prepare('SELECT channel_id FROM ai_chat_channel_list WHERE guild_id = ? ORDER BY rowid')
        .all(String(guildId)).map(row => row.channel_id);
    },
    addAiChannel(guildId, channelId) {
      return db.prepare('INSERT OR IGNORE INTO ai_chat_channel_list (guild_id, channel_id) VALUES (?, ?)')
        .run(String(guildId), String(channelId)).changes > 0;
    },
    removeAiChannel(guildId, channelId) {
      return db.prepare('DELETE FROM ai_chat_channel_list WHERE guild_id = ? AND channel_id = ?')
        .run(String(guildId), String(channelId)).changes > 0;
    },
    clearAiChannels(guildId) {
      return db.prepare('DELETE FROM ai_chat_channel_list WHERE guild_id = ?').run(String(guildId)).changes > 0;
    },
    getUserRestrictions(guildId, userId) {
      return new Set(db.prepare('SELECT command FROM user_command_restrictions WHERE guild_id = ? AND user_id = ?').all(String(guildId), String(userId)).map(row => row.command));
    },
    getRestrictedUsers(guildId, command) {
      return db.prepare('SELECT user_id FROM user_command_restrictions WHERE guild_id = ? AND command = ?').all(String(guildId), command).map(row => row.user_id);
    },
    getRestrictedCommands(guildId) {
      return new Set(db.prepare('SELECT DISTINCT command FROM user_command_restrictions WHERE guild_id = ?').all(String(guildId)).map(row => row.command));
    },
    setUserRestriction(guildId, userId, command, restricted) {
      if (restricted) db.prepare('INSERT OR IGNORE INTO user_command_restrictions (guild_id, user_id, command) VALUES (?, ?, ?)').run(String(guildId), String(userId), command);
      else db.prepare('DELETE FROM user_command_restrictions WHERE guild_id = ? AND user_id = ? AND command = ?').run(String(guildId), String(userId), command);
      return true;
    },
    getDisabledCommands(guildId) {
      return new Set(db.prepare('SELECT command FROM disabled_commands WHERE guild_id = ?').all(String(guildId)).map(row => row.command));
    },
    setCommandEnabled(guildId, command, enabled) {
      if (enabled) db.prepare('DELETE FROM disabled_commands WHERE guild_id = ? AND command = ?').run(String(guildId), command);
      else db.prepare('INSERT OR IGNORE INTO disabled_commands (guild_id, command) VALUES (?, ?)').run(String(guildId), command);
      return true;
    },
    setAfk(guildId, userId, reason, since) {
      db.prepare(`INSERT INTO afk_status (guild_id, user_id, reason, since) VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason, since = excluded.since`)
        .run(String(guildId), String(userId), reason, since);
      return true;
    },
    getAfk(guildId, userId) {
      return db.prepare('SELECT reason, since FROM afk_status WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId)) || null;
    },
    clearAfk(guildId, userId) {
      db.prepare('DELETE FROM afk_status WHERE guild_id = ? AND user_id = ?').run(String(guildId), String(userId));
      return true;
    },
    getAfkForUsers(guildId, userIds) {
      if (!userIds.length) return [];
      const marks = userIds.map(() => '?').join(',');
      return db.prepare(`SELECT user_id, reason, since FROM afk_status WHERE guild_id = ? AND user_id IN (${marks})`)
        .all(String(guildId), ...userIds.map(String));
    },
    listRankBackgrounds(userId) {
      return db.prepare('SELECT guild_id, kind, preset, updated_at FROM rank_card_backgrounds WHERE user_id = ?').all(String(userId));
    },
    setRankPreset(guildId, userId, presetId) {
      db.prepare(`INSERT INTO rank_card_backgrounds (guild_id, user_id, kind, preset, image, updated_at) VALUES (?, ?, 'preset', ?, NULL, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET kind = 'preset', preset = excluded.preset, image = NULL, updated_at = excluded.updated_at`)
        .run(String(guildId), String(userId), presetId, Date.now());
      return true;
    },
    setRankCustom(guildId, userId, buffer) {
      db.prepare(`INSERT INTO rank_card_backgrounds (guild_id, user_id, kind, preset, image, updated_at) VALUES (?, ?, 'custom', NULL, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET kind = 'custom', preset = NULL, image = excluded.image, updated_at = excluded.updated_at`)
        .run(String(guildId), String(userId), buffer, Date.now());
      return true;
    },
    clearRankBackground(guildId, userId) {
      db.prepare('DELETE FROM rank_card_backgrounds WHERE guild_id = ? AND user_id = ?').run(String(guildId), String(userId));
      return true;
    },
    getRank(guildId, userId) {
      const row = db.prepare('SELECT xp FROM xp_users WHERE guild_id=? AND user_id=?').get(guildId, userId);
      if (!row) return null;
      const result = db.prepare('SELECT COUNT(*) AS ahead FROM xp_users WHERE guild_id=? AND xp > ?').get(guildId, row.xp);
      return result.ahead + 1;
    }
  });
}
module.exports = { initializeDatabase };
