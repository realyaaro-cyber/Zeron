const express = require('express');
const session = require('express-session');
const SQLiteStore = require('better-sqlite3-session-store')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  AttachmentBuilder
} = require('discord.js');
const { renderRankCard } = require('../bot/rank-card');
const { toV2Payload } = require('../bot/components-v2');
const { DEVELOPER_ID, getPresence, validatePresence, applyPresence } = require('../bot/presence');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function createDashboard({ db, client }) {
  const app = express();
  const isBooleanFlag = value => value === true || value === false || value === 0 || value === 1;
  const toBooleanFlag = value => value === true || value === 1;
  const production = process.env.NODE_ENV === 'production';
  const baseUrl = process.env.BASE_URL.replace(/\/$/, '');
  app.set('trust proxy', production ? 1 : false);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"]
      }
    }
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use(session({
    name: 'zeron.sid',
    store: new SQLiteStore({ client: db }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 8 * 60 * 60 * 1000 }
  }));
  app.use(express.static(path.join(__dirname, '../../public'), { index: 'index.html' }));

  function requireLogin(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Please sign in with Discord first.' });
    next();
  }
  function getManageableGuild(req, guildId) {
    const oauthGuild = req.session.guilds?.find(g => g.id === guildId);
    if (!oauthGuild) return null;
    const perms = BigInt(oauthGuild.permissions || '0');
    if (!(perms & PermissionFlagsBits.Administrator) && !(perms & PermissionFlagsBits.ManageGuild)) return null;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    return guild;
  }
  function requireGuild(req, res, next) {
    const guild = getManageableGuild(req, req.params.guildId || req.body.guildId);
    if (!guild) return res.status(403).json({ error: 'You cannot manage this server, or ZERON is not installed there.' });
    req.guild = guild;
    next();
  }
  async function exchangeCode(code) {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || 'OAuth token exchange failed');
    return data;
  }
  async function discordGet(endpoint, token) {
    const r = await fetch(`https://discord.com/api/v10${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Discord API returned ${r.status}`);
    return r.json();
  }

  app.get('/auth/discord', (req, res) => {
    const state = crypto.randomBytes(24).toString('hex');
    req.session.oauthState = state;
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify guilds applications.commands.permissions.update',
      state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });
  app.get('/auth/discord/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect('/?authError=cancelled');
      if (!code || !state || !req.session.oauthState || state !== req.session.oauthState) return res.status(400).send('Invalid OAuth state. Please try logging in again.');
      delete req.session.oauthState;
      const token = await exchangeCode(String(code));

  async function applyDevOwnerCommandPermissions(user, guilds, accessToken) {
    const targetGuildId = '1561829412956274728';
    const developerId = '1560621828982968470';

    // Only configure permissions for the authorized developer account.
    if (user.id !== developerId) return;
    if (!guilds.some(g => g.id === targetGuildId)) return;

    const appId = process.env.DISCORD_CLIENT_ID;
    const botToken = process.env.DISCORD_TOKEN;

    if (!appId || !botToken || !accessToken) {
      console.error('Command permission setup skipped: required credentials unavailable.');
      return;
    }

    const base = 'https://discord.com/api/v10';
    const commandsResponse = await fetch(
      `${base}/applications/${appId}/guilds/${targetGuildId}/commands`,
      { headers: { Authorization: `Bot ${botToken}` } }
    );

    if (!commandsResponse.ok) {
      console.error('Could not fetch guild commands for permission setup:', commandsResponse.status);
      return;
    }

    const commands = await commandsResponse.json();
    const wanted = ['devgive', 'devbank', 'ownergive'];

    for (const name of wanted) {
      const command = commands.find(c => c.name === name);

      if (!command) {
        console.error('Command not found; permission not updated:', name);
        continue;
      }

      const response = await fetch(
        `${base}/applications/${appId}/guilds/${targetGuildId}/commands/${command.id}/permissions`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            permissions: [{
              id: user.id,
              type: 2,
              permission: true
            }]
          })
        }
      );

      if (!response.ok) {
        const details = await response.text();
        console.error(`Permission update failed for /${name}:`, response.status, details);
      } else {
        console.log(`Command permission configured: /${name}`);
      }
    }
  }

      const [user, guilds] = await Promise.all([
        discordGet('/users/@me', token.access_token),
        discordGet('/users/@me/guilds', token.access_token)
      ]);
      try {
        await applyDevOwnerCommandPermissions(user, guilds, token.access_token);
      } catch (permissionError) {
        console.error('Command permission setup failed:', permissionError.message);
      }
      req.session.regenerate(err => {
        if (err) return res.status(500).send('Could not create secure session.');
        req.session.user = { id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar };
        req.session.discordAccessToken = token.access_token;
        req.session.guilds = guilds.filter(g => {
          const p = BigInt(g.permissions || '0');
          return Boolean((p & PermissionFlagsBits.Administrator) || (p & PermissionFlagsBits.ManageGuild));
        }).map(g => ({ id: g.id, name: g.name, icon: g.icon, permissions: g.permissions }));
        req.session.memberGuilds = guilds.map(g => ({ id: g.id, name: g.name, icon: g.icon }));
        req.session.save(() => res.redirect('/'));
      });
    } catch (e) {
      console.error('OAuth callback failed:', e.message);
      res.redirect('/?authError=login_failed');
    }
  });
  app.post('/api/logout', requireLogin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
  app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));
  app.get('/api/me/guilds', requireLogin, (req, res) => {
    const guilds = (req.session.guilds || []).map(g => {
      const installed = client.guilds.cache.has(g.id);
      const bot = client.guilds.cache.get(g.id);
      return { id: g.id, name: g.name, icon: bot ? bot.icon : g.icon, installed };
    });
    res.json({ guilds });
  });
  app.get('/api/guild/:guildId', requireLogin, requireGuild, (req, res) => {
    const s = db.getSettings(req.guild.id);
    res.json({ guild: { id: req.guild.id, name: req.guild.name, icon: req.guild.iconURL() }, settings: s, bot: { ready: client.isReady(), tag: client.user?.tag } });
  });
  app.get('/api/guild/:guildId/channels', requireLogin, requireGuild, (req, res) => {
    const channels = req.guild.channels.cache.filter(c => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type))
      .map(c => ({ id: c.id, name: c.name, type: c.type }));
    res.json({ channels });
  });
  app.put('/api/guild/:guildId/settings', requireLogin, requireGuild, async (req, res) => {
    try {
      const body = req.body || {};
      const patch = {};
      const stringFields = ['welcome_channel_id','mod_log_channel_id','bot_log_channel_id','announcement_channel_id','xp_channel_id','personal_channel_id'];
      for (const field of stringFields) {
        if (field in body) {
          const id = body[field] === '' || body[field] === null ? null : String(body[field]);
          if (id !== null) {
            if (!/^\d{17,20}$/.test(id)) return res.status(400).json({ error: `Invalid channel ID for ${field}.` });
            const channel = req.guild.channels.cache.get(id);
            if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return res.status(400).json({ error: `Selected channel for ${field} is not a text channel in this server.` });
          }
          patch[field] = id;
        }
      }
      for (const field of ['welcome_enabled', 'xp_enabled', 'vault_alert_enabled', 'levelup_enabled']) {
        if (field in body) {
          if (![true, false, 0, 1].includes(body[field])) {
            return res.status(400).json({ error: field + ' must be true, false, 0, or 1' });
          }
          patch[field] = body[field] ? 1 : 0;
        }
      }
    if ('vault_alert_channel_id' in body) {
      const channelId = String(body.vault_alert_channel_id || '');
      const channel = channelId ? req.guild.channels.cache.get(channelId) : null;
      if (channelId && (!/^\d{17,20}$/.test(channelId) || !channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))) {
        return res.status(400).json({ error: 'Choose a text or announcement channel in this server.' });
      }
      patch.vault_alert_channel_id = channelId;
    }
    if ('vault_alert_role_id' in body) {
      const roleId = String(body.vault_alert_role_id || '');
      const guildForVault = client.guilds.cache.get(req.params.guildId);
      if (roleId && !(guildForVault && guildForVault.roles.cache.has(roleId))) {
        return res.status(400).json({ error: 'Pick a role that exists in this server.' });
      }
      patch.vault_alert_role_id = roleId;
    }
    if ('vault_alert_trigger' in body) {
      patch.vault_alert_trigger = String(body.vault_alert_trigger || '').trim().slice(0, 80) || 'Sapphire Vault';
    }
    if ('jail_role_id' in body) {
      const roleId = String(body.jail_role_id || '');
      const role = roleId ? req.guild.roles.cache.get(roleId) : null;
      if (roleId && (!/^\d{17,20}$/.test(roleId) || !role)) {
        return res.status(400).json({ error: 'Pick a role that exists in this server.' });
      }
      if (roleId && !roleAssignable(req.guild, role)) {
        return res.status(400).json({ error: 'ZERON must have Manage Roles, and the jail role must be below its highest role and not managed by an integration.' });
      }
      patch.jail_role_id = roleId;
    }
    if ('strike_enabled' in body) {
      if (![true, false, 0, 1].includes(body.strike_enabled)) {
        return res.status(400).json({ error: 'strike_enabled must be true, false, 0, or 1' });
      }
      patch.strike_enabled = body.strike_enabled ? 1 : 0;
    }
    if ('spam_enabled' in body) {
      if (![true, false, 0, 1].includes(body.spam_enabled)) {
        return res.status(400).json({ error: 'spam_enabled must be true, false, 0, or 1' });
      }
      patch.spam_enabled = body.spam_enabled ? 1 : 0;
    }
      for (const moduleKey of ['module_xp', 'module_economy', 'module_fishing', 'module_games', 'module_welcome', 'module_invites']) {
        if (moduleKey in body) {
          if (![true, false, 0, 1].includes(body[moduleKey])) {
            return res.status(400).json({ error: moduleKey + ' must be true, false, 0, or 1' });
          }
          patch[moduleKey] = body[moduleKey] ? 1 : 0;
        }
      }
      if ('rank_accent' in body) {
        if (typeof body.rank_accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.rank_accent)) {
          return res.status(400).json({ error: 'Choose a rank card color.' });
        }
        patch.rank_accent = body.rank_accent;
      }
      if ('autorole_enabled' in body) {
        if (![true, false, 0, 1].includes(body.autorole_enabled)) {
          return res.status(400).json({ error: 'autorole_enabled must be true, false, 0, or 1' });
        }
        patch.autorole_enabled = body.autorole_enabled ? 1 : 0;
      }
      if ('welcome_message' in body) {
        if (typeof body.welcome_message !== 'string' || body.welcome_message.length > 1800) return res.status(400).json({ error: 'Welcome message must be text up to 1800 characters.' });
        patch.welcome_message = body.welcome_message;
      }
      if ('levelup_message' in body) {
        if (typeof body.levelup_message !== 'string' || body.levelup_message.length > 1800) return res.status(400).json({ error: 'Level-up message must be text up to 1800 characters.' });
        patch.levelup_message = body.levelup_message;
      }
      if ('xp_cooldown' in body) {
        const n = Number(body.xp_cooldown);
        if (!Number.isInteger(n) || n < 5 || n > 3600) return res.status(400).json({ error: 'XP cooldown must be between 5 and 3600 seconds.' });
        patch.xp_cooldown = n;
      }
      for (const field of ['xp_min','xp_max']) {
        if (field in body) {
          const n = Number(body[field]);
          if (!Number.isInteger(n) || n < 1 || n > 100) return res.status(400).json({ error: `${field} must be between 1 and 100.` });
          patch[field] = n;
        }
      }
      const currentXpSettings = db.getSettings(req.guild.id);
      const nextXpMin = patch.xp_min ?? Number(currentXpSettings.xp_min);
      const nextXpMax = patch.xp_max ?? Number(currentXpSettings.xp_max);
      if (nextXpMin > nextXpMax) return res.status(400).json({ error: 'Minimum XP cannot exceed maximum XP.' });
      if ('prefix' in body) {
        if (typeof body.prefix !== 'string' || body.prefix.length > 5) return res.status(400).json({ error: 'Prefix must be 1-5 characters.' });
        patch.prefix = body.prefix;
      }
      if ('xp_channel_ids' in body) {
        const ids = body.xp_channel_ids;
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^\d{17,20}$/.test(id))) {
          return res.status(400).json({ error: 'Invalid XP channel selection.' });
        }
        const uniqueIds = [...new Set(ids)];
        for (const id of uniqueIds) {
          const channel = req.guild.channels.cache.get(id);
          if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
            return res.status(400).json({ error: 'Select valid text or announcement channels only.' });
          }
        }
        patch.xp_channel_ids = JSON.stringify(uniqueIds);
      }

      const settings = db.saveSettings(req.guild.id, patch);
      res.json({ ok: true, settings });
    } catch (e) {
      console.error('Settings save failed:', e);
      res.status(500).json({ error: 'Could not save settings.' });
    }
  });
  app.get('/api/guild/:guildId/analytics', requireLogin, requireGuild, (req, res) => {
    try {
      const guildId = req.guild.id;
      const xp = db.prepare(
        'SELECT COUNT(*) AS members, COALESCE(SUM(xp), 0) AS totalXp, COALESCE(MAX(level), 0) AS highestLevel FROM xp_users WHERE guild_id = ?'
      ).get(guildId);
      const economy = db.prepare(
        'SELECT COUNT(*) AS users, COALESCE(SUM(coins), 0) AS totalCoins FROM economy_users WHERE guild_id = ?'
      ).get(guildId);
      const transactions = db.prepare(
        'SELECT COUNT(*) AS total FROM economy_transactions WHERE guild_id = ?'
      ).get(guildId);
      const moderation = db.prepare(
        'SELECT COUNT(*) AS total FROM moderation_logs WHERE guild_id = ?'
      ).get(guildId);
      const topXp = db.prepare(
        'SELECT user_id, xp, level FROM xp_users WHERE guild_id = ? ORDER BY xp DESC, level DESC LIMIT 5'
      ).all(guildId);
      const recentModeration = db.prepare(
        'SELECT action, target_id, moderator_id, reason, created_at FROM moderation_logs WHERE guild_id = ? ORDER BY id DESC LIMIT 5'
      ).all(guildId);
      const recentTransactions = db.prepare(
        'SELECT user_id, amount, reason, created_at FROM economy_transactions WHERE guild_id = ? ORDER BY id DESC LIMIT 5'
      ).all(guildId);

      const countOf = sql => db.prepare(sql).get(guildId).total;
      const guildSettings = db.getSettings(guildId);
      const moduleKeys = ['module_xp', 'module_economy', 'module_fishing', 'module_games', 'module_welcome', 'module_invites'];
      const features = {
        openTickets: countOf('SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ?'),
        ticketTypes: db.countTicketTypes(guildId),
        reactionRoles: countOf('SELECT COUNT(*) AS total FROM reaction_roles WHERE guild_id = ?'),
        autoRolesCount: countOf('SELECT COUNT(*) AS total FROM auto_roles WHERE guild_id = ?'),
        autoRoleEnabled: Number(guildSettings.autorole_enabled) === 1,
        levelRewards: countOf('SELECT COUNT(*) AS total FROM level_rewards WHERE guild_id = ?'),
        modulesOn: moduleKeys.filter(key => Number(guildSettings[key]) !== 0).length,
        modulesTotal: moduleKeys.length,
        welcomeOn: Number(guildSettings.welcome_enabled) === 1,
        xpOn: Number(guildSettings.xp_enabled) === 1,
        levelupOn: Number(guildSettings.levelup_enabled) === 1,
        ticketLogOn: Boolean(db.getTicketConfig(guildId).log_channel_id),
        ticketCategoryOn: Boolean(db.getTicketConfig(guildId).category_id)
      };

      res.json({ xp, economy, transactions, moderation, topXp, recentModeration, recentTransactions, features });
    } catch (error) {
      console.error('Analytics query failed:', error);
      res.status(500).json({ error: 'Could not load server analytics.' });
    }
  });

  app.get('/api/guild/:guildId/logs', requireLogin, requireGuild, (req, res) => {
    res.json({ logs: db.getLogs(req.guild.id, 100) });
  });
  app.get('/api/guild/:guildId/roles', requireLogin, requireGuild, (req, res) => {
    const roles = req.guild.roles.cache.filter(r => r.id !== req.guild.id).map(r => ({
      id: r.id, name: r.name, position: r.position, managed: r.managed, permissions: r.permissions.toArray()
    })).sort((a,b) => b.position - a.position);
    res.json({ roles, note: 'Role changes are intentionally not exposed as arbitrary dashboard mutations. Use Discord role settings and keep ZERON below trusted staff roles.' });
  });

  // A role is assignable only when ZERON has Manage Roles and sits above it.
  function roleAssignable(guild, role) {
    if (!role || role.id === guild.id || role.managed) return false;
    const botMember = guild.members.me;
    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
    return role.position < botMember.roles.highest.position;
  }

  app.get('/api/guild/:guildId/level-rewards', requireLogin, requireGuild, (req, res) => {
    const guild = req.guild;
    const roles = guild.roles.cache
      .filter(role => role.id !== guild.id && !role.managed)
      .map(role => ({
        id: role.id,
        name: role.name,
        position: role.position,
        color: role.hexColor,
        assignable: roleAssignable(guild, role)
      }))
      .sort((a, b) => b.position - a.position);
    const roleById = new Map(roles.map(role => [role.id, role]));
    const rewards = db.getLevelRewards(guild.id).map(row => {
      const role = roleById.get(row.role_id) || null;
      return {
        level: row.level,
        role_id: row.role_id,
        role_name: role ? role.name : null,
        assignable: role ? role.assignable : false
      };
    });
    const botMember = guild.members.me;
    res.json({
      rewards,
      roles,
      botCanManageRoles: Boolean(botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles))
    });
  });

  app.put('/api/guild/:guildId/level-rewards', requireLogin, requireGuild, (req, res) => {
    try {
      const list = req.body?.rewards;
      if (!Array.isArray(list) || list.length > 50) {
        return res.status(400).json({ error: 'Level rewards must be a list of up to 50 entries.' });
      }

      const seenLevels = new Set();
      const cleaned = [];
      for (const entry of list) {
        const level = Number(entry?.level);
        const roleId = String(entry?.role_id ?? '');

        if (!Number.isInteger(level) || level < 1 || level > 99) {
          return res.status(400).json({ error: 'Each reward level must be a whole number from 1 to 99.' });
        }
        if (seenLevels.has(level)) {
          return res.status(400).json({ error: `Level ${level} has more than one reward. Keep one role per level.` });
        }
        if (!/^\d{17,20}$/.test(roleId)) {
          return res.status(400).json({ error: `Choose a role for level ${level}.` });
        }

        const role = req.guild.roles.cache.get(roleId);
        if (!role) {
          return res.status(400).json({ error: `The role for level ${level} no longer exists. Pick another role.` });
        }
        if (!roleAssignable(req.guild, role)) {
          return res.status(400).json({
            error: `ZERON cannot give @${role.name}. Grant ZERON Manage Roles and move its role above @${role.name}.`
          });
        }

        seenLevels.add(level);
        cleaned.push({ level, roleId });
      }

      cleaned.sort((a, b) => a.level - b.level);
      db.replaceLevelRewards(req.guild.id, cleaned);
      res.json({ ok: true, rewards: cleaned });
    } catch (e) {
      console.error('Level rewards save failed:', e);
      res.status(500).json({ error: 'Could not save level rewards.' });
    }
  });

  app.get('/api/guild/:guildId/auto-roles', requireLogin, requireGuild, (req, res) => {
    const guild = req.guild;
    const roles = guild.roles.cache
      .filter(role => role.id !== guild.id && !role.managed)
      .map(role => ({
        id: role.id,
        name: role.name,
        position: role.position,
        color: role.hexColor,
        assignable: roleAssignable(guild, role)
      }))
      .sort((a, b) => b.position - a.position);
    const botMember = guild.members.me;
    res.json({
      roleIds: db.getAutoRoles(guild.id),
      roles,
      botCanManageRoles: Boolean(botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles))
    });
  });

  app.put('/api/guild/:guildId/auto-roles', requireLogin, requireGuild, (req, res) => {
    try {
      const list = req.body?.roleIds;
      if (!Array.isArray(list) || list.length > 10) {
        return res.status(400).json({ error: 'Auto-role can have up to 10 roles.' });
      }
      const cleaned = [];
      for (const raw of list) {
        const roleId = String(raw ?? '');
        if (!/^\d{17,20}$/.test(roleId)) {
          return res.status(400).json({ error: 'One of the selected roles is invalid.' });
        }
        const role = req.guild.roles.cache.get(roleId);
        if (!role) {
          return res.status(400).json({ error: 'A selected role no longer exists. Refresh and pick again.' });
        }
        if (!roleAssignable(req.guild, role)) {
          return res.status(400).json({
            error: `ZERON cannot give @${role.name}. Grant ZERON Manage Roles and move its role above @${role.name}.`
          });
        }
        if (!cleaned.includes(roleId)) cleaned.push(roleId);
      }
      db.replaceAutoRoles(req.guild.id, cleaned);
      res.json({ ok: true, roleIds: cleaned });
    } catch (e) {
      console.error('Auto-role save failed:', e);
      res.status(500).json({ error: 'Could not save auto-role.' });
    }
  });

  app.get('/api/guild/:guildId/reaction-roles', requireLogin, requireGuild, (req, res) => {
    const guild = req.guild;
    const rows = db.getReactionRoles(guild.id).map(row => {
      const role = guild.roles.cache.get(row.role_id);
      const channel = guild.channels.cache.get(row.channel_id);
      return {
        channel_name: channel ? channel.name : null,
        message_id: row.message_id,
        emoji: row.emoji,
        role_id: row.role_id,
        role_name: role ? role.name : null,
        assignable: roleAssignable(guild, role)
      };
    });
    res.json({ rows });
  });

  app.post('/api/guild/:guildId/reaction-roles', requireLogin, requireGuild, async (req, res) => {
    try {
      const guild = req.guild;
      const channelId = String(req.body?.channelId ?? '');
      const messageId = String(req.body?.messageId ?? '');
      const roleId = String(req.body?.roleId ?? '');
      const emojiInput = String(req.body?.emoji ?? '').trim();

      if (!/^\d{17,20}$/.test(channelId)) return res.status(400).json({ error: 'Choose a channel.' });
      if (!/^\d{17,20}$/.test(messageId)) return res.status(400).json({ error: 'Enter a valid message ID.' });
      if (!/^\d{17,20}$/.test(roleId)) return res.status(400).json({ error: 'Choose a role.' });
      if (emojiInput.length === 0 || emojiInput.length > 64) return res.status(400).json({ error: 'Enter an emoji.' });

      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Choose a text channel in this server.' });

      const role = guild.roles.cache.get(roleId);
      if (!role) return res.status(400).json({ error: 'That role no longer exists. Refresh and pick again.' });
      if (!roleAssignable(guild, role)) {
        return res.status(400).json({
          error: `ZERON cannot give @${role.name}. Grant ZERON Manage Roles and move its role above @${role.name}.`
        });
      }

      const custom = emojiInput.match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/);
      const key = custom ? custom[1] + ':' + custom[2] : emojiInput;

      let message;
      try {
        message = await channel.messages.fetch(messageId);
      } catch (e) {
        return res.status(400).json({ error: 'Message not found in that channel. Check the message ID and channel.' });
      }
      try {
        await message.react(key);
      } catch (e) {
        return res.status(400).json({ error: 'ZERON could not use that emoji. Use a standard emoji or an emoji from this server.' });
      }

      db.upsertReactionRole(guild.id, channel.id, message.id, key, role.id);
      res.json({ ok: true, emoji: key });
    } catch (e) {
      console.error('Reaction role save failed:', e);
      res.status(500).json({ error: 'Could not save reaction role.' });
    }
  });

  app.delete('/api/guild/:guildId/reaction-roles/:messageId/:emoji', requireLogin, requireGuild, (req, res) => {
    const messageId = String(req.params.messageId);
    if (!/^\d{17,20}$/.test(messageId)) return res.status(400).json({ error: 'Invalid message ID.' });
    const removed = db.deleteReactionRole(req.guild.id, messageId, String(req.params.emoji));
    if (!removed) return res.status(404).json({ error: 'That reaction role was not found.' });
    res.json({ ok: true });
  });

  // Bot status: only the developer account can read or change it.
  function requireDeveloper(req, res, next) {
    if (!req.session.user || req.session.user.id !== DEVELOPER_ID) {
      return res.status(403).json({ error: 'Only the ZERON developer can use this.' });
    }
    next();
  }

  app.get('/api/developer/presence', requireLogin, requireDeveloper, (req, res) => {
    res.json(getPresence(db));
  });

  app.put('/api/developer/presence', requireLogin, requireDeveloper, (req, res) => {
    const result = validatePresence(req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    db.setBotSetting('presence', JSON.stringify(result.value));
    try {
      applyPresence(client, result.value);
    } catch (e) {
      console.error('Presence update failed:', e);
      return res.status(500).json({ error: 'Saved, but Discord did not accept the status. Try again.' });
    }
    res.json({ ok: true, presence: result.value });
  });

  function parseReactionEmoji(input) {
    const custom = input.match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/);
    if (custom) return { key: custom[1] + ':' + custom[2], react: custom[1] + ':' + custom[2] };
    return { key: input, react: input };
  }

  app.post('/api/guild/:guildId/reaction-roles/message', requireLogin, requireGuild, async (req, res) => {
    try {
      const guild = req.guild;
      const channelId = String(req.body?.channelId ?? '');
      const content = String(req.body?.content ?? '').trim();
      const pairsIn = Array.isArray(req.body?.pairs) ? req.body.pairs : [];

      if (!/^\d{17,20}$/.test(channelId)) return res.status(400).json({ error: 'Choose a channel.' });
      if (content.length === 0 || content.length > 1800) {
        return res.status(400).json({ error: 'Write the message text (up to 1800 characters).' });
      }
      if (pairsIn.length === 0 || pairsIn.length > 10) {
        return res.status(400).json({ error: 'Add between 1 and 10 emoji roles.' });
      }

      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Choose a text channel in this server.' });

      const pairs = [];
      const seen = new Set();
      for (const pair of pairsIn) {
        const emojiInput = String(pair?.emoji ?? '').trim();
        const roleId = String(pair?.roleId ?? '');
        if (emojiInput.length === 0 || emojiInput.length > 64) return res.status(400).json({ error: 'Each row needs an emoji.' });
        if (!/^\d{17,20}$/.test(roleId)) return res.status(400).json({ error: 'Choose a role for every emoji.' });

        const parsed = parseReactionEmoji(emojiInput);
        if (seen.has(parsed.key)) return res.status(400).json({ error: 'The same emoji is used twice. Use a different emoji for each role.' });
        seen.add(parsed.key);

        const role = guild.roles.cache.get(roleId);
        if (!role) return res.status(400).json({ error: 'A selected role no longer exists. Refresh and pick again.' });
        if (!roleAssignable(guild, role)) {
          return res.status(400).json({
            error: `ZERON cannot give @${role.name}. Grant ZERON Manage Roles and move its role above @${role.name}.`
          });
        }
        pairs.push({ key: parsed.key, react: parsed.react, roleId: role.id });
      }

      let sent;
      try {
        sent = await channel.send({ content, allowedMentions: { parse: [] } });
      } catch (e) {
        return res.status(400).json({ error: 'ZERON could not post in that channel. Check its Send Messages permission.' });
      }

      for (const pair of pairs) {
        try {
          await sent.react(pair.react);
        } catch (e) {
          await sent.delete().catch(() => {});
          return res.status(400).json({ error: `ZERON could not use the emoji ${pair.key}. Use a standard emoji or an emoji from this server.` });
        }
      }

      for (const pair of pairs) {
        db.upsertReactionRole(guild.id, channel.id, sent.id, pair.key, pair.roleId);
      }
      res.json({ ok: true, messageId: sent.id });
    } catch (e) {
      console.error('Reaction message create failed:', e);
      res.status(500).json({ error: 'Could not create the reaction message.' });
    }
  });

  const TICKET_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

  app.get('/api/guild/:guildId/ticket-setup', requireLogin, requireGuild, (req, res) => {
    const guild = req.guild;
    const categories = guild.channels.cache
      .filter(channel => channel.type === ChannelType.GuildCategory)
      .map(channel => ({ id: channel.id, name: channel.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const textChannels = guild.channels.cache
      .filter(channel => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
      .map(channel => ({ id: channel.id, name: channel.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const roles = guild.roles.cache
      .filter(role => role.id !== guild.id && !role.managed)
      .map(role => ({ id: role.id, name: role.name, position: role.position, color: role.hexColor }))
      .sort((a, b) => b.position - a.position);
    const botMember = guild.members.me;
    res.json({
      categories,
      textChannels,
      roles,
      config: db.getTicketConfig(guild.id),
      types: db.listTicketTypes(guild.id),
      botCanManageChannels: Boolean(botMember && botMember.permissions.has(PermissionFlagsBits.ManageChannels))
    });
  });

  app.put('/api/guild/:guildId/ticket-setup/config', requireLogin, requireGuild, (req, res) => {
    const guild = req.guild;
    const categoryId = String(req.body?.categoryId ?? '');
    const logChannelId = String(req.body?.logChannelId ?? '');
    if (categoryId) {
      const category = guild.channels.cache.get(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) return res.status(400).json({ error: 'Choose a valid category.' });
    }
    if (logChannelId) {
      const logChannel = guild.channels.cache.get(logChannelId);
      if (!logChannel || !logChannel.isTextBased()) return res.status(400).json({ error: 'Choose a text channel for the transcript log.' });
    }
    db.setTicketConfig(guild.id, categoryId || null, logChannelId || null);
    res.json({ ok: true });
  });

  app.post('/api/guild/:guildId/ticket-setup/types', requireLogin, requireGuild, (req, res) => {
    const guild = req.guild;
    const name = String(req.body?.name ?? '').trim();
    const buttonLabel = String(req.body?.buttonLabel ?? '').trim();
    const color = db.accentHex(req.guild.id);
    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(id => String(id)) : [];

    if (name.length === 0 || name.length > 40) return res.status(400).json({ error: 'Ticket type name must be 1 to 40 characters.' });
    if (buttonLabel.length === 0 || buttonLabel.length > 40) return res.status(400).json({ error: 'Button label must be 1 to 40 characters.' });
    if (!TICKET_COLOR_PATTERN.test(color)) return res.status(400).json({ error: 'Choose a color.' });
    if (roleIds.length === 0 || roleIds.length > 10) return res.status(400).json({ error: 'Choose 1 to 10 support roles.' });
    if (db.countTicketTypes(guild.id) >= 5) return res.status(400).json({ error: 'You can have up to 5 ticket types.' });
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!/^\d{17,20}$/.test(roleId) || !role || role.id === guild.id || role.managed) {
        return res.status(400).json({ error: 'Choose existing support roles other than @everyone or integration-managed roles.' });
      }
    }

    const id = db.addTicketType(guild.id, name, buttonLabel, color, [...new Set(roleIds)]);
    res.json({ ok: true, id });
  });

  app.delete('/api/guild/:guildId/ticket-setup/types/:typeId', requireLogin, requireGuild, (req, res) => {
    const typeId = Number(req.params.typeId);
    if (!Number.isInteger(typeId)) return res.status(400).json({ error: 'Invalid ticket type.' });
    if (!db.deleteTicketType(req.guild.id, typeId)) return res.status(404).json({ error: 'That ticket type was not found.' });
    res.json({ ok: true });
  });

  app.post('/api/guild/:guildId/ticket-setup/panel', requireLogin, requireGuild, async (req, res) => {
    try {
      const guild = req.guild;
      const channelId = String(req.body?.channelId ?? '');
      const title = String(req.body?.title ?? '').trim();
      const description = String(req.body?.description ?? '').trim();
      const color = db.accentHex(req.guild.id);
      const typeIds = Array.isArray(req.body?.typeIds) ? req.body.typeIds.map(id => Number(id)) : [];

      if (!/^\d{17,20}$/.test(channelId)) return res.status(400).json({ error: 'Choose a channel.' });
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Choose a text channel in this server.' });
      if (title.length === 0 || title.length > 100) return res.status(400).json({ error: 'Panel title must be 1 to 100 characters.' });
      if (description.length > 2000) return res.status(400).json({ error: 'Panel description can be up to 2000 characters.' });
      if (!TICKET_COLOR_PATTERN.test(color)) return res.status(400).json({ error: 'Choose a color.' });
      if (typeIds.length === 0 || typeIds.length > 5) return res.status(400).json({ error: 'Pick 1 to 5 ticket types for this panel.' });

      const types = [];
      for (const typeId of [...new Set(typeIds)]) {
        const type = db.getTicketType(guild.id, typeId);
        if (!type) return res.status(400).json({ error: 'One of the selected ticket types no longer exists.' });
        types.push(type);
      }

      const embed = new EmbedBuilder()
        .setColor(parseInt(color.slice(1), 16))
        .setTitle(title);
      if (description) embed.setDescription(description);

      const row = new ActionRowBuilder().addComponents(
        types.map(type => new ButtonBuilder()
          .setCustomId('nx-ticket-open:' + type.id)
          .setLabel(type.button_label)
          .setStyle(ButtonStyle.Primary))
      );
      try {
        await channel.send(toV2Payload({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }));
      } catch (e) {
        return res.status(400).json({ error: 'ZERON could not post in that channel. Check its Send Messages permission.' });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('Ticket panel create failed:', e);
      res.status(500).json({ error: 'Could not create the ticket panel.' });
    }
  });

  const CUSTOM_NAME_PATTERN = /^[a-z0-9_-]{1,20}$/;
  const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
  function isValidImageUrl(url) {
    if (!url) return true;
    if (url.length > 500) return false;
    try {
      return new URL(url).protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  app.get('/api/guild/:guildId/custom-commands', requireLogin, requireGuild, (req, res) => {
    res.json({
      prefix: db.getSettings(req.guild.id).prefix || '!',
      limit: 50,
      commands: db.listCustomCommands(req.guild.id)
    });
  });

  app.post('/api/guild/:guildId/custom-commands', requireLogin, requireGuild, (req, res) => {
    try {
      const guild = req.guild;
      const name = String(req.body?.name ?? '').trim().toLowerCase();
      const kind = String(req.body?.kind ?? '');
      const content = String(req.body?.content ?? '').trim();
      const title = String(req.body?.title ?? '').trim();
      const color = db.accentHex(req.guild.id);
      const imageUrl = String(req.body?.imageUrl ?? '').trim();

      if (!CUSTOM_NAME_PATTERN.test(name)) return res.status(400).json({ error: 'Command name: 1 to 20 letters, numbers, - or _.' });
      if (kind !== 'text' && kind !== 'embed') return res.status(400).json({ error: 'Choose a reply type.' });
      const maxLength = kind === 'text' ? 1800 : 2000;
      if (content.length === 0 || content.length > maxLength) return res.status(400).json({ error: 'Message must be 1 to ' + maxLength + ' characters.' });
      if (title.length > 256) return res.status(400).json({ error: 'Title can be up to 256 characters.' });
      if (!HEX_COLOR_PATTERN.test(color)) return res.status(400).json({ error: 'Choose a color.' });
      if (!isValidImageUrl(imageUrl)) return res.status(400).json({ error: 'Image link must be an https:// address.' });
      if (db.countCustomCommands(guild.id) >= 50) return res.status(400).json({ error: 'You can have up to 50 custom commands.' });

      try {
        const id = db.addCustomCommand(guild.id, name, kind, content, title || null, color, imageUrl || null);
        res.json({ ok: true, id });
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'A command with that name already exists.' });
        throw e;
      }
    } catch (e) {
      console.error('Custom command save failed:', e);
      res.status(500).json({ error: 'Could not save the command.' });
    }
  });

  app.delete('/api/guild/:guildId/custom-commands/:commandId', requireLogin, requireGuild, (req, res) => {
    const commandId = Number(req.params.commandId);
    if (!Number.isInteger(commandId)) return res.status(400).json({ error: 'Invalid command.' });
    if (!db.deleteCustomCommand(req.guild.id, commandId)) return res.status(404).json({ error: 'That command was not found.' });
    res.json({ ok: true });
  });

  // Embed images: uploaded once, kept in memory for 10 minutes, then attached to the embed when it is posted.
  const pendingEmbedImages = new Map();
  app.post('/api/guild/:guildId/embed-image', requireLogin, requireGuild,
    express.raw({ type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], limit: '2mb' }), (req, res) => {
      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) return res.status(400).json({ error: 'Choose a PNG, JPG, GIF, or WEBP image.' });
      const now = Date.now();
      for (const [id, item] of pendingEmbedImages) {
        if (item.expires <= now) pendingEmbedImages.delete(id);
      }
      // Each upload can be up to 2 MB. Bound the in-memory queue so repeated
      // uploads cannot grow process memory without limit.
      if (pendingEmbedImages.size >= 20) {
        return res.status(429).json({ error: 'Too many pending image uploads. Wait a few minutes and try again.' });
      }
      const uploadId = require('crypto').randomUUID();
      pendingEmbedImages.set(uploadId, {
        buffer, type: req.headers['content-type'], guildId: req.params.guildId,
        userId: req.session.user.id, expires: now + 10 * 60 * 1000
      });
      res.json({ uploadId });
    });

  app.post('/api/guild/:guildId/embeds', requireLogin, requireGuild, async (req, res) => {
    try {
      const guild = req.guild;
      const channelId = String(req.body?.channelId ?? '');
      const title = String(req.body?.title ?? '').trim();
      const description = String(req.body?.description ?? '').trim();
      const requestedColor = String(req.body?.color ?? '').trim();
      const color = requestedColor || db.accentHex(req.guild.id);
      const imageUrl = String(req.body?.imageUrl ?? '').trim();
      const uploadId = String(req.body?.uploadId ?? '');
      const pending = uploadId ? pendingEmbedImages.get(uploadId) : null;
      if (uploadId && (!pending || pending.guildId !== req.guild.id || pending.userId !== req.session.user.id || pending.expires < Date.now())) {
        return res.status(400).json({ error: 'The image expired. Choose it again and post.' });
      }

      if (!/^\d{17,20}$/.test(channelId)) return res.status(400).json({ error: 'Choose a channel.' });
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Choose a text channel in this server.' });
      if (title.length === 0 && description.length === 0) return res.status(400).json({ error: 'Write a title or a description.' });
      if (title.length > 256) return res.status(400).json({ error: 'Title can be up to 256 characters.' });
      if (description.length > 2000) return res.status(400).json({ error: 'Description can be up to 2000 characters.' });
      if (!HEX_COLOR_PATTERN.test(color)) return res.status(400).json({ error: 'Choose a color.' });
      if (!pending && imageUrl && !isValidImageUrl(imageUrl)) return res.status(400).json({ error: 'Image link must be an https:// address.' });

      const { buildEmbedCard } = require('../bot/embed-card');
      const { MessageFlags } = require('discord.js');
      const { AttachmentBuilder } = require('discord.js');
      const files = [];
      let imageRef = imageUrl;
      if (pending) {
        pendingEmbedImages.delete(uploadId);
        const ext = pending.type === 'image/jpeg' ? 'jpg' : pending.type.split('/')[1];
        const fileName = `embed-image.${ext}`;
        files.push(new AttachmentBuilder(pending.buffer, { name: fileName }));
        imageRef = `attachment://${fileName}`;
      }
      const card = buildEmbedCard({ title, description, imageUrl: imageRef, colorHex: color });
      try {
        await channel.send({ components: [card], files, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
      } catch (e) {
        return res.status(400).json({ error: 'ZERON could not post in that channel. Check its Send Messages permission.' });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('Embed post failed:', e);
      res.status(500).json({ error: 'Could not post the embed.' });
    }
  });

  app.get('/api/guild/:guildId/birthdays', requireLogin, requireGuild, (req, res) => {
    const textChannels = req.guild.channels.cache
      .filter(channel => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
      .map(channel => ({ id: channel.id, name: channel.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const config = db.getBirthdayConfig(req.guild.id);
    res.json({
      textChannels,
      config: { channel_id: config.channel_id, message: config.message, enabled: Number(config.enabled) === 1 },
      stats: {
        saved: db.countBirthdays(req.guild.id),
        today: db.getBirthdaysOn(req.guild.id, new Date().getUTCDate(), new Date().getUTCMonth() + 1).length
      }
    });
  });

  app.put('/api/guild/:guildId/birthdays', requireLogin, requireGuild, (req, res) => {
    const guild = req.guild;
    const channelId = String(req.body?.channelId ?? '');
    const message = String(req.body?.message ?? '').trim();
    if (!isBooleanFlag(req.body?.enabled)) return res.status(400).json({ error: 'enabled must be true, false, 0, or 1' });
    const enabled = toBooleanFlag(req.body.enabled);
    if (channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return res.status(400).json({ error: 'Choose a text channel in this server.' });
    }
    if (message.length === 0 || message.length > 500) return res.status(400).json({ error: 'Message must be 1 to 500 characters.' });
    db.setBirthdayConfig(guild.id, channelId || null, message, enabled ? 1 : 0);
    res.json({ ok: true });
  });

  app.get('/api/guild/:guildId/giveaways', requireLogin, requireGuild, (req, res) => {
    const guild = req.guild;
    const textChannels = guild.channels.cache
      .filter(channel => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
      .map(channel => ({ id: channel.id, name: channel.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const roles = guild.roles.cache
      .filter(role => role.id !== guild.id && !role.managed)
      .map(role => ({ id: role.id, name: role.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const giveaways = db.listGiveaways(guild.id).map(g => ({
      id: g.id,
      title: g.title,
      status: g.status,
      winners_count: g.winners_count,
      entries: Number(g.entries) || 0,
      ends_at: Number(g.ends_at),
      channel_name: (guild.channels.cache.get(g.channel_id) || {}).name || null,
      winner_ids: JSON.parse(g.winner_ids || '[]')
    }));
    res.json({ textChannels, roles, giveaways });
  });

  app.post('/api/guild/:guildId/giveaways', requireLogin, requireGuild, async (req, res) => {
    try {
      const guild = req.guild;
      const channelId = String(req.body?.channelId ?? '');
      const title = String(req.body?.title ?? '').trim();
      const description = String(req.body?.description ?? '').trim();
      const winnersCount = Number(req.body?.winners);
      const durationMinutes = Number(req.body?.durationMinutes);
      const minLevel = Number(req.body?.minLevel || 0);
      const requiredRoleId = String(req.body?.roleId ?? '');
      const color = db.accentHex(req.guild.id);

      if (!/^\d{17,20}$/.test(channelId)) return res.status(400).json({ error: 'Choose a channel.' });
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Choose a text channel in this server.' });
      if (title.length === 0 || title.length > 100) return res.status(400).json({ error: 'Prize title must be 1 to 100 characters.' });
      if (description.length > 500) return res.status(400).json({ error: 'Description can be up to 500 characters.' });
      if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > 10) return res.status(400).json({ error: 'Winners must be 1 to 10.' });
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 43200) return res.status(400).json({ error: 'Duration must be 1 minute to 30 days.' });
      if (!Number.isInteger(minLevel) || minLevel < 0 || minLevel > 999) return res.status(400).json({ error: 'Minimum level must be 0 to 999.' });
      if (requiredRoleId && (!/^\d{17,20}$/.test(requiredRoleId) || !guild.roles.cache.has(requiredRoleId))) {
        return res.status(400).json({ error: 'The required role no longer exists.' });
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: 'Choose a color.' });

      const id = db.createGiveaway({
        guildId: guild.id,
        channelId,
        title,
        description: description || null,
        winnersCount,
        endsAt: Date.now() + durationMinutes * 60000,
        minLevel: minLevel || null,
        requiredRoleId: requiredRoleId || null,
        color,
        createdBy: req.session.user.id
      });
      try {
        await client.giveaways.post(channelId, db.getGiveaway(id));
      } catch (e) {
        db.endGiveaway(id, []);
        return res.status(400).json({ error: e.message || 'ZERON could not post the giveaway in that channel.' });
      }
      res.json({ ok: true, id });
    } catch (e) {
      console.error('Giveaway create failed:', e);
      res.status(500).json({ error: 'Could not create the giveaway.' });
    }
  });

  app.post('/api/guild/:guildId/giveaways/:giveawayId/end', requireLogin, requireGuild, async (req, res) => {
    const g = db.getGiveaway(Number(req.params.giveawayId));
    if (!g || g.guild_id !== req.guild.id) return res.status(404).json({ error: 'Giveaway not found.' });
    if (g.status !== 'active') return res.status(400).json({ error: 'This giveaway already ended.' });
    const winners = await client.giveaways.end(g, false);
    res.json({ ok: true, winners });
  });

  app.post('/api/guild/:guildId/giveaways/:giveawayId/reroll', requireLogin, requireGuild, async (req, res) => {
    const g = db.getGiveaway(Number(req.params.giveawayId));
    if (!g || g.guild_id !== req.guild.id) return res.status(404).json({ error: 'Giveaway not found.' });
    if (g.status !== 'ended') return res.status(400).json({ error: 'End the giveaway before rerolling.' });
    const winners = await client.giveaways.end(g, true);
    res.json({ ok: true, winners });
  });

  app.get('/api/guild/:guildId/automod', requireLogin, requireGuild, (req, res) => {
    res.json(db.getAutomodConfig(req.guild.id));
  });

  app.put('/api/guild/:guildId/automod', requireLogin, requireGuild, (req, res) => {
    const body = req.body || {};
    if (!isBooleanFlag(body.enabled)) return res.status(400).json({ error: 'enabled must be true, false, 0, or 1' });
    const words = Array.isArray(body.bad_words) ? body.bad_words : null;
    if (!words || words.length > 200) return res.status(400).json({ error: 'Bad words list can have up to 200 entries.' });
    const badWords = [...new Set(words.map(word => String(word).trim().toLowerCase()).filter(Boolean))];
    if (badWords.some(word => word.length > 40)) return res.status(400).json({ error: 'Each bad word can be up to 40 characters.' });
    if (!['off', 'invites', 'all'].includes(body.link_mode)) return res.status(400).json({ error: 'Choose a link rule.' });
    const maxMentions = Number(body.max_mentions);
    const strikeLimit = Number(body.strike_limit);
    const timeoutMinutes = Number(body.timeout_minutes);
    if (!Number.isInteger(maxMentions) || maxMentions < 0 || maxMentions > 20) return res.status(400).json({ error: 'Mentions limit must be 0 to 20.' });
    if (!Number.isInteger(strikeLimit) || strikeLimit < 0 || strikeLimit > 10) return res.status(400).json({ error: 'Strikes must be 0 to 10.' });
    if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 1440) return res.status(400).json({ error: 'Timeout must be 1 to 1440 minutes.' });
    db.setAutomodConfig(req.guild.id, {
      enabled: toBooleanFlag(body.enabled),
      bad_words: badWords,
      link_mode: body.link_mode,
      max_mentions: maxMentions,
      strike_limit: strikeLimit,
      timeout_minutes: timeoutMinutes
    });
    res.json({ ok: true });
  });

  app.get('/api/guild/:guildId/overview-stats', requireLogin, requireGuild, (req, res) => {
    const guild = req.guild;
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).size;
    const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice).size;
    res.json({
      members: guild.memberCount,
      joined7d: db.memberEventCount(guild.id, 'join', since),
      left7d: db.memberEventCount(guild.id, 'leave', since),
      textChannels,
      voiceChannels,
      roles: Math.max(0, guild.roles.cache.size - 1),
      boostLevel: guild.premiumTier || 0,
      boostCount: guild.premiumSubscriptionCount || 0,
      created: guild.createdAt.toISOString(),
      activity: db.activityLast24h(guild.id),
      messages24: db.messagesLast24h(guild.id),
      trend: db.dailyActivity(guild.id, 7),
      online: guild.members.cache.some(m => m.presence) ? guild.members.cache.filter(m => m.presence && m.presence.status !== 'offline').size : null
    });
  });

  app.get('/api/guild/:guildId/stats-channels', requireLogin, requireGuild, (req, res) => {
    const voice = req.guild.channels.cache
      .filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ items: db.getStatsChannels(req.guild.id), voice });
  });

  app.put('/api/guild/:guildId/stats-channels', requireLogin, requireGuild, (req, res) => {
    const voiceIds = new Set(req.guild.channels.cache
      .filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
      .keys());
    const input = Array.isArray((req.body || {}).items) ? req.body.items : [];
    const items = [];
    for (const row of input.slice(0, 3)) {
      const channelId = String((row && row.channelId) || '');
      const template = String((row && row.template) || '').trim();
      if (!channelId && !template) continue;
      if (!voiceIds.has(channelId)) return res.status(400).json({ error: 'Choose a voice channel in this server.' });
      if (!template) return res.status(400).json({ error: 'Each stats channel needs a name template.' });
      if (template.length > 60) return res.status(400).json({ error: 'Name template must be 60 characters or less.' });
      if (items.some(item => item.channelId === channelId)) return res.status(400).json({ error: 'Use each voice channel only once.' });
      items.push({ channelId, template });
    }
    db.saveStatsChannels(req.guild.id, items);
    res.json({ ok: true, items: db.getStatsChannels(req.guild.id) });
  });

  app.get('/api/guild/:guildId/onboarding', requireLogin, requireGuild, (req, res) => {
    const channels = req.guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const roles = req.guild.roles.cache
      .filter(r => roleAssignable(req.guild, r))
      .map(r => ({ id: r.id, name: r.name, position: r.position }))
      .sort((a, b) => b.position - a.position);
    res.json({ config: db.getOnboardingConfig(req.guild.id), channels, roles });
  });

  app.put('/api/guild/:guildId/onboarding', requireLogin, requireGuild, (req, res) => {
    const body = req.body || {};
    if (!isBooleanFlag(body.enabled)) return res.status(400).json({ error: 'enabled must be true, false, 0, or 1' });
    const channelId = String(body.channelId || '');
    const steps = (Array.isArray(body.steps) ? body.steps : [])
      .map(step => ({
        title: String((step && step.title) || '').trim().slice(0, 100),
        text: String((step && step.text) || '').trim().slice(0, 1000)
      }))
      .filter(step => step.title && step.text)
      .slice(0, 5);
    const requestedRoles = body.roles === undefined ? [] : body.roles;
    if (!Array.isArray(requestedRoles) || requestedRoles.length > 10) {
      return res.status(400).json({ error: 'Choose up to 10 onboarding roles.' });
    }
    const roles = [...new Set(requestedRoles.map(String))];
    for (const roleId of roles) {
      if (!/^\d{17,20}$/.test(roleId)) return res.status(400).json({ error: 'One of the selected onboarding roles is invalid.' });
      const role = req.guild.roles.cache.get(roleId);
      if (!role) return res.status(400).json({ error: 'One of the selected onboarding roles no longer exists.' });
      if (!roleAssignable(req.guild, role)) {
        return res.status(400).json({ error: 'ZERON must have Manage Roles, and each onboarding role must be below its highest role and not managed by an integration.' });
      }
    }
    const enabled = toBooleanFlag(body.enabled);
    const channel = channelId ? req.guild.channels.cache.get(channelId) : null;
    if (channelId && (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))) return res.status(400).json({ error: 'Choose a text channel in this server.' });
    if (enabled && !channelId) return res.status(400).json({ error: 'Choose the onboarding channel.' });
    if (enabled && steps.length === 0 && roles.length === 0) return res.status(400).json({ error: 'Add at least one step or one role.' });
    db.saveOnboardingConfig(req.guild.id, { enabled, channelId, steps, roles });
    res.json({ ok: true, config: db.getOnboardingConfig(req.guild.id) });
  });

  // My rank card: each server has its own background for each member.
  const rankCard = require('../bot/rank-card');
  const imageType = buffer => (buffer[0] === 0x89 ? 'image/png' : 'image/jpeg');
  const isValidImage = buffer => (buffer[0] === 0x89 && buffer[1] === 0x50) || (buffer[0] === 0xFF && buffer[1] === 0xD8);
  // The user must be a member of the server, and ZERON must be installed there.
  const memberOfZeronGuild = (req, guildId) => {
    const inServer = (req.session.memberGuilds || []).some(g => g.id === guildId);
    return inServer && client.guilds.cache.has(guildId);
  };

  app.get('/api/me/rank-backgrounds', requireLogin, (req, res) => {
    const saved = new Map(db.listRankBackgrounds(req.session.user.id).map(row => [row.guild_id, row]));
    const servers = (req.session.memberGuilds || []).filter(g => client.guilds.cache.has(g.id)).map(g => {
      const row = saved.get(g.id);
      return {
        id: g.id,
        name: g.name,
        icon: g.icon,
        background: row ? { kind: row.kind, preset: row.preset, updatedAt: row.updated_at } : null
      };
    });
    res.json({ servers, presets: rankCard.RANK_BACKGROUND_PRESETS });
  });

  app.get('/api/me/rank-background/:guildId/image', requireLogin, (req, res) => {
    if (!memberOfZeronGuild(req, req.params.guildId)) return res.status(404).end();
    const saved = db.getRankBackground(req.params.guildId, req.session.user.id);
    if (!saved) return res.status(404).end();
    const buffer = saved.kind === 'preset' ? rankCard.loadPresetBackground(saved.preset) : saved.image;
    if (!buffer) return res.status(404).end();
    res.type(imageType(buffer)).set('Cache-Control', 'private, no-cache').send(buffer);
  });

  app.put('/api/me/rank-background/:guildId/preset', requireLogin, (req, res) => {
    if (!memberOfZeronGuild(req, req.params.guildId)) return res.status(403).json({ error: 'You are not a member of that server.' });
    const presetId = String((req.body || {}).preset || '');
    if (!rankCard.RANK_BACKGROUND_PRESETS.some(item => item.id === presetId)) {
      return res.status(400).json({ error: 'Choose one of the built-in backgrounds.' });
    }
    db.setRankPreset(req.params.guildId, req.session.user.id, presetId);
    rankCard.clearRankCardCache(req.session.user.id);
    res.json({ ok: true });
  });

  app.put('/api/me/rank-background/:guildId/custom', requireLogin, express.raw({ type: ['image/png', 'image/jpeg'], limit: '2mb' }), (req, res) => {
    if (!memberOfZeronGuild(req, req.params.guildId)) return res.status(403).json({ error: 'You are not a member of that server.' });
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return res.status(400).json({ error: 'Upload a PNG or JPG image.' });
    if (!isValidImage(buffer)) return res.status(400).json({ error: 'That file is not a valid PNG or JPG.' });
    db.setRankCustom(req.params.guildId, req.session.user.id, buffer);
    rankCard.clearRankCardCache(req.session.user.id);
    res.json({ ok: true });
  });

  app.delete('/api/me/rank-background/:guildId', requireLogin, (req, res) => {
    if (!memberOfZeronGuild(req, req.params.guildId)) return res.status(403).json({ error: 'You are not a member of that server.' });
    db.clearRankBackground(req.params.guildId, req.session.user.id);
    rankCard.clearRankCardCache(req.session.user.id);
    res.json({ ok: true });
  });

  // Public status for the home page: whether the bot is online and how many servers it is in.
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      botReady: client.isReady(),
      guilds: client.guilds.cache.size,
      ping: client.ws.ping,
      lastHeartbeat: new Date(client.nxLastHeartbeat || 0).toISOString()
    });
  });

  app.get('/api/guilds', (req, res) => {
    res.json({ guilds: db.listGlobalGuilds(), wars: db.listGlobalWars(10) });
  });

  app.get('/guilds', (req, res) => {
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const day = t => { const d = new Date(t); return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10); };
    const guilds = db.listGlobalGuilds();
    const wars = db.listGlobalWars(10);
    const totalMembers = guilds.reduce((n, g) => n + (Number(g.member_count) || 0), 0);
    const totalWins = guilds.reduce((n, g) => n + (Number(g.wins) || 0), 0);
    const topGuild = guilds[0] || null;
    const guildRows = guilds.map((g, i) => `<tr data-guild-name="${esc(g.name).toLowerCase()}"><td><span class="rank rank-${i + 1}">${i + 1}</span></td><td><div class="guild-name"><span class="guild-emblem">♜</span><strong>${esc(g.name)}</strong></div></td><td><span class="level-pill">LVL ${Number(g.level) || 1}</span></td><td><strong>${(Number(g.xp) || 0).toLocaleString('en-US')}</strong><div class="xp-track"><i style="width:${Math.max(0, Math.min(100, (Number(g.xp) || 0) % 100))}%"></i></div></td><td>${Number(g.member_count) || 0}<span class="muted"> / 25</span></td><td>${Number(g.wins) || 0}</td><td class="muted">${day(g.created_at)}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty-cell">No guilds yet. Use <b>/guild</b> in any server to create one.</td></tr>';
    const warCards = wars.map(w => {
      const winner = w.winner_id == null ? 'Awaiting result' : (String(w.winner_id) === String(w.challenger_id) ? w.challenger_name : w.opponent_name);
      const status = String(w.status || 'unknown').toLowerCase();
      return `<article class="war-card"><div class="war-top"><span class="war-kicker">GUILD MATCH</span><span class="war-status status-${esc(status)}">${esc(w.status)}</span></div><div class="war-versus"><div class="war-side"><span class="war-crest">♜</span><strong>${esc(w.challenger_name)}</strong></div><div class="war-score">${Number(w.challenger_score) || 0}<span>:</span>${Number(w.opponent_score) || 0}</div><div class="war-side"><span class="war-crest">♜</span><strong>${esc(w.opponent_name)}</strong></div></div><div class="war-winner">${w.winner_id == null ? 'Match in progress' : `Winner · <b>${esc(winner)}</b>`}</div></article>`;
    }).join('') || '<div class="empty-state"><span>⚔</span><b>No battles recorded yet</b><small>Guild wars will appear here when they begin.</small></div>';
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090d18"><title>ZERON · Guild Command</title><style>
:root{color-scheme:dark;--bg:#090d18;--panel:#111827;--panel2:#151f31;--line:#26354c;--text:#f3f7ff;--muted:#8e9bb1;--cyan:#64d8ff;--violet:#9a83ff;--green:#57e2b0}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 12% -8%,#183b5b66,transparent 38%),radial-gradient(ellipse at 92% 0%,#39235a55,transparent 34%),var(--bg);color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh}a{color:inherit}.shell{max-width:1180px;margin:auto;padding:0 24px 64px}.topbar{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ffffff12}.brand{display:flex;align-items:center;gap:12px;font-weight:900;letter-spacing:2px}.brand-mark{width:38px;height:38px;display:grid;place-items:center;border:1px solid #64d8ff55;border-radius:12px;background:linear-gradient(145deg,#163a54,#251b48);color:var(--cyan);font-size:22px;box-shadow:0 0 26px #4fcfff18}.brand small{display:block;color:var(--muted);font-size:9px;letter-spacing:2.5px}.top-link{font-size:12px;color:var(--cyan);text-decoration:none;border:1px solid #64d8ff40;padding:9px 13px;border-radius:10px}.hero{position:relative;overflow:hidden;margin:30px 0 22px;padding:34px;border:1px solid #7bdcff26;border-radius:24px;background:linear-gradient(115deg,#13263aee,#17162cee 68%,#241b3bee);box-shadow:0 24px 70px #0005}.hero:after{content:'⚔';position:absolute;right:7%;top:50%;transform:translateY(-50%) rotate(-12deg);font-size:150px;color:#b8eaff0b;pointer-events:none}.eyebrow,.section-kicker{font-size:10px;font-weight:800;letter-spacing:2.4px;color:var(--cyan);text-transform:uppercase}.hero h1{font-size:clamp(30px,5vw,48px);line-height:1.05;margin:10px 0 9px;letter-spacing:-1.5px}.hero p{max-width:560px;margin:0;color:#aab8cb}.hero-meta{display:flex;gap:9px;flex-wrap:wrap;margin-top:22px}.meta-chip{padding:7px 11px;border-radius:99px;background:#ffffff0b;border:1px solid #ffffff16;color:#c6d5e8;font-size:11px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin:0 0 34px}.stat{padding:18px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(145deg,#141f30,#101725);min-width:0}.stat-label{font-size:10px;color:var(--muted);letter-spacing:1.3px;text-transform:uppercase}.stat-value{font-size:27px;font-weight:850;letter-spacing:-.7px;margin-top:5px}.stat-note{font-size:11px;color:#71829b;margin-top:2px}.stat-icon{float:right;color:var(--cyan);font-size:20px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:14px;margin:34px 0 14px}.section-head h2{font-size:17px;margin:4px 0 0;letter-spacing:-.3px}.section-sub{font-size:12px;color:var(--muted)}.search{width:min(100%,270px);background:#111a29;border:1px solid var(--line);border-radius:11px;padding:10px 13px;color:var(--text);outline:none}.search:focus{border-color:#64d8ff99;box-shadow:0 0 0 3px #64d8ff15}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:17px;background:#101725;box-shadow:0 18px 45px #0003}table{width:100%;border-collapse:collapse;min-width:740px}th{padding:14px 15px;text-align:left;background:#ffffff05;color:#8191aa;font-size:9px;letter-spacing:1.4px;text-transform:uppercase}td{padding:14px 15px;border-top:1px solid #ffffff0a;font-size:12px;white-space:nowrap}tbody tr:hover{background:#ffffff05}.rank{display:grid;place-items:center;width:27px;height:27px;border-radius:9px;background:#ffffff0a;color:#9eacc0;font-weight:800}.rank-1{background:#ffd66b1c;color:#ffd66b}.rank-2{background:#c8d7e51a;color:#c8d7e5}.rank-3{background:#d99a6a1c;color:#e8ad7c}.guild-name{display:flex;align-items:center;gap:10px}.guild-emblem,.war-crest{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:linear-gradient(145deg,#1b4056,#35234e);border:1px solid #72dfff33;color:var(--cyan);font-size:17px}.level-pill{padding:5px 8px;border-radius:7px;background:#8e7cff19;color:#b9aaff;font-size:10px;font-weight:800}.xp-track{width:80px;height:4px;border-radius:99px;background:#ffffff12;margin-top:6px;overflow:hidden}.xp-track i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--cyan),var(--violet))}.muted{color:var(--muted)}.empty-cell{text-align:center;padding:28px;color:var(--muted)}.war-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.war-card{border:1px solid var(--line);border-radius:16px;padding:17px;background:linear-gradient(145deg,#141f30,#101725)}.war-top{display:flex;justify-content:space-between;align-items:center}.war-kicker{font-size:9px;letter-spacing:1.5px;color:#7f91aa;font-weight:800}.war-status{font-size:9px;padding:5px 8px;border-radius:99px;background:#ffffff0d;color:#b9c6d8;text-transform:uppercase}.status-active,.status-ongoing{background:#57e2b018;color:#7df0c5}.status-completed,.status-finished{background:#64d8ff18;color:#8ce2ff}.war-versus{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin:18px 0}.war-side{display:flex;align-items:center;gap:8px;min-width:0}.war-side:last-child{flex-direction:row-reverse;text-align:right}.war-side strong{font-size:12px;overflow-wrap:anywhere}.war-score{font-size:23px;font-weight:900;white-space:nowrap}.war-score span{color:#60718a;padding:0 5px}.war-winner{border-top:1px solid #ffffff0d;padding-top:11px;color:var(--muted);font-size:11px}.war-winner b{color:var(--green)}.empty-state{grid-column:1/-1;display:grid;justify-items:center;gap:7px;padding:28px;border:1px dashed #33445d;border-radius:16px;color:var(--muted)}.empty-state span{font-size:25px;color:var(--cyan)}.empty-state b{color:#dbe7f5}.footer{margin-top:36px;padding-top:18px;border-top:1px solid #ffffff12;color:#65748b;font-size:11px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}@media(max-width:760px){.shell{padding:0 15px 42px}.hero{padding:25px 21px;margin-top:20px}.hero:after{right:-10px;font-size:100px}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.stat{padding:14px}.stat-value{font-size:23px}.section-head{align-items:stretch;flex-direction:column}.search{width:100%}.war-grid{grid-template-columns:1fr}.topbar{height:66px}}@media(prefers-reduced-motion:no-preference){.stat,.war-card,.table-wrap{transition:border-color .2s,transform .2s}.stat:hover,.war-card:hover{transform:translateY(-2px);border-color:#64d8ff66}}
/* ZERON dashboard-aligned guild leaderboard refresh */
:root{--bg:#090d18;--panel:#111b2b;--panel2:#162338;--line:#263b55;--text:#f3f7ff;--muted:#91a2ba;--cyan:#72d8ff;--violet:#a28cff;--green:#62e4b7}
body{background:radial-gradient(ellipse at 80% 0%,#2876b522,transparent 38%),radial-gradient(ellipse at 0% 65%,#6550a318,transparent 36%),var(--bg)}
.shell{max-width:1180px;padding-left:clamp(14px,3vw,28px);padding-right:clamp(14px,3vw,28px)}
.topbar{min-height:72px;height:auto;border-bottom-color:#9bcfff20}
.top-link{border-color:#69caff42;background:#3b9fe512;border-radius:11px;transition:background .2s,border-color .2s}
.top-link:hover{background:#3b9fe526;border-color:#80d7ff88}
.hero{border-color:#72cfff30;border-radius:22px;background:radial-gradient(ellipse at 90% 15%,#2876b522,transparent 44%),linear-gradient(145deg,#132137f5,#0e1929f8);box-shadow:0 18px 48px #0004,inset 0 1px #ffffff08}
.hero h1{letter-spacing:-1.2px}
.stats{gap:14px}
.stat,.war-card{border-color:#9bcfff20;border-radius:17px;background:linear-gradient(145deg,#142238f5,#0e1929f8);box-shadow:0 10px 28px #0002;transition:transform .2s,border-color .2s}
.stat:hover,.war-card:hover{border-color:#72cfff55}
.stat-label,.section-kicker{color:#9bcfff}
.stat-value{font-variant-numeric:tabular-nums}
.section-head{margin-top:38px}
.section-head h2{font-size:19px}
.table-wrap{width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;border:1px solid #9bcfff20;border-radius:17px;background:linear-gradient(145deg,#121e30f5,#0e1929f8);box-shadow:0 10px 28px #0002}
table{width:100%;min-width:700px;border-collapse:separate;border-spacing:0}
thead th{position:sticky;top:0;background:#16243a;color:#9fb3cc;border-bottom:1px solid #9bcfff20}
tbody td{border-bottom:1px solid #ffffff0b}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:#5bbfff0b}
.rank{border:1px solid #9bcfff18;background:#ffffff0b}
.rank-1{background:#ffd66b20;color:#ffdc83;border-color:#ffd66b35}
.rank-2{background:#c8d7e520;color:#d8e4f0;border-color:#c8d7e535}
.rank-3{background:#d99a6a20;color:#e8b18a;border-color:#d99a6a35}
.guild-emblem,.war-crest{border-color:#72d8ff40;background:linear-gradient(145deg,#173b55,#282047);box-shadow:inset 0 1px #ffffff0c}
.level-pill{border:1px solid #a28cff35;background:#8e7cff1c;color:#c2b6ff}
.xp-track{background:#ffffff14}
.xp-track i{background:linear-gradient(90deg,#72d8ff,#a28cff)}
.search{color:var(--text);background:#111d2e;border-color:#31445e;border-radius:12px;outline:none}
.search:focus{border-color:#72d8ff;box-shadow:0 0 0 3px #72d8ff20}
.empty-state{border-color:#405673;background:#101b2b}
.footer{border-top-color:#9bcfff20;color:#8495ad}
@media(max-width:760px){
 .shell{padding:0 13px 38px}
 .hero{margin-top:17px;padding:23px 19px;border-radius:19px}
 .hero:after{right:-14px;font-size:94px}
 .stats{gap:9px;margin-bottom:28px}
 .stat{padding:14px 12px;border-radius:14px}
 .stat-value{font-size:23px}
 .section-head{margin-top:29px}
 .section-head h2{font-size:17px}
 .table-wrap{border-radius:14px}
 .war-card{border-radius:14px}
 .topbar{min-height:64px}
 .footer{font-size:10px}
}
@media(max-width:380px){
 .shell{padding-left:10px;padding-right:10px}
 .stat{padding:12px 10px}
 .stat-value{font-size:21px}
 .hero h1{font-size:29px}
 .meta-chip{font-size:10px}
}
@media(prefers-reduced-motion:reduce){
 *,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}
}</style></head><body><div class="shell"><header class="topbar"><div class="brand"><span class="brand-mark">♜</span><span>ZERON<small>GUILD COMMAND</small></span></div><a class="top-link" href="/">← CONTROL CENTER</a></header>
<section class="hero"><div class="eyebrow">THE GUILD NETWORK</div><h1>Strength is built <span style="color:#64d8ff">together.</span></h1><p>Discover the guilds shaping the network, follow their rise, and track the latest rivalries across ZERON.</p><div class="hero-meta"><span class="meta-chip">✦ Live network overview</span><span class="meta-chip">⚔ Guild rankings</span><span class="meta-chip">♜ War records</span></div></section>
<section class="stats"><article class="stat"><span class="stat-icon">♜</span><div class="stat-label">Guilds formed</div><div class="stat-value">${guilds.length.toLocaleString('en-US')}</div><div class="stat-note">Across the ZERON network</div></article><article class="stat"><span class="stat-icon">♟</span><div class="stat-label">Guild members</div><div class="stat-value">${totalMembers.toLocaleString('en-US')}</div><div class="stat-note">Combined membership</div></article><article class="stat"><span class="stat-icon">🏆</span><div class="stat-label">War victories</div><div class="stat-value">${totalWins.toLocaleString('en-US')}</div><div class="stat-note">Recorded guild wins</div></article><article class="stat"><span class="stat-icon">✦</span><div class="stat-label">Top guild</div><div class="stat-value" style="font-size:18px;overflow-wrap:anywhere">${topGuild ? esc(topGuild.name) : '—'}</div><div class="stat-note">${topGuild ? `Level ${Number(topGuild.level) || 1} · ${(Number(topGuild.xp) || 0).toLocaleString('en-US')} XP` : 'Be the first to rise'}</div></article></section>
<section><div class="section-head"><div><div class="section-kicker">THE HALL OF HONOR</div><h2>Guild leaderboard</h2><div class="section-sub">Rankings, progression, and strength across the network.</div></div><input id="guild-search" class="search" type="search" placeholder="Search guilds…" aria-label="Search guilds"></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Guild</th><th>Level</th><th>Total XP</th><th>Members</th><th>Wins</th><th>Founded</th></tr></thead><tbody id="guild-rows">${guildRows}</tbody></table></div></section>
<section><div class="section-head"><div><div class="section-kicker">RECENT CONFLICTS</div><h2>Latest guild wars</h2><div class="section-sub">The latest recorded matchups and outcomes.</div></div></div><div class="war-grid">${warCards}</div><p class="section-sub" style="margin-top:12px">Fishing wars count catches by members across all servers where ZERON is installed.</p></section>
<footer class="footer"><span>© 2026 ZERON · GUILD NETWORK</span><span>Built for teams that rise together.</span></footer></div><script>const search=document.getElementById('guild-search');search?.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();document.querySelectorAll('#guild-rows tr[data-guild-name]').forEach(row=>{row.hidden=!row.dataset.guildName.includes(q);});});</script></body></html>`);
  });

  app.get('/api/guild/:guildId/verification', requireLogin, requireGuild, (req, res) => {
    const roles = req.guild.roles.cache.filter(r => roleAssignable(req.guild, r))
      .map(r => ({ id: r.id, name: r.name, position: r.position }))
      .sort((a, b) => b.position - a.position);
    const channels = req.guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ config: db.getVerificationConfig(req.guild.id), roles, channels });
  });

  app.put('/api/guild/:guildId/verification', requireLogin, requireGuild, (req, res) => {
    const body = req.body || {};
    if (!isBooleanFlag(body.enabled)) return res.status(400).json({ error: 'enabled must be true, false, 0, or 1' });
    const roleIds = new Set(req.guild.roles.cache.keys());
    const channelIds = new Set(req.guild.channels.cache.keys());
    const pick = (value, allowed, label) => {
      if (!value) return '';
      const id = String(value);
      if (!allowed.has(id)) throw new Error(label + ' was not found in this server.');
      return id;
    };
    try {
      const questions = Array.isArray(body.questions) ? body.questions.map(q => String(q || '').trim()).filter(Boolean) : [];
      if (questions.length > 5) return res.status(400).json({ error: 'Use up to 5 questions.' });
      if (questions.some(q => q.length > 45)) return res.status(400).json({ error: 'Each question must be 45 characters or less.' });
      const panelTitle = String(body.panelTitle || '').trim();
      const panelMessage = String(body.panelMessage || '').trim();
      const approveMessage = String(body.approveMessage || '').trim();
      const rejectMessage = String(body.rejectMessage || '').trim();
      if (panelTitle.length > 45) return res.status(400).json({ error: 'Verification name must be 45 characters or less.' });
      if (panelMessage.length > 1000) return res.status(400).json({ error: 'Panel message must be 1000 characters or less.' });
      if (approveMessage.length > 500 || rejectMessage.length > 500) return res.status(400).json({ error: 'Approve and reject messages must be 500 characters or less.' });
      const cfg = {
        enabled: toBooleanFlag(body.enabled),
        unverifiedRoleId: pick(body.unverifiedRoleId, roleIds, 'Unverified role'),
        verifiedRoleId: pick(body.verifiedRoleId, roleIds, 'Verified role'),
        reviewChannelId: pick(body.reviewChannelId, channelIds, 'Review channel'),
        panelChannelId: pick(body.panelChannelId, channelIds, 'Panel channel'),
        questions,
        panelTitle,
        panelMessage,
        approveMessage,
        rejectMessage
      };
      for (const [label, channelId] of [['Review channel', cfg.reviewChannelId], ['Panel channel', cfg.panelChannelId]]) {
        if (!channelId) continue;
        const channel = req.guild.channels.cache.get(channelId);
        if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
          return res.status(400).json({ error: label + ' must be a text channel in this server.' });
        }
      }
      if (cfg.enabled) {
        for (const [label, roleId] of [['Unverified role', cfg.unverifiedRoleId], ['Verified role', cfg.verifiedRoleId]]) {
          if (!roleId) continue;
          const role = req.guild.roles.cache.get(roleId);
          if (!roleAssignable(req.guild, role)) return res.status(400).json({ error: 'ZERON cannot assign the selected ' + label.toLowerCase() + '. Check Manage Roles and role position.' });
        }
      }
      if (cfg.enabled && questions.length === 0) return res.status(400).json({ error: 'Add at least one question before turning verification on.' });
      if (cfg.enabled && (!cfg.verifiedRoleId || !cfg.reviewChannelId)) return res.status(400).json({ error: 'Choose the Verified role and the review channel.' });
      db.saveVerificationConfig(req.guild.id, cfg);
      res.json({ ok: true, config: db.getVerificationConfig(req.guild.id) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/guild/:guildId/verification/panel', requireLogin, requireGuild, async (req, res) => {
    try {
      await client.verification.postPanel(req.guild.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  const tzUtil = require('../bot/timezone');

  app.get('/api/guild/:guildId/announcements', requireLogin, requireGuild, (req, res) => {
    const channels = req.guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      timezone: db.getAnnouncementTimezone(req.guild.id),
      timezones: tzUtil.COMMON_TIMEZONES,
      defaultChannelId: db.getSettings(req.guild.id).announcement_channel_id || '',
      channels,
      announcements: db.listAnnouncements(req.guild.id).map(row => ({
        id: row.id,
        channelId: row.channel_id,
        title: row.title || '',
        repeat: row.repeat_mode,
        status: row.status,
        nextRun: row.next_run,
        lastError: row.last_error || ''
      }))
    });
  });

  app.put('/api/guild/:guildId/announcements/timezone', requireLogin, requireGuild, (req, res) => {
    const timezone = String((req.body || {}).timezone || '');
    if (!tzUtil.isValidTimezone(timezone)) return res.status(400).json({ error: 'Choose a valid time zone.' });
    db.setAnnouncementTimezone(req.guild.id, timezone);
    res.json({ ok: true, timezone });
  });

  app.post('/api/guild/:guildId/announcements', requireLogin, requireGuild, (req, res) => {
    const body = req.body || {};
    const channelId = String(body.channelId || '');
    const title = String(body.title || '').trim();
    const text = String(body.body || '').trim();
    const repeat = String(body.repeat || 'once');
    const startDate = String(body.date || '');
    const timeOfDay = String(body.time || '');
    const timezone = db.getAnnouncementTimezone(req.guild.id);

    if (!isBooleanFlag(body.useEmbed)) return res.status(400).json({ error: 'useEmbed must be true, false, 0, or 1' });
    const channel = req.guild.channels.cache.get(channelId);
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return res.status(400).json({ error: 'Choose a text channel in this server.' });
    if (!text) return res.status(400).json({ error: 'Write the announcement message.' });
    if (text.length > 2000) return res.status(400).json({ error: 'Message must be 2000 characters or less.' });
    if (title.length > 256) return res.status(400).json({ error: 'Title must be 256 characters or less.' });
    if (!['once', 'daily', 'weekly'].includes(repeat)) return res.status(400).json({ error: 'Repeat must be once, daily, or weekly.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{2}:\d{2}$/.test(timeOfDay)) {
      return res.status(400).json({ error: 'Pick a date and time.' });
    }
    if (db.countAnnouncements(req.guild.id) >= 25) return res.status(400).json({ error: 'You can keep up to 25 announcements per server.' });

    const now = Date.now();
    const nextRun = tzUtil.nextOccurrence(startDate, timeOfDay, repeat, timezone, now);
    if (!nextRun) return res.status(400).json({ error: 'That time has already passed. Pick a future date and time.' });

    const id = db.createAnnouncement(req.guild.id, {
      channelId, title, body: text, useEmbed: toBooleanFlag(body.useEmbed), repeat,
      startDate, timeOfDay, nextRun
    });
    res.json({ ok: true, id, nextRun });
  });

  app.delete('/api/guild/:guildId/announcements/:id', requireLogin, requireGuild, (req, res) => {
    const removed = db.deleteAnnouncement(req.guild.id, Number(req.params.id));
    if (!removed) return res.status(404).json({ error: 'Announcement not found.' });
    res.json({ ok: true });
  });

  app.post('/api/guild/:guildId/testing/send', requireLogin, requireGuild, async (req, res) => {
    try {
      const { type, channelId, message } = req.body || {};
      const allowedTypes = ['welcome', 'levelup', 'rank', 'leaderboard', 'custom'];

      if (!allowedTypes.includes(type)) {
        return res.status(400).json({ error: 'Unknown test type.' });
      }

      if (typeof channelId !== 'string' || !/^\d{17,20}$/.test(channelId)) {
        return res.status(400).json({ error: 'Choose a valid channel first.' });
      }

      const channel = req.guild.channels.cache.get(channelId);
      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return res.status(400).json({ error: 'Choose a text channel in this server.' });
      }

      const botMember = req.guild.members.me;
      const permissions = botMember && channel.permissionsFor(botMember);

      if (!permissions || !permissions.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages
      ])) {
        return res.status(403).json({ error: 'ZERON needs View Channel and Send Messages permissions in that channel.' });
      }

      const username = String(req.session.user.username || 'Test Member').slice(0, 80);
      const guildName = String(req.guild.name || 'your server').slice(0, 100);
      const gold = db.accentColor(req.guild.id);
      let payload;

      if (type === 'welcome') {
        const settings = db.getSettings(req.guild.id);
        const template = String(typeof message === 'string' && message.length <= 1800 ? message : settings.welcome_message || 'Welcome {user} to **{server}**!');
        const welcomeText = template
          .replaceAll('{user}', `<@${req.session.user.id}>`)
          .replaceAll('{username}', username)
          .replaceAll('{server}', guildName);

        payload = {
          content: welcomeText,
          allowedMentions: { parse: [] }
        };
      } else if (type === 'levelup') {
        if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
          return res.status(403).json({ error: 'ZERON needs Embed Links permission in that channel.' });
        }
        payload = {
          embeds: [new EmbedBuilder()
            .setColor(gold)
            .setTitle('✨ LEVEL UP! — TEST')
            .setDescription(String(message || db.getSettings(req.guild.id).levelup_message || '🎉 Congratulations {user}! You reached level {level} in {server}!').replaceAll('{reward}', '🎁 Reward role').replaceAll('{user}', '<@' + req.session.user.id + '>').replaceAll('{username}', username).replaceAll('{server}', guildName).replaceAll('{level}', '28') + '\n\n*Test message — no XP was changed.*')
            .setFooter({ text: 'ZERON • TEST MESSAGE' })
            .setTimestamp()]
        };
      } else if (type === 'rank') {
        if (!permissions.has(PermissionFlagsBits.AttachFiles)) {
          return res.status(403).json({ error: 'ZERON needs Attach Files permission in that channel.' });
        }

        const member = await req.guild.members.fetch(req.session.user.id).catch(() => null);
        if (!member) {
          return res.status(400).json({ error: 'Your Discord account must be a member of this server to generate its rank card.' });
        }

        const image = await renderRankCard({
          user: member.user,
          xp: 18450,
          level: 27,
          rank: 4,
          xpIntoLevel: 650,
          xpNeeded: 1000
        });

        payload = {
          content: '🪪 **ZERON Rank Card — TEST** (sample stats; your real XP was not changed)',
          files: [new AttachmentBuilder(image, { name: 'zeron-rank-test.png' })],
          allowedMentions: { parse: [] }
        };
      } else if (type === 'leaderboard') {
        if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
          return res.status(403).json({ error: 'ZERON needs Embed Links permission in that channel.' });
        }

        const rows = [
          ['🥇', username, '18,450 XP', 'Level 27'],
          ['🥈', 'ShadowByte', '16,820 XP', 'Level 25'],
          ['🥉', 'Luna.exe', '14,200 XP', 'Level 23'],
          ['④', 'NovaCore', '11,760 XP', 'Level 20'],
          ['⑤', 'PixelGhost', '9,430 XP', 'Level 17']
        ];

        payload = {
          embeds: [new EmbedBuilder()
            .setColor(gold)
            .setTitle('🏆 XP Leaderboard — TEST')
            .setDescription(rows.map((r, i) => `**${r[0]} ${r[1]}** — ${r[2]} · ${r[3]}`).join('\n'))
            .setFooter({ text: 'ZERON • Sample leaderboard; real XP was not changed' })
            .setTimestamp()]
        };
      } else {
        if (typeof message !== 'string' || !message.trim() || message.length > 1800) {
          return res.status(400).json({ error: 'Enter a message between 1 and 1800 characters.' });
        }

        payload = {
          content: message.trim(),
          allowedMentions: { parse: [] }
        };
      }

      await channel.send(toV2Payload(payload));
      res.json({ ok: true, message: `Test message sent to #${channel.name}.` });
    } catch (e) {
      console.error('Testing Lab send failed:', e.message);
      res.status(500).json({ error: 'Could not send the test message. Check the bot logs and channel permissions.' });
    }
  });


  app.use((err, req, res, next) => {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  });
  return app;
}
module.exports = { createDashboard };
