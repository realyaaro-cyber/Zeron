const {
  Client, GatewayIntentBits, Partials, Events, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');
const { getPresence, applyPresence } = require('./presence');
const { createGiveawayService, handleGiveawayEnter } = require('./giveaways');
const { nextOccurrence } = require('./timezone');
const { ChannelType } = require('discord.js');
const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { commands, GUILD_ONLY_COMMANDS } = require('../commands/definitions');
const { ZERON_FEATURE_KNOWLEDGE } = require('./knowledge');
const { renderRankCard, loadPresetBackground, RANK_BACKGROUND_PRESETS, downloadAvatar } = require('./rank-card');
const { addText: addV2Text, embedToContainer: convertEmbedToContainer, toV2Payload: buildV2Payload } = require('./components-v2');

const SHOP_ITEMS = [
  { id: 'lucky_charm', name: 'Lucky Charm', price: 250, resale: 125, emoji: '🍀' },
  { id: 'shield', name: 'Guardian Shield', price: 500, resale: 250, emoji: '🛡️' },
  { id: 'gem', name: 'ZERON Gem', price: 1000, resale: 500, emoji: '💎' },
  { id: 'badge', name: 'Elite Badge', price: 2000, resale: 1000, emoji: '🏅' }
];

// Module switches: user-facing commands that are turned off with their module.
// Admin setup commands (welcome, track-invite, enable-level-up, role-reward) stay on so admins can re-enable.
const COMMAND_MODULES = {
  rank: 'module_xp', leaderboard: 'module_xp',
  pay: 'module_economy', inventory: 'module_economy', profile: 'module_economy', transactions: 'module_economy', bank: 'module_economy', collectibles: 'module_economy',
  fish: 'module_fishing',
  play: 'module_games', trivia: 'module_games'
};

// /help: built from the live command definitions so usage is always accurate.
const HELP_OPTION_TYPES = { 1: 'subcommand', 2: 'group', 3: 'text', 4: 'number', 5: 'true/false', 6: 'user', 7: 'channel', 8: 'role', 9: 'mention', 10: 'number', 11: 'file' };
const HELP_HIDDEN = ['help'];
const HELP_FOLDERS = [
  {
    id: 'restricted',
    label: '📁 Developer & Owner commands',
    description: 'Restricted commands. Only the developer or the server owner can use them.',
    names: ['devgive', 'ownergive', 'jail', 'unjail', 'manage-cmnds']
  },
  {
    id: 'staff',
    label: '🛡️ Administrator & Moderator commands',
    description: 'For admins and moderators. These need Manage Server, Kick, Ban, Timeout or Manage Messages.',
    names: ['welcome', 'track-invite', 'enable-level-up', 'role-reward', 'starboard', 'poll', 'kick', 'ban', 'unban', 'timeout', 'untimeout', 'purge', 'trivia', 'vaultalert', 'vaultpost', 'aichat']
  },
  {
    id: 'member',
    label: '👥 Member commands',
    description: 'Commands every member can use.',
    names: ['ping', 'serverinfo', 'userinfo', 'rank', 'leaderboard', 'pay', 'inventory', 'profile', 'bank', 'collectibles', 'fish', 'play', 'transactions', 'birthday', 'guild', 'afk', 'roblox']
  }
];

function helpCommands() {
  return commands
    .map(c => c.toJSON())
    .filter(c => !HELP_HIDDEN.includes(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function helpFolderNames() {
  return HELP_FOLDERS.flatMap(f => f.names);
}

function helpMainCommands() {
  const inFolder = helpFolderNames();
  return helpCommands().filter(c => !inFolder.includes(c.name));
}

function helpUsage(cmd) {
  if ((cmd.options || []).some(option => option.type === 1)) {
    return '/' + cmd.name + ' <' + cmd.options.map(option => option.name).join('|') + '>';
  }
  const parts = (cmd.options || []).map(o => (o.required ? '<' + o.name + '>' : '[' + o.name + ']'));
  return ['/' + cmd.name, ...parts].join(' ');
}

function helpListEmbed(color, disabled = new Set()) {
  const all = helpCommands();
  const shown = all.filter(c => c.name !== 'help' && !disabled.has(c.name));
  const fields = HELP_FOLDERS.map(folder => {
    const cmds = folder.names
      .map(n => all.find(c => c.name === n))
      .filter(Boolean)
      .filter(c => !disabled.has(c.name));
    const value = cmds.length
      ? cmds.map(c => '`/' + c.name + '`').join('  ')
      : '*No commands here right now.*';
    return { name: `${folder.label}  ·  ${cmds.length}`, value: value.slice(0, 1024), inline: false };
  });
  const loose = helpMainCommands().filter(c => !disabled.has(c.name) && !HELP_FOLDERS.some(f => f.names.includes(c.name)));
  if (loose.length) {
    fields.push({ name: '✨  More', value: loose.map(c => '`/' + c.name + '`').join('  ').slice(0, 1024), inline: false });
  }
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('📚 ZERON Commands')
    .setDescription(`You can use **${shown.length}** commands here, grouped by what they do.\nPick a folder below to see what each command does and how to use it.`)
    .addFields(fields)
    .setFooter({ text: 'ZERON · Hidden or blocked commands are not listed for you' })
    .setTimestamp();
}

function helpDetailEmbed(cmd, color) {
  const opts = (cmd.options || []).map(o =>
    '• **' + o.name + '** (' + (HELP_OPTION_TYPES[o.type] || 'value') + (o.required ? ', required' : ', optional') + '): ' + o.description
  );
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('/' + cmd.name)
    .setDescription(cmd.description)
    .addFields(
      { name: 'Usage', value: '```' + helpUsage(cmd) + '```' },
      { name: 'Options', value: opts.length ? opts.join('\n').slice(0, 1024) : 'No options needed.' }
    )
    .setFooter({ text: 'Choose another command to view it.' });
}

function helpFolderEmbed(folder, color, disabled = new Set()) {
  const cmds = folder.names.map(n => helpCommands().find(c => c.name === n)).filter(Boolean).filter(c => !disabled.has(c.name));
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(folder.label)
    .setDescription(folder.description)
    .addFields(cmds.map(c => ({
      name: '/' + c.name,
      value: c.name === 'starboard'
        ? c.description + '\nUsage: `/starboard setup <enabled> [source_channel] [destination_channel] [threshold]`'
        : c.name === 'poll'
          ? c.description + '\nUsage: `/poll action:<create|list|end|results> [question] [options] [poll_id]`'
          : c.description + '\nUsage: `' + helpUsage(c) + '`'
    })))
    .setFooter({ text: 'Choose another command to view it.' });
}

function buildPollEmbed(poll, votes = [], closed = false) {
  const options = JSON.parse(poll.options || '[]');
  const counts = options.map((_, index) => votes.filter(vote => vote.options.includes(index)).length);
  const total = votes.length;
  const fields = options.map((option, index) => {
    const count = counts[index];
    const percent = total ? Math.round(count / total * 100) : 0;
    const bar = '▰'.repeat(Math.round(percent / 10)) + '▱'.repeat(10 - Math.round(percent / 10));
    const voterList = !poll.anonymous
      ? votes.filter(vote => vote.options.includes(index)).slice(0, 12).map(vote => '<@' + vote.userId + '>').join(', ')
      : '';
    const voterText = voterList ? '\nVoters: ' + voterList : '';
    const extraVoters = !poll.anonymous && count > 12 ? ' +' + (count - 12) + ' more' : '';
    return { name: (index + 1) + '. ' + option, value: bar + '  **' + count + '** (' + percent + '%)' + voterText + extraVoters, inline: false };
  });
  const ends = Number(poll.ends_at || 0);
  const status = closed || poll.status !== 'active' || ends <= Date.now() ? '🔒 Poll closed' : '🟢 Voting is open';
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📊 ' + poll.question)
    .setDescription(status + (poll.anonymous ? ' · Anonymous voting' : '') + (poll.multiple ? ' · Multiple choices allowed' : ''))
    .addFields(fields)
    .setFooter({ text: 'Poll #' + poll.id + ' · ' + total + ' voter' + (total === 1 ? '' : 's') })
    .setTimestamp(new Date(Number(poll.created_at || Date.now())));
  if (!closed && poll.status === 'active' && ends > Date.now()) {
    embed.addFields({ name: 'Closes', value: '<t:' + Math.floor(ends / 1000) + ':R>', inline: true });
  }
  return embed;
}

function buildPollRows(poll, closed = false) {
  if (closed || poll.status !== 'active' || Number(poll.ends_at) <= Date.now()) return [];
  const options = JSON.parse(poll.options || '[]');
  const rows = [];
  for (let start = 0; start < options.length; start += 5) {
    const row = new ActionRowBuilder();
    options.slice(start, start + 5).forEach((option, offset) => {
      const index = start + offset;
      row.addComponents(new ButtonBuilder()
        .setCustomId('nx-poll-vote:' + poll.id + ':' + index)
        .setLabel((index + 1) + '. ' + option.slice(0, 65))
        .setStyle(ButtonStyle.Secondary));
    });
    rows.push(row);
  }
  return rows;
}

function pollV2Payload(poll, votes = [], closed = false) {
  const embed = buildPollEmbed(poll, votes, closed);
  const rows = buildPollRows(poll, closed);
  return {
    components: [embedToContainer(embed, rows)],
    flags: require('discord.js').MessageFlags.IsComponentsV2
  };
}

function helpComponents() {
  const entries = [
    ...HELP_FOLDERS.map(f => ({ label: f.label, description: f.description, value: 'folder:' + f.id })),
    ...helpMainCommands().map(c => ({ label: '/' + c.name, description: c.description, value: c.name }))
  ].map(e => ({ ...e, description: e.description.slice(0, 100) }));

  const rows = [];
  for (let i = 0, page = 0; i < entries.length && rows.length < 5; i += 25, page++) {
    const slice = entries.slice(i, i + 25);
    const menu = new StringSelectMenuBuilder()
      .setCustomId('nx-help:' + page)
      .setPlaceholder('Choose a folder')
      .addOptions(slice);
    rows.push(new ActionRowBuilder().addComponents(menu));
  }
  return rows;
}

const ACHIEVEMENTS = [
  { id: 'coin_earner_1k', emoji: '🪙', name: 'Pocket Full', description: 'Earn 1,000 coins', metric: 'totalEarned', target: 1000 },
  { id: 'coin_earner_10k', emoji: '💰', name: 'Coin Collector', description: 'Earn 10,000 coins', metric: 'totalEarned', target: 10000 },
  { id: 'chat_xp_1k', emoji: '💬', name: 'Active Voice', description: 'Earn 1,000 server XP', metric: 'xp', target: 1000 },
  { id: 'chat_xp_10k', emoji: '⭐', name: 'Community Star', description: 'Earn 10,000 server XP', metric: 'xp', target: 10000 },
  { id: 'fish_caught_10', emoji: '🎣', name: 'First Catch', description: 'Catch 10 fish', metric: 'fishCaught', target: 10 },
  { id: 'fish_caught_100', emoji: '🐟', name: 'Master Angler', description: 'Catch 100 fish', metric: 'fishCaught', target: 100 },
  { id: 'shark_caught_1', emoji: '🦈', name: 'Shark Hunter', description: 'Catch a shark', metric: 'sharks', target: 1 },
  { id: 'legendary_caught_1', emoji: '🌟', name: 'Legendary Discovery', description: 'Catch a legendary fish', metric: 'legendaryFish', target: 1 },
  { id: 'fishing_quests_10', emoji: '📜', name: 'Quest Veteran', description: 'Complete 10 fishing quests', metric: 'fishingQuests', target: 10 },
  { id: 'collectibles_3', emoji: '💎', name: 'Curator', description: 'Own 3 different collectibles', metric: 'uniqueCollectibles', target: 3 }
];

function syncAchievements(db, guildId, userId) {
  const stats = db.getAchievementStats(guildId, userId);
  for (const achievement of ACHIEVEMENTS) {
    if (stats[achievement.metric] >= achievement.target) {
      db.unlockAchievement(guildId, userId, achievement.id);
    }
  }
  const unlocked = new Set(db.getAchievements(guildId, userId).map(row => row.achievement_id));
  return {
    unlocked: ACHIEVEMENTS.filter(item => unlocked.has(item.id)),
    locked: ACHIEVEMENTS.filter(item => !unlocked.has(item.id)).map(item => ({
      ...item,
      progress: Math.min(stats[item.metric], item.target)
    })),
    total: ACHIEVEMENTS.length
  };
}

// Safely reads the JSON list of XP channel IDs stored in guild_settings.
function parseChannelIds(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// Gives every role whose level requirement is met. Rewards stack, so reaching
// level 10 also keeps the roles for levels 5 and 1. Skips roles ZERON cannot assign.
async function grantLevelRewards(db, message, level) {
  const granted = [];
  const roleIds = db.getRewardRoleIdsUpTo(message.guild.id, level);
  if (roleIds.length === 0) return granted;

  const botMember = message.guild.members.me;
  if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return granted;

  const member = message.member || await message.guild.members.fetch(message.author.id);
  const botTopPosition = botMember.roles.highest.position;

  for (const roleId of roleIds) {
    if (member.roles.cache.has(roleId)) continue;
    const role = message.guild.roles.cache.get(roleId);
    if (!role || role.managed || role.position >= botTopPosition) continue;
    try {
      await member.roles.add(role, `ZERON level ${level} reward`);
      granted.push(roleId);
    } catch (error) {
      console.error('Level reward role failed:', error.message);
    }
  }
  return granted;
}

const SLOT_WAGERS = [100, 250, 500, 1000, 2500, 5000, 10000];

const SLOT_SYMBOLS = [
  { emoji: '🍒', weight: 30, pay: 6 },
  { emoji: '🍋', weight: 25, pay: 8 },
  { emoji: '🍇', weight: 20, pay: 13 },
  { emoji: '⭐', weight: 12, pay: 25 },
  { emoji: '💎', weight: 8, pay: 55 },
  { emoji: '7️⃣', weight: 5, pay: 100 }
];

function pickSlotSymbol() {
  const total = SLOT_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);
  let roll = Math.random() * total;
  for (const symbol of SLOT_SYMBOLS) {
    roll -= symbol.weight;
    if (roll < 0) return symbol;
  }
  return SLOT_SYMBOLS[0];
}

function spinSlots(amount) {
  const reels = Array.from({ length: 3 }, () => pickSlotSymbol());
  const emojis = reels.map(reel => reel.emoji);
  if (emojis[0] === emojis[1] && emojis[1] === emojis[2]) {
    return { emojis, kind: 'triple', symbol: reels[0], multiplier: reels[0].pay, payout: amount * reels[0].pay };
  }
  const hasPair = emojis.some(emoji => emojis.filter(other => other === emoji).length === 2);
  if (hasPair) return { emojis, kind: 'pair', multiplier: 1, payout: amount };
  return { emojis, kind: 'none', multiplier: 0, payout: 0 };
}

function slotsWagerPrompt() {
  const paytable = SLOT_SYMBOLS.slice().reverse()
    .map(symbol => symbol.emoji + symbol.emoji + symbol.emoji + ' x' + symbol.pay)
    .join('  ·  ');
  return '🎰 **Choose your wager**\nPaytable: ' + paytable + '\nAny pair: your bet is returned.';
}

function slotsEmbed(amount, spin, balance) {
  const net = spin.payout - amount;
  const outcome = spin.kind === 'triple'
    ? '🎉 JACKPOT! Three ' + spin.symbol.emoji + ' pays x' + spin.multiplier
    : spin.kind === 'pair'
      ? '✨ A pair! Your bet is returned.'
      : '💤 No match this time.';
  const color = net > 0 ? 0x22c55e : net === 0 ? 0xf5c542 : 0xef4444;
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🎰 ZERON Slots')
    .setDescription(
      '**' + spin.emojis.join('  │  ') + '**\n' + outcome + '\n\n' +
      'Wager: **🪙 ' + amount.toLocaleString() + '**\n' +
      'Payout: **🪙 ' + spin.payout.toLocaleString() + '**\n' +
      'Net: **' + (net >= 0 ? '+' : '') + net.toLocaleString() + ' coins**\n' +
      'Balance: **🪙 ' + balance.toLocaleString() + '**'
    );
}

function slotsAgainRow(userId, amount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('zeron_slots_again:' + userId + ':' + amount)
      .setLabel('Spin Again (' + amount.toLocaleString() + ')')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('zeron_slots_wager:' + userId)
      .setLabel('Change Wager')
      .setStyle(ButtonStyle.Secondary)
  );
}

function playSlots(interaction, db, ownerId, amount) {
  const spin = spinSlots(amount);
  const result = db.wager(interaction.guildId, ownerId, amount, 'slots', spin.payout);
  if (!result.ok) {
    const message = result.reason === 'funds'
      ? 'Not enough coins for ' + amount.toLocaleString() + '. Your balance is 🪙 ' + (result.balance || 0).toLocaleString() + '. Pick a smaller wager.'
      : 'That wager could not be processed.';
    return interaction.update({ content: message, embeds: [], components: [slotsAgainRow(ownerId, amount)] });
  }
  return interaction.update({
    content: null,
    embeds: [slotsEmbed(amount, spin, result.balance)],
    components: [slotsAgainRow(ownerId, amount)]
  });
}

function slotsWagerRow(userId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`zeron_slots_bet:${userId}`)
      .setPlaceholder('Choose your wager')
      .addOptions(SLOT_WAGERS.map(amount => ({ label: amount.toLocaleString() + ' coins', value: String(amount) })))
  );
}


const FISH_TYPES = [
  { name: 'Common Fish', emoji: '🐟', value: 10, weight: 30 },
  { name: 'River Trout', emoji: '🐟', value: 20, weight: 18 },
  { name: 'Tropical Fish', emoji: '🐠', value: 30, weight: 14 },
  { name: 'Crab', emoji: '🦀', value: 40, weight: 12 },
  { name: 'Golden Carp', emoji: '🐡', value: 55, weight: 9 },
  { name: 'Squid', emoji: '🦑', value: 75, weight: 6 },
  { name: 'Octopus', emoji: '🐙', value: 100, weight: 4 },
  { name: 'Swordfish', emoji: '🐟', value: 150, weight: 3 },
  { name: 'Shark', emoji: '🦈', value: 200, weight: 2 },
  { name: 'Whale', emoji: '🐳', value: 300, weight: 1 },
  { name: 'Legendary Fish', emoji: '🐉', value: 500, weight: 1 }
];

const FISH_RODS = {
  plastic: { name: 'Plastic Rod', price: 0, rare: 1, value: 1, desc: 'Basic starter rod.' },
  improved: { name: 'Improved Rod', price: 500, rare: 1.5, value: 1, desc: 'Attracts slightly better fish.' },
  steel: { name: 'Steel Rod', price: 2500, rare: 2, value: 1.1, desc: 'Allows you to catch better fish, but slightly less of them.' },
  fiberglass: { name: 'Fiberglass Rod', price: 50000, rare: 2.5, value: 1.2, desc: 'Catches large amounts of quality fish.' },
  heavy: { name: 'Heavy Rod', price: 100000, rare: 1, value: 2, commonMult: 0.5, desc: "Doesn't catch as many fish, but gets you far more treasure." }
};

const FISH_BAIT = {
  worms: { name: 'Worms', emoji: '🪱', price: 250, pack: 10, bonusChance: 0.3, quality: 1, desc: 'Increases amount of fish caught.' },
  leeches: { name: 'Leeches', emoji: '🐛', price: 600, pack: 10, bonusChance: 0.4, quality: 1.1, level: 5, desc: 'Increases amount of fish caught and slightly improves quality.' },
  magnet: { name: 'Magnet', emoji: '🧲', price: 1500, pack: 5, bonusChance: 0.5, quality: 1.25, level: 20, desc: 'Strongest bait. Best chance for bonus fish and rare catches.' }
};

const FISH_QUESTS = [
  { id: 'daily_first', name: 'Morning Cast', desc: 'Catch 1 fish today', stat: 'catches', target: 1, reward: 50, daily: true },
  { id: 'daily_warmup', name: 'Warm-Up', desc: 'Catch 10 fish today', stat: 'catches', target: 10, reward: 150, daily: true },
  { id: 'daily_25', name: 'Steady Angler', desc: 'Catch 25 fish today', stat: 'catches', target: 25, reward: 200, daily: true },
  { id: 'daily_100', name: 'Fishing Frenzy', desc: 'Catch 100 fish today', stat: 'catches', target: 100, reward: 1000, daily: true },
  { id: 'daily_shark', name: 'Shark Hunt', desc: 'Catch a Shark today', stat: 'sharks', target: 1, reward: 300, daily: true },
  { id: 'daily_legend', name: 'Legend Quest', desc: 'Catch the Legendary Fish today', stat: 'legendary', target: 1, reward: 1000, daily: true }
];

// Keeps Discord's global slash commands in step with src/commands/definitions.js on every start,
// so removed commands (like /tts) disappear without running the register script by hand.
async function syncGlobalCommands(client) {
  const { REST, Routes } = require('discord.js');
  const guildOnly = new Set(Object.values(GUILD_ONLY_COMMANDS).flat());
  const body = commands.filter(command => !guildOnly.has(command.name)).map(command => command.toJSON());
  if (body.length > 100) throw new Error('Discord allows at most 100 global commands');
  const rest = new REST({ version: '10' }).setToken(client.token);
  await rest.put(Routes.applicationCommands(client.user.id), { body });
  for (const [guildId, names] of Object.entries(GUILD_ONLY_COMMANDS)) {
    const guildBody = commands.filter(command => names.includes(command.name)).map(command => command.toJSON());
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: guildBody })
      .catch(error => console.error(`Guild command sync failed for ${guildId}:`, error.message));
  }
}

function coinText(amount) {
  return Number(amount).toLocaleString() + ' coins';
}

// Removes the bitcoin application emoji uploaded earlier (idempotent).
async function removeCoinEmoji(client) {
  const existing = await client.application.emojis.fetch();
  const found = existing.find(emoji => emoji.name === 'bitcoin');
  if (found) await client.application.emojis.delete(found.id);
}

const VERIFY_DEFAULTS = {
  title: 'Server verification',
  message: 'Press the button below and answer a few questions. A staff member will review your application.',
  approve: 'You are verified in {server}. Welcome!',
  reject: 'Your verification application for {server} was not approved. You can apply again.'
};

function verifyText(custom, fallback, serverName) {
  return (custom && custom.trim() ? custom.trim() : fallback).replace(/\{server\}/g, serverName);
}

// Verification notices are plain, private, one-time messages removed after five minutes.
async function replyVerificationNotice(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    const editReply = interaction.__v2OriginalMethods?.editReply || interaction.editReply.bind(interaction);
    await editReply({ content });
  } else {
    const reply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
    await reply({ content, flags: MessageFlags.Ephemeral });
  }
  const timer = setTimeout(() => interaction.deleteReply().catch(() => {}), 5 * 60 * 1000);
  timer.unref?.();
}

async function sendVerificationDm(member, card) {
  return member.send({
    components: [card],
    flags: require('discord.js').MessageFlags.IsComponentsV2
  });
}

function verifyPanelEmbed(color, cfg) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle((cfg.panelTitle && cfg.panelTitle.trim() ? cfg.panelTitle.trim() : VERIFY_DEFAULTS.title))
    .setDescription(cfg.panelMessage && cfg.panelMessage.trim() ? cfg.panelMessage.trim() : VERIFY_DEFAULTS.message);
}

function verifyPanelRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('nx-verify-start:' + guildId)
      .setLabel('Start verification')
      .setStyle(ButtonStyle.Success)
  );
}

function verifyReviewRow(appId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('nx-verify-approve:' + appId)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('nx-verify-reject:' + appId)
      .setLabel('Reject')
      .setStyle(ButtonStyle.Danger)
  );
}

function fishProfileEmbed(profile, color) {
  const size = 10;
  const filled = Math.round((profile.xpIntoLevel / profile.xpForNext) * size);
  const bar = '█'.repeat(filled) + '░'.repeat(size - filled);
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🎣 Fishing Profile')
    .setDescription(
      '**Fishing level ' + profile.level + '**\n' +
      bar + '\n' +
      profile.xpIntoLevel.toLocaleString() + ' / ' + profile.xpForNext.toLocaleString() + ' XP to level ' + (profile.level + 1) + '\n\n' +
      'Fish caught: **' + profile.totalCaught.toLocaleString() + '**\n' +
      'Sharks: **' + profile.sharks.toLocaleString() + '**\n' +
      'Legendary fish: **' + profile.legendary.toLocaleString() + '**\n' +
      'Quests completed: **' + profile.questsDone.toLocaleString() + '**'
    )
    .setFooter({ text: 'Fishing XP comes from fish you catch and from quest rewards.' });
}

function fishProfileRow(guildId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('zeron_fish_menu:' + guildId + ':' + userId)
      .setLabel('Back to menu')
      .setStyle(ButtonStyle.Secondary)
  );
}

function fishingCatchesText(rows) {
  if (!rows.length) return 'No fish yet. Use /fish to catch some.';
  const grouped = new Map();
  for (const row of rows) {
    const entry = grouped.get(row.fish_name) || { emoji: row.emoji, count: 0, value: 0 };
    entry.count += 1;
    entry.value += row.value;
    grouped.set(row.fish_name, entry);
  }
  return [...grouped.entries()]
    .map(([name, entry]) => entry.emoji + ' **' + name + '** × ' + entry.count + ' · ' + coinText(entry.value))
    .join('\n');
}

// Fishing XP is kept slow: a fraction of the fish value, so levels take a long time.
function fishingXpFromValue(value) {
  return Math.max(1, Math.floor(value / 5));
}

// Links used in the setup message sent when ZERON joins a server.
const DASHBOARD_LINK = 'https://zeron.freesrv.com/';
const PRIVACY_LINK = 'https://zeron.freesrv.com/privacy-zeron.html';


// Sent when ZERON joins a server: DMs the person who added the bot, or the server's system channel if DMs are closed.
async function sendSetupMessage(client, guild) {
  const { AuditLogEvent } = require('discord.js');
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 }).catch(() => null);
  const entry = logs ? logs.entries.find(item => item.target && item.target.id === client.user.id) : null;
  const recipientId = entry && entry.executor ? entry.executor.id : guild.ownerId;

  const embed = new EmbedBuilder()
    .setColor(0x46BBFF)
    .setTitle('👋 Thanks for adding ZERON!')
    .setDescription('ZERON is now in **' + guild.name + '**. Here is a quick guide to set up your server.')
    .addFields(
      { name: '🌐 Dashboard', value: DASHBOARD_LINK },
      {
        name: '⚙️ Quick setup',
        value: [
          '1. Open the dashboard and select your server.',
          '2. Configure your channels in **Channel Manager**.',
          '3. Adjust modules in **General Settings**.',
          '4. Set up **Auto-role** for new members.',
          '5. Configure **Verification**, select your roles and channels, then **Post Panel**.',
          '6. Set up **AutoMod** and **Tickets** if needed.'
        ].join('\n')
      },
      {
        name: '📜 Privacy policy',
        value: 'Our privacy policy is linked in ZERON\'s bot description. Please read it before you use the dashboard: ' + PRIVACY_LINK
      },
      { name: '💬 Support server', value: 'https://discord.gg/g42heuPsmy' }
    )
    .setFooter({ text: 'ZERON • Made by YaaroX' });

  const user = recipientId ? await client.users.fetch(recipientId).catch(() => null) : null;
  let sent = false;
  if (user) {
    sent = await user.send({ components: [embedToContainer(embed, [])], flags: require('discord.js').MessageFlags.IsComponentsV2 }).then(() => true).catch(() => false);
  }
  if (!sent && guild.systemChannel) {
    const me = guild.members.me;
    if (me && guild.systemChannel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
      await guild.systemChannel.send({ components: [embedToContainer(embed, [])], flags: require('discord.js').MessageFlags.IsComponentsV2 }).catch(() => {});
    }
  }
}

// The ZERON developer account. Developer commands are visible only to this user in every server.
const DEV_ID = '1560621828982968470';

// Clears the old per-server overrides, so /devgive is a normal command and /ownergive uses the Administrator default.
// The developer check on /devgive and the owner check on /ownergive stay inside each command.
async function syncDevCommandPermissions(client, guilds) {
  const { REST, Routes } = require('discord.js');
  const rest = new REST({ version: '10' }).setToken(client.token);
  const commands = await client.application.commands.fetch().catch(() => null);
  if (!commands) return;
  const targets = ['devgive', 'ownergive'].map(name => commands.find(c => c.name === name)).filter(Boolean);
  for (const guild of guilds) {
    for (const command of targets) {
      await rest.put(Routes.guildApplicationCommandPermissions(client.user.id, guild.id, command.id), { body: { permissions: [] } })
        .catch(error => console.error('Command permission reset failed for', guild.id, command.name + ':', error.message));
      await new Promise(resolve => setTimeout(resolve, 600));
    }
  }
}

// Shared Components V2 embed conversion. Kept as a wrapper for existing callers.
function embedToContainer(embed, rows = []) {
  return convertEmbedToContainer(embed, rows);
}

// A plain message (for example a DM) as a Components V2 card: heading, body, divider, and subtext.
function textCard(heading, body, subtext, accent) {
  const djs = require('discord.js');
  const card = new djs.ContainerBuilder();
  if (accent !== undefined) card.setAccentColor(accent);
  if (heading) addV2Text(card, `### ${heading}`);
  if (body) addV2Text(card, String(body));
  if (subtext) {
    card.addSeparatorComponents(new djs.SeparatorBuilder().setDivider(true).setSpacing(djs.SeparatorSpacingSize.Small));
    addV2Text(card, `-# ${subtext}`);
  }
  return card;
}

function toV2Payload(payload, ephemeral) {
  return buildV2Payload(payload, { ephemeral, includeFlags: true });
}

// Replaces reply, update, and editReply for one interaction so its messages go out as Components V2.
// Add a key here later to keep one response family on legacy embeds while V2 stays global.
// Supported keys: command:<slash-command>, component:<custom-id-prefix>, message:<Discord-message-id>.
const LEGACY_V2_EXCLUSIONS = new Set([
  'command:starboard', // Starboard setup confirmations and errors stay as plain Discord messages.
  'command:poll', // Poll command replies use legacy payloads because poll results contain embeds.
  'command:rank', // Rank replies are image attachments; do not wrap file-only replies in an empty V2 container.
  'component:nx-poll-vote', // Poll vote updates edit legacy embeds and button rows.
  'component:nx-verify-start',
  'component:nx-verify-approve',
  'component:nx-verify-reject',
  'component:nx-verify-form',
  'component:zeron_guild_join_select', // Guild join confirmations and errors stay as plain Discord messages.
]);

function isAccessRestrictionPayload(payload) {
  const content = typeof payload === 'string' ? payload : payload && typeof payload.content === 'string' ? payload.content : '';
  return /only\s+.{1,100}\s+(?:can use|may use|is allowed to use)|only\s+.{1,100}\s+can\s+(?:run|execute|use)|you need\s+.{1,100}\s+permission|requires?\s+.{1,100}\s+permission|not authorized to use|you are not in a guild/i.test(content);
}

function v2Proxy(interaction) {
  const exclusionKeys = [];
  if (interaction.commandName) exclusionKeys.push('command:' + interaction.commandName);
  if (typeof interaction.customId === 'string') exclusionKeys.push('component:' + interaction.customId.split(':')[0]);
  if (interaction.message?.id) exclusionKeys.push('message:' + interaction.message.id);
  if (exclusionKeys.some(key => LEGACY_V2_EXCLUSIONS.has(key))) return;
  if (interaction.__v2Proxied) return;
  interaction.__v2Proxied = true;
  // Keep original methods available for deliberately legacy-only responses such as the fish cooldown notice.
  interaction.__v2OriginalMethods = {};
  for (const method of ['reply', 'update', 'editReply', 'deferReply']) {
    if (typeof interaction[method] === 'function') interaction.__v2OriginalMethods[method] = interaction[method].bind(interaction);
  }
  // Only wrap the methods this kind of interaction actually has (modal submits have no update).
  if (typeof interaction.reply === 'function') {
    const reply = interaction.reply.bind(interaction);
    interaction.reply = payload => isAccessRestrictionPayload(payload) ? reply(payload) : reply(toV2Payload(payload, !!(payload && typeof payload === 'object' && payload.ephemeral)));
  }
  if (typeof interaction.update === 'function') {
    const update = interaction.update.bind(interaction);
    interaction.update = payload => isAccessRestrictionPayload(payload) ? update(payload) : update(toV2Payload(payload, false));
  }
  if (typeof interaction.editReply === 'function') {
    const editReply = interaction.editReply.bind(interaction);
    interaction.editReply = payload => isAccessRestrictionPayload(payload) ? editReply(payload) : editReply(toV2Payload(payload, false));
  }
  if (typeof interaction.followUp === 'function') {
    const followUp = interaction.followUp.bind(interaction);
    interaction.followUp = payload => isAccessRestrictionPayload(payload) ? followUp(payload) : followUp(toV2Payload(payload, !!(payload && typeof payload === 'object' && payload.ephemeral)));
  }
  // A deferred reply must already carry the V2 flag, or the card cannot be shown when it is edited later.
  if (typeof interaction.deferReply === 'function') {
    const deferReply = interaction.deferReply.bind(interaction);
    interaction.deferReply = options => {
      const djs = require('discord.js');
      const next = { ...(options || {}) };
      const ephemeral = Boolean(next.ephemeral || (Number(next.flags || 0) & djs.MessageFlags.Ephemeral));
      delete next.ephemeral;
      next.flags = Number(next.flags || 0) | djs.MessageFlags.IsComponentsV2 | (ephemeral ? djs.MessageFlags.Ephemeral : 0);
      return deferReply(next);
    };
  }
}

function fishHomeEmbed(color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🎣 ZERON Fishing')
    .setDescription('Go fishing, collect valuable catches, and sell your fishing inventory for coins.')
    .setFooter({ text: 'Your fishing inventory is separate from your item inventory.' });
}

function shopBackRow(guildId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('zeron_shop_cats:' + guildId + ':' + userId)
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );
}

function shopCategoriesEmbed(color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🛒 Fishing Shop')
    .setDescription('🎣 **Rods:** upgrade your rod for better catches.\n🪱 **Bait:** buy bait for bonus catches.')
    .setFooter({ text: 'Bait is used up one per cast.' });
}

function shopCategoriesRow(guildId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('zeron_shop_rods:' + guildId + ':' + userId)
      .setLabel('Rods')
      .setEmoji('🎣')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('zeron_shop_bait:' + guildId + ':' + userId)
      .setLabel('Bait')
      .setEmoji('🪱')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('zeron_shop_home:' + guildId + ':' + userId)
      .setLabel('Return')
      .setStyle(ButtonStyle.Secondary)
  );
}

function rodShopEmbed(gear, balance, color) {
  const lines = Object.entries(FISH_RODS).map(([key, rod]) => {
    let status;
    if (gear.rod === key) status = '✅ Selected';
    else if (gear.owned.includes(key)) status = '🟢 Owned';
    else status = '💰 ' + coinText(rod.price);
    return '**' + rod.name + '** · ' + status + '\n' + rod.desc;
  }).join('\n\n');
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🎣 Rod Shop')
    .setDescription('Your balance: **' + coinText(balance) + '**\n\n' + lines);
}

function rodShopRows(guildId, userId, gear) {
  const options = Object.entries(FISH_RODS).map(([key, rod]) => ({
    label: rod.name,
    description: gear.rod === key ? 'Selected' : gear.owned.includes(key) ? 'Owned · select to equip' : 'Buy for ' + rod.price.toLocaleString() + ' coins',
    value: 'rod:' + key
  }));
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('zeron_shop_rod:' + guildId + ':' + userId)
        .setPlaceholder('Choose a rod')
        .addOptions(options)
    ),
    shopBackRow(guildId, userId)
  ];
}

function baitShopEmbed(stock, gear, balance, level, color) {
  const lines = Object.entries(FISH_BAIT).map(([key, bait]) => {
    const locked = bait.level && level < bait.level;
    const info = locked ? '🔒 Unlocks at fishing level ' + bait.level : coinText(bait.price) + ' for ' + bait.pack + ' bait';
    return '**' + bait.emoji + ' ' + bait.name + '** · You have: ' + (stock[key] || 0) + '\n' + bait.desc + '\n' + info;
  }).join('\n\n');
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🪱 Bait Shop')
    .setDescription(
      'Your balance: **' + coinText(balance) + '**\n' +
      'Selected bait: **' + (gear.bait ? FISH_BAIT[gear.bait].name : 'None') + '**\n\n' + lines
    )
    .setFooter({ text: 'Bait is used up one per cast.' });
}

function baitShopRows(guildId, userId, stock) {
  const buyOptions = Object.entries(FISH_BAIT).map(([key, bait]) => ({
    label: 'Buy ' + bait.name + ' x' + bait.pack,
    description: bait.price.toLocaleString() + ' coins' + (bait.level ? ' · fishing level ' + bait.level : ''),
    value: 'buy:' + key
  }));
  const useOptions = [{ label: 'No bait', description: 'Stop using bait', value: 'use:none' }].concat(
    Object.entries(FISH_BAIT)
      .filter(([key]) => (stock[key] || 0) > 0)
      .map(([key, bait]) => ({ label: 'Use ' + bait.name, description: (stock[key]) + ' left', value: 'use:' + key }))
  );
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('zeron_shop_bait_buy:' + guildId + ':' + userId)
        .setPlaceholder('Buy bait')
        .addOptions(buyOptions)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('zeron_shop_bait_use:' + guildId + ':' + userId)
        .setPlaceholder('Use bait')
        .addOptions(useOptions)
    ),
    shopBackRow(guildId, userId)
  ];
}

function fishQuestsEmbed(progress, color) {
  const lines = progress.map(q => {
    const status = q.claimed ? '✅ Done' : '⏳ In progress';
    return '**' + q.name + '** · ' + q.desc + '\n' +
      Math.min(q.value, q.target) + ' / ' + q.target + ' · ' + status + ' · reward ' + coinText(q.reward);
  }).join('\n\n');
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🏅 Fishing Quests')
    .setDescription(lines)
    .setFooter({ text: 'Rewards are paid automatically the moment you finish a quest.' });
}

function chooseFish(rodKey, baitKey) {
  const rod = FISH_RODS[rodKey] || FISH_RODS.plastic;
  const bait = baitKey ? FISH_BAIT[baitKey] : null;
  const pool = FISH_TYPES.map(fish => {
    let weight = fish.weight;
    if (fish.value >= 50) weight *= rod.rare * (bait ? bait.quality : 1);
    else if (rod.commonMult) weight *= rod.commonMult;
    return { fish, weight, value: Math.round(fish.value * rod.value) };
  });
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) return { name: entry.fish.name, emoji: entry.fish.emoji, value: entry.value };
  }
  return { name: FISH_TYPES[0].name, emoji: FISH_TYPES[0].emoji, value: FISH_TYPES[0].value };
}

function fishStartRow(guildId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('zeron_fish_start:' + guildId + ':' + userId)
      .setLabel('Start Fishing')
      .setEmoji('🎣')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('zeron_fish_menu:' + guildId + ':' + userId)
      .setLabel('Menu')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
  );
}

function fishResultRow(guildId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('zeron_fish_again:' + guildId + ':' + userId)
      .setLabel('Fish Again')
      .setEmoji('🎣')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('zeron_fish_sell:' + guildId + ':' + userId)
      .setLabel('Sell All')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('zeron_fish_menu:' + guildId + ':' + userId)
      .setLabel('Menu')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
  );
}

function fishMenuEmbed(color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('📋 Fishing Menu')
    .setDescription([
      '**🛒 Shop**',
      'Buy **rods** for better catches. Better rods attract rarer fish, and the Heavy Rod gets you far more treasure.',
      'Buy **bait** for bonus catches. Bait is used up one per cast. Leeches unlock at fishing level 5, and Magnet unlocks at fishing level 20. Your fishing level grows as you catch fish and finish quests. Open your Profile to see it.',
      '',
      '**🏅 Quests**',
      'Finish fishing goals like catching fish, sharks, or the legendary fish. Rewards are paid to your wallet automatically.',
      '',
      'Use the buttons below to open the Quests or the Shop.'
    ].join('\n'));
}

function fishMenuRow(guildId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('zeron_fish_profile:' + guildId + ':' + userId)
      .setLabel('Profile')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('zeron_fish_quests:' + guildId + ':' + userId)
      .setLabel('Quests')
      .setEmoji('🏅')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('zeron_fish_shop:' + guildId + ':' + userId)
      .setLabel('Shop')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('zeron_fish_home:' + guildId + ':' + userId)
      .setLabel('Return')
      .setStyle(ButtonStyle.Secondary)
  );
}

function fishResultEmbed(fish, inventory, color, awarded = [], bonus = null) {
  const totalValue = inventory.reduce(
    (sum, item) => sum + Number(item.value || 0), 0
  );

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🎣 ZERON Fishing')
    .setDescription(
      'You caught ' + fish.emoji + ' **' + fish.name + '**!\n' +
      'Catch value: **' + coinText(fish.value) + '**' + (bonus ? '\n🪱 Bait bonus: ' + bonus.emoji + ' **' + bonus.name + '** (' + coinText(bonus.value) + ')' : '')
    )
    .addFields(
      { name: '🐟 Fish Collected', value: String(inventory.length), inline: true },
      { name: '💰 Inventory Value', value: coinText(totalValue), inline: true }
    )
    .setFooter({ text: 'Catch more fish or sell your entire fishing inventory.' });
  if (awarded.length) embed.addFields({ name: '🏅 Quest complete', value: awarded.map(q => '**' + q.name + '** +' + coinText(q.reward)).join('\n') });
  return embed;
}

function guildMenuEmbed(db, guild, userId) {
  const membership = db.getPlayerGuild(guild.id, userId);
  const embed = new EmbedBuilder().setColor(db.accentColor(guild.id)).setTitle('⚔️ ZERON Guilds')
    .setDescription('Build a team, invite your friends, and climb the server guild rankings.\n\n**Guild creation fee:** 🪙 500 coins\n**Maximum members:** 25\n**Invite expiry:** 24 hours');
  if (membership) embed.addFields({ name: 'Your Guild', value: '**' + membership.name + '**\nRole: ' + (membership.role === 'leader' ? '👑 Leader' : '⚔️ Member') });
  else embed.addFields({ name: 'Your Guild', value: 'You are not in a guild yet.' });
  return embed;
}
// Public guild dashboard. BASE_URL overrides the default domain if set.
const GUILD_DASHBOARD_URL = (process.env.BASE_URL || 'https://zeron.freesrv.com').replace(/\/$/, '') + '/guilds';

function guildMenuRows() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('zeron_guild_create').setLabel('Create Guild · 500 coins').setEmoji('🏰').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('zeron_guild_explore').setLabel('Explore').setEmoji('🔎').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('zeron_guild_mine').setLabel('My Guild').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('zeron_guild_top').setLabel('Leaderboard').setEmoji('🏆').setStyle(ButtonStyle.Secondary)
  ), new ActionRowBuilder().addComponents(
    new ButtonBuilder().setURL(GUILD_DASHBOARD_URL).setLabel('Guild dashboard').setEmoji('🌐').setStyle(ButtonStyle.Link)
  )];
}
function guildCreateModal() {
  return new ModalBuilder().setCustomId('zeron_guild_create_modal').setTitle('Create a Guild')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_name').setLabel('Guild name').setPlaceholder('3–24 letters, numbers, spaces, _ or -').setMinLength(3).setMaxLength(24).setRequired(true).setStyle(TextInputStyle.Short)));
}
function guildInviteModal() {
  return new ModalBuilder().setCustomId('zeron_guild_invite_modal').setTitle('Invite a Member')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('invite_user').setLabel('Member username').setPlaceholder('Enter exact server username').setMinLength(2).setMaxLength(32).setRequired(true).setStyle(TextInputStyle.Short)));
}
function createClient(db) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
  });

  // Tickets: ticket types, category placement, claim, and transcript on close.
  function ticketColor(hex) {
    return parseInt(String(hex || '').replace('#', ''), 16) || 0x46BBFF;
  }

  function isTicketStaff(member, roleIds, permissions) {
    if (permissions && permissions.has(PermissionFlagsBits.ManageChannels)) return true;
    return Boolean(member) && roleIds.some(id => member.roles.cache.has(id));
  }

  async function ticketError(interaction, content) {
    if (interaction.deferred || interaction.replied) {
      return interaction.followUp({ content, ephemeral: true }).catch(() => {});
    }
    return interaction.reply({ content, ephemeral: true }).catch(() => {});
  }

  // The form a member fills in before a ticket is created.
  function ticketFormModal(type, typeId) {
    return new ModalBuilder().setCustomId('nx-ticket-form:' + typeId).setTitle(('Open: ' + type.name).slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('subject').setLabel('Subject').setStyle(TextInputStyle.Short)
            .setMinLength(3).setMaxLength(80).setRequired(true).setPlaceholder('A short title for your issue')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('description').setLabel('Describe your issue').setStyle(TextInputStyle.Paragraph)
            .setMinLength(10).setMaxLength(4000).setRequired(true).setPlaceholder('What happened, and what do you need?')
        )
      );
  }

  async function openTicket(interaction, typeId, details = null) {
    const guild = interaction.guild;
    const botMember = guild.members.me;
    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return ticketError(interaction, 'ZERON needs Manage Channels permission to create tickets.');
    }

    const type = db.getTicketType(guild.id, typeId);
    if (!type) return ticketError(interaction, 'This ticket type no longer exists. Ask an admin to post a new panel.');

    const existing = db.getOpenTicketByUser(guild.id, interaction.user.id);
    if (existing && guild.channels.cache.get(existing.channel_id)) {
      return ticketError(interaction, 'You already have an open ticket: <#' + existing.channel_id + '>');
    }
    if (existing) db.removeTicket(existing.channel_id);

    const config = db.getTicketConfig(guild.id);
    const category = config.category_id ? guild.channels.cache.get(config.category_id) : null;
    const parentId = category && category.type === ChannelType.GuildCategory ? category.id : undefined;

    const staffRoles = type.support_role_ids.filter(id => guild.roles.cache.has(id));
    const slug = value => String(value).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const name = (slug(type.name) + '-' + slug(interaction.user.username)).slice(0, 90) || 'ticket';

    const overwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ...staffRoles.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
    ];

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parentId,
      permissionOverwrites: overwrites,
      reason: 'ZERON ticket opened'
    });
    db.addTicket(guild.id, channel.id, interaction.user.id, type.id);

    const avatar = interaction.user.displayAvatarURL();
    const embed = details
      ? new EmbedBuilder()
        .setColor(db.accentColor(guild.id))
        .setAuthor({ name: interaction.user.username, iconURL: avatar })
        .setTitle('🎫 ' + type.name + '  ·  ' + details.subject)
        .setDescription(details.description.split('\n').map(line => '> ' + line).join('\n').slice(0, 4096))
        .setThumbnail(avatar)
        .addFields(
          { name: 'Opened by', value: '<@' + interaction.user.id + '>', inline: true },
          { name: 'Status', value: '🟢 Open', inline: true },
          { name: 'Opened', value: '<t:' + Math.floor(Date.now() / 1000) + ':f>', inline: true }
        )
        .setFooter({ text: 'Staff will reply soon · Use the buttons below to manage this ticket' })
        .setTimestamp()
      : new EmbedBuilder()
        .setColor(db.accentColor(guild.id))
        .setTitle('🎫 ' + type.name)
        .setDescription('Hello <@' + interaction.user.id + '>, thanks for opening a ticket.\nDescribe your issue in detail and our team will reply soon.')
        .addFields(
          { name: 'Opened by', value: '<@' + interaction.user.id + '>', inline: true },
          { name: 'Status', value: 'Open', inline: true }
        )
        .setFooter({ text: 'Use the buttons below to manage this ticket.' })
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('nx-ticket-claim').setLabel('Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('nx-ticket-close').setLabel('Close').setStyle(ButtonStyle.Danger)
    );
    await channel.send(toV2Payload({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }));
    const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
    return replyPlain({ content: '🎫 Your ticket is ready: <#' + channel.id + '>', ephemeral: true });
  }

  async function claimTicket(interaction) {
    const ticket = db.getTicketByChannel(interaction.channelId);
    if (!ticket) return ticketError(interaction, 'This channel is not an open ticket.');

    const type = db.getTicketType(interaction.guildId, ticket.type_id);
    const staffRoles = type ? type.support_role_ids : [];
    if (!isTicketStaff(interaction.member, staffRoles, interaction.memberPermissions)) {
      return ticketError(interaction, 'Only support staff can claim tickets.');
    }
    if (ticket.claimed_by) return ticketError(interaction, 'This ticket is already claimed by <@' + ticket.claimed_by + '>.');

    if (!db.claimTicket(interaction.channelId, interaction.user.id)) {
      return ticketError(interaction, 'Someone else just claimed this ticket.');
    }
    const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
    return replyPlain({ content: '✅ <@' + interaction.user.id + '> claimed this ticket.' });
  }

  async function buildTranscript(channel) {
    const messages = await channel.messages.fetch({ limit: 100 });
    return [...messages.values()].reverse().map(message => {
      const time = new Date(message.createdTimestamp).toISOString();
      const files = message.attachments.size ? ' [attachments: ' + message.attachments.map(file => file.url).join(', ') + ']' : '';
      return '[' + time + '] ' + message.author.tag + ': ' + (message.content || '') + files;
    }).join('\n');
  }

  async function closeTicket(interaction) {
    const ticket = db.getTicketByChannel(interaction.channelId);
    if (!ticket) return ticketError(interaction, 'This channel is not an open ticket.');

    const type = db.getTicketType(interaction.guildId, ticket.type_id);
    const staffRoles = type ? type.support_role_ids : [];
    const isOwner = interaction.user.id === ticket.user_id;
    if (!isOwner && !isTicketStaff(interaction.member, staffRoles, interaction.memberPermissions)) {
      return ticketError(interaction, 'Only the ticket owner or support staff can close this ticket.');
    }

    await interaction.deferReply();
    const transcript = await buildTranscript(interaction.channel).catch(() => '(transcript could not be created)');
    const config = db.getTicketConfig(interaction.guildId);
    const logChannel = config.log_channel_id ? interaction.guild.channels.cache.get(config.log_channel_id) : null;
    db.removeTicket(interaction.channelId);

    if (logChannel && logChannel.isTextBased()) {
      const logEmbed = new EmbedBuilder()
        .setColor(db.accentColor(interaction.guildId))
        .setTitle('📁 Ticket closed: ' + (type ? type.name : 'Ticket'))
        .addFields(
          { name: 'Channel', value: '#' + interaction.channel.name, inline: true },
          { name: 'Opened by', value: '<@' + ticket.user_id + '>', inline: true },
          { name: 'Closed by', value: '<@' + interaction.user.id + '>', inline: true },
          { name: 'Claimed by', value: ticket.claimed_by ? '<@' + ticket.claimed_by + '>' : 'Nobody', inline: true }
        )
        .setTimestamp();
      await logChannel.send(toV2Payload({
        embeds: [logEmbed],
        files: [new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: 'transcript-' + interaction.channel.name + '.txt' })],
        allowedMentions: { parse: [] }
      })).catch(error => console.error('Transcript send failed:', error.message));
    }

    const editPlainReply = interaction.__v2OriginalMethods?.editReply || interaction.editReply.bind(interaction);
    await editPlainReply({ content: 'Closing this ticket in 5 seconds…' });
    setTimeout(() => {
      interaction.channel.delete('ZERON ticket closed').catch(error => console.error('Ticket delete failed:', error.message));
    }, 5000);
  }

  // Leaderboard page: shows 10 members, with Prev/Next buttons and the viewer's own rank.
  function buildLeaderboard(guild, type, requestedPage, viewerId) {
    const boardType = ['xp', 'coins', 'weekly'].includes(type) ? type : 'xp';
    const pageSize = 10;
    const total = db.getLeaderboardTotal(guild.id, boardType);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(0, Number.isInteger(requestedPage) ? requestedPage : 0), totalPages - 1);
    const rows = db.getLeaderboardPage(guild.id, boardType, page * pageSize, pageSize);
    const medals = ['🥇', '🥈', '🥉'];

    const body = rows.length
      ? rows.map((row, i) => {
          const position = page * pageSize + i + 1;
          const label = position <= 3 ? medals[position - 1] : '**' + position + '.**';
          const value = boardType === 'coins'
            ? '🪙 ' + Number(row.value).toLocaleString('en-US')
            : boardType === 'weekly'
              ? row.value + ' XP this week'
              : 'Level ' + row.level + ' · ' + row.value + ' XP';
          return label + ' <@' + row.user_id + '> — ' + value;
        }).join('\n')
      : 'Nobody is ranked here yet.';

    const viewerRank = db.getLeaderboardRank(guild.id, viewerId, boardType);
    const titles = { xp: '🏆 XP Leaderboard', coins: '💰 Coins Leaderboard', weekly: '📅 Weekly XP Leaderboard' };
    const embed = new EmbedBuilder()
      .setColor(db.accentColor(guild.id))
      .setTitle(titles[boardType])
      .setDescription(body)
      .setFooter({ text: 'Page ' + (page + 1) + '/' + totalPages + ' · ' + total + ' ranked · ' + (viewerRank ? 'Your rank: #' + viewerRank : 'You are not ranked yet') });

    const nav = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('nx-lb:' + boardType + ':' + (page - 1)).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('nx-lb:' + boardType + ':' + (page + 1)).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
    );
    return { embeds: [embed], components: [nav] };
  }

  client.on(Events.GuildMemberAdd, member => db.recordMemberEvent(member.guild.id, 'join'));
  client.on(Events.GuildMemberRemove, member => db.recordMemberEvent(member.guild.id, 'leave'));

  // Birthdays: date checks, readable dates, and the daily designed announcement.
  function isValidBirthday(day, month) {
    const d = new Date(Date.UTC(2000, month - 1, day));
    return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  }

  function formatBirthday(day, month) {
    return new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  }

  async function announceBirthdays() {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const day = now.getUTCDate();
    const month = now.getUTCMonth() + 1;
    for (const config of db.listBirthdayConfigs()) {
      if (!config.enabled || !config.channel_id || config.last_sent === dateKey) continue;
      db.markBirthdayPosted(config.guild_id, dateKey);
      const guild = client.guilds.cache.get(config.guild_id);
      const channel = guild ? guild.channels.cache.get(config.channel_id) : null;
      if (!channel || !channel.isTextBased()) continue;
      const people = db.getBirthdaysOn(config.guild_id, day, month);
      if (people.length === 0) continue;

      const mentions = people.map(person => '<@' + person.user_id + '>').join(' ');
      const embed = new EmbedBuilder()
        .setColor(db.accentColor(guild.id))
        .setTitle('🎂 Happy Birthday!')
        .setDescription(config.message.replaceAll('{users}', mentions))
        .setFooter({ text: 'ZERON Birthdays' })
        .setTimestamp();
      if (people.length === 1) {
        const member = await guild.members.fetch(people[0].user_id).catch(() => null);
        if (member) embed.setThumbnail(member.displayAvatarURL({ size: 256 }));
      }
      await channel.send(toV2Payload({ embeds: [embed], allowedMentions: { users: people.map(person => person.user_id) } }))
        .catch(error => console.error('Birthday announcement failed:', error.message));
    }
  }

  // Reaction roles: emoji key is the unicode emoji, or "name:id" for custom emojis.
  function reactionKey(emoji) {
    return emoji.id ? emoji.name + ':' + emoji.id : emoji.name;
  }

  async function changeReactionRole(reaction, user, give) {
    if (user.bot) return;
    if (reaction.partial) reaction = await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const row = db.getReactionRole(reaction.message.id, reactionKey(reaction.emoji));
    if (!row) return;
    const guild = reaction.message.guild;
    if (!guild) return;
    const botMember = guild.members.me;
    const role = guild.roles.cache.get(row.role_id);
    if (!role || !botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return;
    if (role.managed || role.position >= botMember.roles.highest.position) return;
    const member = await guild.members.fetch(user.id);
    if (give) {
      await member.roles.add(role, 'ZERON reaction role');
    } else {
      await member.roles.remove(role, 'ZERON reaction role');
    }
  }

  async function starboardStarCount(reaction) {
    // The bot's own seed reaction is excluded; reaction.count already covers large reactions.
    return Math.max(0, Number(reaction.count || 0) - (reaction.me ? 1 : 0));
  }

  const starboardPublishing = new Set();

  async function refreshStarboardPost(sourceMessage, reaction, config) {
    const count = await starboardStarCount(reaction);
    const existing = db.getStarboardPost(sourceMessage.guild.id, sourceMessage.id);
    if (!existing && count < Number(config.threshold)) return;
    const destination = sourceMessage.guild.channels.cache.get(config.destination_channel_id);
    if (!destination?.isTextBased() || typeof destination.send !== 'function') return;

    const authorName = sourceMessage.member?.displayName || sourceMessage.author.globalName || sourceMessage.author.username;
    const description = sourceMessage.content || 'No text content';
    const attachmentLines = [...sourceMessage.attachments.values()].slice(0, 8)
      .map(file => `[📎 ${String(file.name || 'Attachment').slice(0, 80)}](${file.url})`);
    const body = [
      description,
      ...attachmentLines,
      '',
      `Original message: ${sourceMessage.url}`,
      `⭐ ${count} star${count === 1 ? '' : 's'}`
    ].join('\n').slice(0, 3900);
    const starboardCard = textCard(`⭐ ${authorName.slice(0, 200)}`, body, 'ZERON Starboard', db.accentColor(sourceMessage.guild.id));

    if (existing) {
      const posted = await destination.messages.fetch(existing.destination_message_id).catch(() => null);
      if (!posted) return;
      await posted.edit({ components: [starboardCard] }).catch(error => console.error('Starboard count update failed:', error.message));
      db.updateStarboardPostCount(sourceMessage.guild.id, sourceMessage.id, count);
      return;
    }

    const publishKey = sourceMessage.guild.id + ':' + sourceMessage.id;
    if (starboardPublishing.has(publishKey)) return;
    starboardPublishing.add(publishKey);
    try {
    const files = [...sourceMessage.attachments.values()].slice(0, 10).map(file => file.url);
    const djs = require('discord.js');
    const posted = await destination.send({
      components: [starboardCard],
      files,
      flags: djs.MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] }
    });
    await posted.react('⭐').catch(() => {});
    db.saveStarboardPost(sourceMessage.guild.id, sourceMessage.id, posted.id, count);
    } finally {
      starboardPublishing.delete(publishKey);
    }
  }

  async function handleStarboardReaction(reaction, user) {
    if (user.bot || reaction.emoji.name !== '⭐') return;
    if (reaction.partial) reaction = await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const sourceMessage = reaction.message;
    if (!sourceMessage.guild) return;
    const config = db.getStarboardSettings(sourceMessage.guild.id);
    if (!config || !config.enabled || sourceMessage.channel.id !== config.source_channel_id) return;
    await refreshStarboardPost(sourceMessage, reaction, config);
  }

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    changeReactionRole(reaction, user, true).catch(error => console.error('Reaction role add failed:', error.message));
    handleStarboardReaction(reaction, user).catch(error => console.error('Starboard reaction add failed:', error.message));
  });
  client.on(Events.MessageReactionRemove, (reaction, user) => {
    changeReactionRole(reaction, user, false).catch(error => console.error('Reaction role remove failed:', error.message));
    handleStarboardReaction(reaction, user).catch(error => console.error('Starboard reaction remove failed:', error.message));
  });

  async function writeLog(guild, action, targetId, reason, moderatorId) {
    try {
      db.addModLog({ guild_id: guild.id, moderator_id: moderatorId || null, target_id: targetId || null, action, reason: reason || null });
      const settings = db.getSettings(guild.id);
      const channel = settings.mod_log_channel_id && guild.channels.cache.get(settings.mod_log_channel_id);
      if (channel && channel.isTextBased()) {
        const logCard = embedToContainer(new EmbedBuilder().setColor(db.accentColor(guild.id)).setTitle(`Moderation: ${action}`)
          .addFields(
            { name: 'Target', value: targetId ? `<@${targetId}> (${targetId})` : '—', inline: true },
            { name: 'Moderator', value: moderatorId ? `<@${moderatorId}>` : 'System', inline: true },
            { name: 'Reason', value: (reason || 'No reason provided').slice(0, 1000) }
          ).setTimestamp(), []);
        await channel.send({ components: [logCard], flags: require('discord.js').MessageFlags.IsComponentsV2 });
      }
    } catch (e) { console.error('Moderation logging failed:', e.message); }
  }

  const inviteSnapshots = new Map();
  const inviteJoinQueues = new Map();

  async function readInviteSnapshot(guild) {
    const invites = await guild.invites.fetch();
    return new Map(invites.map(invite => [
      invite.code,
      { uses: Number(invite.uses || 0), maxUses: Number(invite.maxUses || 0), inviterId: invite.inviter?.id || null }
    ]));
  }

  async function refreshInviteSnapshot(guild) {
    try {
      inviteSnapshots.set(guild.id, await readInviteSnapshot(guild));
      return true;
    } catch (error) {
      console.warn(
        `Invite snapshot unavailable for guild ${guild.id}:`,
        `message=${error.message}`,
        `code=${error.code ?? error.rawError?.code ?? "unknown"}`,
        `status=${error.status ?? error.statusCode ?? "unknown"}`
      );
      return false;
    }
  }

  async function closeDuePolls() {
    for (const poll of db.getDuePolls(Date.now())) {
      if (!db.closePoll(poll.guild_id, poll.id, Date.now())) continue;
      const guild = client.guilds.cache.get(poll.guild_id);
      const channel = guild ? await guild.channels.fetch(poll.channel_id).catch(() => null) : null;
      if (!channel || !poll.message_id) continue;
      const message = await channel.messages.fetch(poll.message_id).catch(() => null);
      if (!message) continue;
      const closedPoll = { ...poll, status: 'closed' };
      await message.edit(pollV2Payload(closedPoll, db.getPollVotes(poll.id), true)).catch(error => console.error('Poll close update failed:', error.message));
    }
  }

  client.once(Events.ClientReady, async ready => {
    console.log(`ZERON online as ${ready.user.tag}`);
    const birthdayCheck = () => announceBirthdays().catch(error => console.error('Birthday check failed:', error.message));
    setTimeout(birthdayCheck, 10000);
    setInterval(birthdayCheck, 15 * 60 * 1000);
    const giveawayCheck = () => client.giveaways.checkDue().catch(error => console.error('Giveaway check failed:', error.message));
    setTimeout(giveawayCheck, 15000);
    setInterval(giveawayCheck, 30 * 1000);
    const pollCheck = () => closeDuePolls().catch(error => console.error('Poll expiry check failed:', error.message));
    setTimeout(pollCheck, 20000);
    setInterval(pollCheck, 15000);
    try {
      applyPresence(client, getPresence(db));
    } catch (error) {
      console.error('Presence failed:', error.message);
    }

    const enabledGuilds = [...ready.guilds.cache.values()].filter(guild =>
      db.getInviteTrackerSettings(guild.id)?.enabled
    );

    await Promise.allSettled(enabledGuilds.map(refreshInviteSnapshot));
  });

  client.on(Events.GuildCreate, async guild => {
    if (db.getInviteTrackerSettings(guild.id)?.enabled) {
      await refreshInviteSnapshot(guild);
    }
  });

  client.on(Events.InviteCreate, invite => {
    const snapshot = inviteSnapshots.get(invite.guild?.id);
    if (snapshot) {
      snapshot.set(invite.code, {
        uses: Number(invite.uses || 0),
        maxUses: Number(invite.maxUses || 0),
        inviterId: invite.inviter?.id || null
      });
    }
  });

  client.on(Events.InviteDelete, invite => {
    inviteSnapshots.get(invite.guild?.id)?.delete(invite.code);
  });

  // Separate from welcome handling so welcome settings cannot disable tracking.
  // Discord visibility for a server: a disabled command is hidden from everyone, an enabled one is shown again.
  async function applyCommandVisibility(guild, names) {
    const { REST, Routes } = require('discord.js');
    const rest = new REST({ version: '10' }).setToken(client.token);
    const appCommands = await client.application.commands.fetch().catch(() => null);
    if (!appCommands) return;
    const disabled = db.getDisabledCommands(guild.id);
    for (const name of names) {
      const command = appCommands.find(c => c.name === name);
      if (!command) continue;
      const permissions = [];
      if (disabled.has(name)) permissions.push({ id: guild.id, type: 1, permission: false });
      for (const memberId of db.getRestrictedUsers(guild.id, name)) {
        permissions.push({ id: memberId, type: 2, permission: false });
      }
      await rest.put(Routes.guildApplicationCommandPermissions(client.user.id, guild.id, command.id), { body: { permissions } })
        .catch(error => console.error(`Command visibility failed for /${name} in ${guild.id}:`, error.message));
      await new Promise(resolve => setTimeout(resolve, 600));
    }
  }

  // Re-apply saved disabled commands after startup, so restarts keep them hidden.
  client.once(Events.ClientReady, () => {
    setTimeout(async () => {
      for (const guild of client.guilds.cache.values()) {
        const names = [...new Set([...db.getDisabledCommands(guild.id), ...db.getRestrictedCommands(guild.id)])];
        if (names.length) await applyCommandVisibility(guild, names).catch(() => {});
      }
    }, 50000);
  });

  // Help is built for the person who asks: commands they cannot use are not listed or counted.
  function helpHiddenFor(interaction) {
    const hidden = new Set(db.getDisabledCommands(interaction.guildId));
    for (const name of db.getUserRestrictions(interaction.guildId, interaction.user.id)) hidden.add(name);
    const isOwner = interaction.user.id === interaction.guild.ownerId;
    const isDeveloper = interaction.user.id === '1560621828982968470';
    const perms = interaction.member && interaction.member.permissions ? interaction.member.permissions : null;
    const isAdmin = !!(perms && perms.has(PermissionFlagsBits.Administrator));
    for (const command of commands) {
      const json = command.toJSON();
      if (json.default_member_permissions !== undefined && json.default_member_permissions !== null) {
        const required = BigInt(json.default_member_permissions);
        const allowed = required === 0n ? isAdmin : !!(perms && perms.has(required));
        if (!allowed) hidden.add(json.name);
      }
      if (['jail', 'unjail', 'manage-cmnds', 'ownergive'].includes(json.name) && !isOwner) hidden.add(json.name);
      if (json.name === 'devgive' && !isDeveloper) hidden.add(json.name);
    }
    return hidden;
  }

  // Roblox: account created date and profile description for a known Roblox user id.
  async function fetchRobloxDetails(robloxId) {
    try {
      const res = await fetch(`https://users.roblox.com/v1/users/${robloxId}`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const data = await res.json();
      return { created: data.created, description: data.description || '' };
    } catch (error) {
      return null;
    }
  }

  // Roblox: look up a username and its headshot through Roblox's public APIs.
  async function fetchRobloxUser(username) {
    const res = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
    });
    if (!res.ok) throw new Error('Roblox lookup failed');
    const found = ((await res.json()).data || [])[0];
    if (!found) return null;
    const thumb = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${found.id}&size=150x150&format=Png&isCircular=true`);
    const thumbData = thumb.ok ? ((await thumb.json()).data || [])[0] : null;
    return { robloxId: String(found.id), username: found.name, displayName: found.displayName, avatarUrl: thumbData ? thumbData.imageUrl : null };
  }

  // Vault alerts: copies of other servers' posts land in a watched channel. Each vault rule has its own trigger and role.
  const vaultCooldown = new Map();
  const VAULT_COOLDOWN_MS = 15 * 60 * 1000;
  const vaultNotices = new Map();

  // Text inside Components V2 cards (TextDisplay blocks, sections, nested containers) so other bots' V2 alerts can be read.
  function collectComponentText(components, out = []) {
    for (const node of components || []) {
      if (!node) continue;
      if (typeof node.content === 'string') out.push(node.content);
      if (node.accessory) collectComponentText([node.accessory], out);
      collectComponentText(node.components, out);
    }
    return out;
  }
  async function checkVaultAlert(message) {
    const rules = db.getVaultRulesForChannel(message.guild.id, message.channelId);
    if (!rules.length) return;
    const parts = [message.content, ...collectComponentText(message.components)];
    for (const embed of message.embeds) {
      parts.push(embed.title, embed.description, embed.author && embed.author.name, embed.footer && embed.footer.text);
      for (const field of embed.fields || []) parts.push(field.name, field.value);
    }
    const text = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').toLowerCase();
    for (const rule of rules) {
      const trigger = `${rule.label} vault`.toLowerCase();
      if (!text.includes(trigger)) continue;
      const key = `${message.guild.id}:${rule.vault}`;
      if (Date.now() - (vaultCooldown.get(key) || 0) < VAULT_COOLDOWN_MS) continue;
      vaultCooldown.set(key, Date.now());
      const djs = require('discord.js');
      const color = db.accentColor(message.guild.id);
      const accent = typeof color === 'number' ? color : parseInt(String(color).replace('#', ''), 16);
      const detectedAt = Math.floor(Date.now() / 1000);
      const card = new djs.ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(
          `### 🚨 ${rule.label} Vault Alert\n<@&${rule.role_id}> ${rule.label} Vault has been spotted!`))
        .addSeparatorComponents(new djs.SeparatorBuilder().setDivider(true).setSpacing(djs.SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(
          '💡**Tip:** Looking to earn extra cash? Complete bank runs in the private server, then repeat the run when you’re ready. Consistent runs can help you build your cash balance!'))
        .addSeparatorComponents(new djs.SeparatorBuilder().setDivider(true).setSpacing(djs.SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(`🕒 <t:${detectedAt}:F>`));
      await message.channel.send({
        components: [card],
        flags: djs.MessageFlags.IsComponentsV2,
        allowedMentions: { roles: [rule.role_id] }
      });
    }
  }

  // Safety net: Discord rejects a request that has both embeds and the Components V2 flag.
  // If one slips through, drop the embeds and log the route, so the exact handler shows in the logs.
  {
    const V2_FLAG = 32768;
    const originalRequest = client.rest.request.bind(client.rest);
    client.rest.request = options => {
      try {
        const djs = require('discord.js');
        const body = options && options.body;
        if (body && typeof body === 'object') {
          const data = body.data && typeof body.data === 'object' ? body.data : body;
          const parts = Array.isArray(data.components) ? data.components : [];
          // A container (type 17) means the message is Components V2, even when the flag is not in this request.
          const isV2 = ((Number(data.flags) || 0) & V2_FLAG) !== 0 ||
            parts.some(part => part && (part instanceof djs.ContainerBuilder || part.type === 17 ||
              (typeof part.toJSON === 'function' && part.toJSON().type === 17)));
          if (data.embeds && isV2) {
            console.warn(`Stripped embeds from a Components V2 request: ${options.fullRoute || options.route}`);
            delete data.embeds;
          }
        }
      } catch (error) {
        // never block a request because of this check
      }
      return originalRequest(options).catch(error => {
        // Log Discord validation failures accurately; code 50035 is not always a V2 conflict.
        if (error && (error.code === 50035 || String(error.message).includes('LEGACY_FIELDS_WITH_COMPONENTS_V2'))) {
          const body = options && options.body && typeof options.body === 'object' ? options.body : {};
          const data = body.data && typeof body.data === 'object' ? body.data : body;
          const route = String(options.fullRoute || options.route || '').replace(/\/webhooks\/\d+\/[^/]+/g, '/webhooks/:application/:token');
          console.error('Discord API validation error on route:', route,
            '| code:', error.code || 'unknown', '| message:', error.message,
            '| body keys:', Object.keys(body).join(','), '| data keys:', Object.keys(data).join(','),
            '| flags:', data.flags, '| components:', Array.isArray(data.components) ? data.components.length : 0);
        }
        throw error;
      });
    };
  }

  // AI chat provider configuration. Secrets are read from environment variables, never hardcoded.
  const aiCooldown = new Map();
  const aiConversations = new Map();
  const AI_CONTEXT_TURNS = 4;
  const AI_CONTEXT_TTL = 30 * 60 * 1000;

  // Build the AI access guide from live slash-command definitions plus verified runtime guards.
  // This is prompt-only metadata: it does not change command registration or execution.
  function aiCommandAccessGuide() {
    const specialAccess = {
      devgive: 'ZERON developer account only (checked at runtime)',
      ownergive: 'this server owner only (checked at runtime)',
      jail: 'this server owner only (checked at runtime; Discord default permission is 0)',
      unjail: 'this server owner only (checked at runtime; Discord default permission is 0)',
      'manage-cmnds': 'this server owner only (checked at runtime; Discord default permission is 0)'
    };
    const permissionLabels = [
      [PermissionFlagsBits.Administrator, 'Administrator'],
      [PermissionFlagsBits.ManageGuild, 'Manage Server'],
      [PermissionFlagsBits.KickMembers, 'Kick Members'],
      [PermissionFlagsBits.BanMembers, 'Ban Members'],
      [PermissionFlagsBits.ModerateMembers, 'Moderate Members (Timeout)'],
      [PermissionFlagsBits.ManageMessages, 'Manage Messages']
    ];
    const moduleLabels = {
      module_xp: 'XP/Leveling module',
      module_economy: 'Economy module',
      module_fishing: 'Fishing module',
      module_games: 'Games module'
    };
    const botRequirements = {
      welcome: 'To deliver welcome messages, ZERON needs Send Messages in the configured welcome channel; this is a bot-side requirement, not an extra caller permission.',
      'track-invite': 'ZERON also needs Manage Server to inspect invite usage, and access to the configured log channel.',
      'enable-level-up': 'To deliver announcements, ZERON needs Send Messages in the configured announcement channel; assigning configured role rewards additionally needs Manage Roles and a reward role below ZERON’s highest role.',
      'role-reward': 'ZERON needs Manage Roles, and the reward role must be below ZERON’s highest role.',
      trivia: 'ZERON must be able to send messages in the channel for the trivia question and result.',
      poll: 'Poll creation and management require Manage Messages or Administrator; ZERON needs permission to send messages and embed links in the poll channel.',
      kick: 'ZERON needs Kick Members and its highest role must be above the target; the caller’s highest role must also be higher than the target unless the caller is the server owner.',
      ban: 'ZERON needs Ban Members and its highest role must be above the target; the caller’s highest role must also be higher than the target unless the caller is the server owner.',
      unban: 'ZERON needs Ban Members.',
      timeout: 'ZERON needs Moderate Members and its highest role must be above the target; the caller’s highest role must also be higher than the target unless the caller is the server owner.',
      untimeout: 'ZERON needs Moderate Members and its highest role must be above the target; the caller’s highest role must also be higher than the target unless the caller is the server owner.',
      purge: 'ZERON needs Manage Messages in the channel.',
      jail: 'ZERON needs Manage Roles; a jail role must be configured and manageable, and the target must be below ZERON in role hierarchy.',
      unjail: 'ZERON needs Manage Roles and must be able to restore the member’s saved roles.',
      vaultalert: 'For alert delivery, ZERON needs Send Messages in the configured alert channel.',
      vaultpost: 'A matching vault alert must exist, and ZERON must be able to post in its configured Vault Intel channel.',
      aichat: 'Enabling the channel does not itself require an API key; for AI replies to work, an AI API key must be configured and ZERON needs Send Messages in the selected channel.'
    };

    return commands.map(command => {
      const json = command.toJSON();
      let access = specialAccess[json.name];
      if (!access) {
        const raw = json.default_member_permissions;
        if (raw === '0' || raw === 0) {
          access = 'Discord default permission is 0 (not generally available); check any explicit runtime rule before describing who can use it';
        } else if (raw !== undefined && raw !== null) {
          const required = BigInt(raw);
          const labels = permissionLabels
            .filter(([flag]) => (required & BigInt(flag)) === BigInt(flag))
            .map(([, label]) => label);
          access = labels.length
            ? 'requires ' + labels.join(' and ')
            : 'has a configured Discord default permission requirement';
        } else {
          access = 'no default Discord member-permission requirement is defined';
        }
      }

      const details = [access];
      const moduleKey = COMMAND_MODULES[json.name];
      if (moduleKey) details.push('also requires the ' + (moduleLabels[moduleKey] || moduleKey) + ' to be enabled');
      if (botRequirements[json.name]) details.push(botRequirements[json.name]);
      return '/' + json.name + ': ' + details.join('; ') + '.';
    }).join('\n');
  }

  function aiSystemPrompt(compact = false) {
    const list = commands.map(c => `/${c.name}: ${c.toJSON().description}`).join('\n');
    const access = aiCommandAccessGuide();
    if (compact) {
      return [
        'You are ZERON, a friendly and natural Discord assistant. Be conversational; do not force every chat toward commands.',
        'Answer in the user’s language and mirror mixed-language messages. Support English, Hinglish, Malay, Indonesian, Filipino/Tagalog, and Bangla. Default Bangla to Banglish (Roman letters); use Bengali script when explicitly requested or clearly preferred.',
        'Use only the live commands and verified feature guide below. Never invent commands, options, prices, rewards, cooldowns, permissions, or server-specific facts. If unsure, say so.',
        'You explain features but do not execute Discord actions. Never claim to change settings, grant coins, moderate, create tickets, approve verification, or start giveaways.',
        'Never ping users or use mass mentions. Keep casual replies concise; expand when asked.',
        'Available commands:',
        list,
        '',
        'Command access rules (configured requirements, not a live check of the current user):',
        access,
        'Every slash command is server-only. Except /manage-cmnds, commands can be disabled for the whole server or restricted for an individual member; /manage-cmnds is server-owner-only and exempt from those two command-block lists. Module-linked commands also stop working when their module is off. The guide lists configured command permissions and known runtime checks, but it does not reveal the current member’s live permissions, restrictions, module settings, role hierarchy, bot permissions, or channel access. Do not guess a person’s access: explain the known rule and say the server’s current settings must be checked. Distinguish the caller’s permissions from permissions ZERON itself needs.',
        '',
        'ZERON feature guide: Dashboard/admin configuration covers channels, welcome, AutoMod, verification, auto-role, reaction roles, tickets, custom commands, embeds, scheduled announcements, leveling, and invite tracking. Moderation commands include kick, ban, unban, timeout, untimeout, and purge; jail/unjail are owner-only. Community features include rank, leaderboard, birthday, AFK, giveaways, and tickets. Economy includes pay, bank (2% base interest per 24h), inventory, transactions, profile, collectibles, and restricted devgive/ownergive. Collectibles listed in the project: Common Crystal 500, Rare Phoenix 2,500, Epic Dragon 10,000, Legendary Crown 50,000 coins. Fishing has rods, bait, catches, quests, XP/levels, and selling. Games include slots and trivia. /guild opens guild management; creation costs 500 coins and guild wars are supported. Utilities include Roblox linking, vault alerts, ping, serverinfo, and userinfo.',
        'Some features may be disabled or configured differently per server. For menu-based features, direct members to the relevant command/menu. Never promise an effect beyond what the live command displays.'
      ].join('\n');
    }
    return [
      'You are ZERON, a friendly, natural conversational assistant inside a Discord server.',
      'Talk naturally: understand greetings, jokes, short messages, follow-ups, and normal conversation. Do not force every conversation back to bot commands.',
      'You can explain ZERON features. Use only the live command list and verified feature guide below; never invent commands, settings, prices, rewards, cooldowns, permissions, or capabilities.',
      'If you do not know something about this server or ZERON, say so clearly instead of guessing.',
      'Automatically detect the user’s language and reply in that same language. Support English, Hinglish, Malay, Indonesian, Filipino/Tagalog, and Bangla.',
      'For Bangla, default to Banglish (Roman letters). Use Bengali script only when explicitly requested or clearly preferred. Mirror mixed languages naturally.',
      'Keep casual chat concise; give more detail when asked.',
      'Do not claim to have performed Discord actions unless a command or tool actually performed them.',
      'Never ping users or use mass mentions. Avoid markdown overload and use at most one emoji when it genuinely fits.',
      '',
      'Available commands:',
      list,
      '',
      'Command access rules (configured requirements, not a live check of the current user):',
      access,
      'Every slash command is server-only. Except /manage-cmnds, commands can be disabled for the whole server or restricted for an individual member; /manage-cmnds is server-owner-only and exempt from those two command-block lists. Module-linked commands also stop working when their module is off. The guide lists configured command permissions and known runtime checks, but it does not reveal the current member’s live permissions, restrictions, module settings, role hierarchy, bot permissions, or channel access. Do not guess a person’s access: explain the known rule and say the server’s current settings must be checked. Distinguish the caller’s permissions from permissions ZERON itself needs.',
      '',
      ZERON_FEATURE_KNOWLEDGE
    ].join('\n');
  }

  function aiMinimalSystemPrompt(userText = '') {
    const text = String(userText || '').toLowerCase();
    const asksZeron = /\b(zeron|help|commands|dashboard|ticket|verification|moderation|economy|coins|guild|fishing|trivia|slots|rank|leaderboard|permission|command|roblox)\b/.test(text);
    const asksAccess = /\b(permission|permissions|who can|access|owner.only|restricted|admin|moderator|role)\b/.test(text);
    const parts = [
      'You are ZERON, a friendly Discord assistant. Reply naturally and concisely in the user’s language; support English, Hinglish, Malay, Indonesian, Filipino/Tagalog, and Bangla. Default Bangla to Banglish unless Bengali script is requested.',
      'Never invent commands, features, prices, permissions, or server facts. If unsure, say so. Explain actions but never claim you performed Discord actions. Never ping users or use mass mentions.'
    ];
    if (asksZeron) parts.push('ZERON feature guide: ' + ZERON_FEATURE_KNOWLEDGE);
    if (asksZeron && asksAccess) parts.push('Configured command access rules: ' + aiCommandAccessGuide() + ' Every slash command is server-only. Except /manage-cmnds, commands can be disabled server-wide or restricted for an individual member; modules can also be off. Current member permissions and server settings are not visible to you, so never guess them.');
    return parts.join('\n');
  }

  // Removes the oldest complete conversational turn while preserving the system prompt
  // and the newest request (plus its preceding assistant answer during continuation).
  function trimOldestAiContextTurn(messages) {
    if (!Array.isArray(messages) || messages.length < 4) return null;
    const lastMessage = messages[messages.length - 1];
    const isContinuation = lastMessage?.role === 'user' &&
      /^Continue exactly where your previous response stopped\./i.test(String(lastMessage.content || ''));
    const tailSize = isContinuation ? 2 : 1;
    const end = messages.length - tailSize;
    for (let i = 1; i < end - 1; i++) {
      if (messages[i]?.role === 'user' && messages[i + 1]?.role === 'assistant') {
        return [...messages.slice(0, i), ...messages.slice(i + 2)];
      }
    }
    return null;
  }

  // Use a configurable OpenAI-compatible endpoint. Custom providers use only their configured model;
  // OpenRouter retains its existing model fallback chain for backward compatibility.
  // Read one OpenAI-compatible provider from environment variables.
  function readAiProviderConfig(prefix, isPrimary = false) {
    const get = name => (process.env[prefix + name] || '').trim();
    const key = get('API_KEY') || (isPrimary ? (process.env.OPENROUTER_API_KEY || '').trim() : '');
    const model = get('MODEL') || (isPrimary ? (process.env.OPENROUTER_MODEL || 'zai-org/GLM-5.3-Flash').trim() : '');
    const rawBaseUrl = get('BASE_URL') || (isPrimary ? 'https://proxy.gonkabroker.com/v1' : '');
    if (!key || !model || !rawBaseUrl) return null;

    const baseUrl = rawBaseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
    let parsedBaseUrl;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      console.warn(`Skipping ${prefix || 'primary AI'}: BASE_URL is not a valid URL.`);
      return null;
    }
    if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
      console.warn(`Skipping ${prefix || 'primary AI'}: BASE_URL must use HTTP or HTTPS.`);
      return null;
    }
    const isOpenRouter = parsedBaseUrl.origin === 'https://openrouter.ai' &&
      parsedBaseUrl.pathname.replace(/\/+$/, '') === '/api/v1';
    return {
      provider: get('PROVIDER') || (isOpenRouter ? 'OpenRouter' : (isPrimary ? 'Primary AI provider' : 'Backup AI provider')),
      key,
      model,
      baseUrl,
      isOpenRouter
    };
  }

  function getAiProviderConfigs() {
    const providers = [];
    const primary = readAiProviderConfig('AI_', true);
    if (primary) providers.push(primary);
    // Up to ten independently configured backups; gaps are allowed.
    for (let index = 1; index <= 10; index++) {
      const backup = readAiProviderConfig(`AI_BACKUP_${index}_`);
      if (backup) providers.push(backup);
    }
    return providers;
  }

  // Try each configured provider in order. Rate limits and temporary upstream failures
  // move to the next provider; authentication/configuration errors are surfaced directly.
  async function askAIProvider(messages) {
    const providers = getAiProviderConfigs();
    if (!providers.length) return null;

    let lastError = null;
    for (const provider of providers) {
      const models = provider.isOpenRouter
        ? [...new Set([
            provider.model,
            'google/gemini-flash-latest',
            'deepseek/deepseek-flash-latest',
            'openai/gpt-5.2-chat',
            'openai/gpt-5-chat',
            'openai/gpt-4o'
          ].filter(Boolean))]
        : [provider.model];

      for (const model of models) {
        let requestMessages = messages;
        let maxTokens = 400;
        const canCompactSystemPrompt = messages[0]?.role === 'system' && String(messages[0].content || '').startsWith('You are ZERON,');
        const compactSystemPrompt = canCompactSystemPrompt ? aiSystemPrompt(true) : null;
        const minimalSystemPrompt = canCompactSystemPrompt ? aiMinimalSystemPrompt() : null;

        for (let attempt = 0; attempt < 8; attempt++) {
          let res;
          try {
            const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` };
            if (provider.isOpenRouter) {
              headers['HTTP-Referer'] = 'https://zeronbot.freesrv.com';
              headers['X-Title'] = 'ZERON';
            }
            res = await fetch(`${provider.baseUrl}/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ model, messages: requestMessages, max_tokens: maxTokens }),
              signal: AbortSignal.timeout(60000)
            });
          } catch (error) {
            lastError = new Error(`${provider.provider} network error for ${model}: ${error.message}`);
            console.warn(`${lastError.message} Trying the next configured AI provider.`);
            break;
          }

          if (res.ok) {
            const data = await res.json();
            const choice = data.choices && data.choices[0];
            console.info(`ZERON AI response served by ${provider.provider} / ${model}.`);
            return choice && choice.message
              ? { content: String(choice.message.content || '').trim(), finishReason: choice.finish_reason || null }
              : { content: null, finishReason: null };
          }

          const detail = await res.text().catch(() => '');
          if (res.status === 402 && provider.isOpenRouter) {
            const affordableMatch = detail.match(/can only afford\s+(\d+)/i);
            const affordableTokens = affordableMatch ? Number(affordableMatch[1]) : 0;
            if (affordableTokens >= 64 && affordableTokens < maxTokens) {
              maxTokens = affordableTokens;
              console.warn(`OpenRouter can only afford ${affordableTokens} response tokens for ${model}; retrying with max_tokens=${maxTokens}.`);
              continue;
            }
          }
          if (res.status === 402 && /prompt tokens? limit exceeded/i.test(detail)) {
            const shorterMessages = trimOldestAiContextTurn(requestMessages);
            if (shorterMessages) {
              requestMessages = shorterMessages;
              console.warn(`${provider.provider} prompt exceeded the model limit for ${model}; retrying with one older conversation turn removed.`);
              continue;
            }
            if (compactSystemPrompt && requestMessages[0]?.role === 'system' &&
                requestMessages[0].content !== compactSystemPrompt) {
              requestMessages = [{ ...requestMessages[0], content: compactSystemPrompt }, ...requestMessages.slice(1)];
              console.warn(`${provider.provider} prompt still exceeds the model limit for ${model}; retrying with compact ZERON instructions.`);
              continue;
            }
            if (minimalSystemPrompt && requestMessages[0]?.role === 'system' &&
                requestMessages[0].content !== minimalSystemPrompt) {
              requestMessages = [{ ...requestMessages[0], content: minimalSystemPrompt }, ...requestMessages.slice(1)];
              console.warn(`${provider.provider} prompt still exceeds the model limit for ${model}; retrying with minimal ZERON instructions.`);
              continue;
            }
          }

          lastError = new Error(`${provider.provider} returned ${res.status} for ${model}: ${detail.slice(0, 200)}`);
          if (res.status === 429) {
            const retryAfter = res.headers.get('retry-after');
            console.warn(`${provider.provider} rate limit reached for ${model}${retryAfter ? ` (retry after ${retryAfter}s)` : ''}; trying the next configured AI provider.`);
            break;
          }
          if (res.status === 401 || res.status === 403) {
            console.warn(`${lastError.message} Provider credentials or access are invalid; skipping to the next configured AI provider.`);
            break;
          }
          if (res.status === 404 || res.status === 402 || res.status >= 500) {
            console.warn(`${lastError.message} Trying the next configured AI provider.`);
            break;
          }
          throw lastError;
        }
      }
    }
    throw lastError || new Error('No configured AI provider is currently available');
  }

  async function handleAIChat(message) {
    if (!message.guild || !message.channel || message.author.bot || message.webhookId) return;
    const enabledChannels = db.getAiChannels(message.guild.id);
    if (!enabledChannels.includes(message.channelId)) return;

    const botMentioned = message.mentions.users.has(client.user.id);
    const otherUserMentioned = [...message.mentions.users.values()].some(user => user.id !== client.user.id);
    // Resolve replies directly so replies work whether or not "mention original author" is enabled.
    const referencedMessage = message.reference
      ? await message.fetchReference().catch(() => null)
      : null;
    const isReplyToBot = Boolean(referencedMessage && referencedMessage.author.id === client.user.id);
    const isReplyToHuman = Boolean(referencedMessage && referencedMessage.author.id !== client.user.id);
    // Never jump into member-to-member chat, even when this user has an AI conversation open.
    if (otherUserMentioned || (message.reference && !referencedMessage) || isReplyToHuman) return;

    const rawText = (message.content || '').replace(new RegExp('<@!?'+client.user.id+'>', 'g'), '').trim();
    const userText = rawText.slice(0, 1500);
    if (!userText && !botMentioned) return;
    const conversationKey = message.guild.id + ':' + message.channelId + ':' + message.author.id;
    const now = Date.now();
    const history = aiConversations.get(conversationKey);
    const sessionActive = Boolean(history && history.activeUntil > now);
    const wakePattern = /^(?:(?:hey|hi|hello|yo|sup|what'?s up|whats up)[\s,!.:-]+)?zeron\b/i;
    const wakeWordUsed = wakePattern.test(rawText);
    const wakeRequested = botMentioned || wakeWordUsed;
    const endPattern = /^(?:bye|goodbye|stop|end|that's all|thats all)(?:\s+zeron)?[.!\s]*$/i;
    const endRequested = endPattern.test(rawText);
    // Continue only when the member replies to ZERON. An open session never captures ordinary chat.
    if (!wakeRequested && !isReplyToBot && !(sessionActive && endRequested)) return;

    if (endRequested && (sessionActive || isReplyToBot || wakeRequested)) {
      aiConversations.delete(conversationKey);
      return message.reply({ content: 'No problem! Just say “Hey ZERON” whenever you need me again.', allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {});
    }

    const last = aiCooldown.get(conversationKey) || 0;
    if (now - last < 3000) return;
    aiCooldown.set(conversationKey, now);
    if (!getAiProviderConfigs().length) {
      return message.reply({ content: 'The AI assistant is not configured yet. The bot owner needs to add AI_API_KEY.', allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {});
    }

    const conversation = history && now - history.updatedAt <= AI_CONTEXT_TTL ? history : { messages: [], updatedAt: now, activeUntil: now + 5 * 60 * 1000 };
    conversation.activeUntil = now + 5 * 60 * 1000;
    aiConversations.set(conversationKey, conversation);
    // Keep the system prompt task-specific: the full Wanted guide and ZERON feature
    // reference are added only when the current question actually needs them.
    const recentHistory = conversation.messages.slice(-AI_CONTEXT_TURNS * 2).map(item => ({
      role: item.role,
      content: String(item.content || '').slice(-700)
    }));
    const messages = [
      { role: 'system', content: aiMinimalSystemPrompt(userText) },
      ...recentHistory,
      { role: 'user', content: userText.slice(0, 1000) }
    ];
    await message.channel.sendTyping().catch(() => {});
    try {
      const firstResponse = await askAIProvider(messages);
      let answer = firstResponse?.content || "I'm not sure what to say to that. Could you try asking another way?";
      let finishReason = firstResponse?.finishReason || null;
      const continuationMessages = [...messages, { role: 'assistant', content: answer }];

      // If the provider stops at its output-token ceiling, continue from the exact partial answer.
      for (let part = 0; finishReason === 'length' && part < 3; part++) {
        continuationMessages.push({
          role: 'user',
          content: 'Continue exactly where your previous response stopped. Do not repeat or summarize any earlier text.'
        });
        const nextResponse = await askAIProvider(continuationMessages);
        if (!nextResponse?.content) break;
        answer += nextResponse.content;
        continuationMessages.push({ role: 'assistant', content: nextResponse.content });
        finishReason = nextResponse.finishReason || null;
      }

      const replyText = answer.replace(/@(everyone|here)/g, '@\\u200b$1');
      conversation.messages.push({ role: 'user', content: userText }, { role: 'assistant', content: replyText });
      conversation.messages = conversation.messages.slice(-AI_CONTEXT_TURNS);
      conversation.updatedAt = Date.now();
      conversation.activeUntil = Date.now() + 5 * 60 * 1000;
      aiConversations.set(conversationKey, conversation);

      // Discord messages are limited to 2,000 characters; send every part instead of silently truncating.
      const chunks = replyText.match(/[\s\S]{1,1900}/g) || [''];
      await message.reply({ content: chunks[0], allowedMentions: { repliedUser: false, parse: [] } });
      for (const chunk of chunks.slice(1)) {
        await message.channel.send({ content: chunk, allowedMentions: { repliedUser: false, parse: [] } });
      }
      if (finishReason === 'length') {
        await message.channel.send({
          content: 'I reached the response limit. Reply to my last message with **continue** and I’ll pick up from this same context.',
          allowedMentions: { parse: [] }
        });
      }
    } catch (error) {
      console.error('AI chat failed:', error.message);
      // Keep the user's unanswered turn so a retry continues with the same context.
      // Previously this turn was discarded, making the next attempt feel like a reset.
      conversation.messages.push({ role: 'user', content: userText });
      conversation.messages = conversation.messages.slice(-AI_CONTEXT_TURNS);
      conversation.updatedAt = Date.now();
      conversation.activeUntil = Date.now() + 5 * 60 * 1000;
      aiConversations.set(conversationKey, conversation);
      await message.reply({ content: 'The AI is having trouble responding right now. Your conversation is saved—reply to this message to retry without losing context.', allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {});
    }
    if (aiConversations.size > 500) {
      for (const [key, value] of aiConversations) {
        if (now - value.updatedAt > AI_CONTEXT_TTL || value.activeUntil <= now) aiConversations.delete(key);
      }
    }
    if (aiCooldown.size > 1000) {
      for (const [key, timestamp] of aiCooldown) if (now - timestamp > AI_CONTEXT_TTL) aiCooldown.delete(key);
    }
  }

  // Developer role transfers wait here for a confirm or cancel press.
  const devGivePending = new Map();

  // Phase 4: admins mention ZERON in the request channel ("@ZERON Sapphire Vault"), and the detected card is posted in that vault's intel channel.
  function vaultCard(rule, guildId) {
    const djs = require('discord.js');
    const color = db.accentColor(guildId);
    const accent = typeof color === 'number' ? color : parseInt(String(color).replace('#', ''), 16);
    const detectedAt = Math.floor(Date.now() / 1000);
    return new djs.ContainerBuilder()
      .setAccentColor(accent)
      .addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(
        `### 🚨 ${rule.label} Vault Alert\n<@&${rule.role_id}> ${rule.label} Vault has been spotted!`))
      .addSeparatorComponents(new djs.SeparatorBuilder().setDivider(true).setSpacing(djs.SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(
        '💡**Tip:** Looking to earn extra cash? Complete bank runs in the private server, then repeat the run when you’re ready. Consistent runs can help you build your cash balance!'))
      .addSeparatorComponents(new djs.SeparatorBuilder().setDivider(true).setSpacing(djs.SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(`🕒 <t:${detectedAt}:F>`));
  }

  async function postVaultNow(guild, rule) {
    const target = guild.channels.cache.get(rule.channel_id);
    if (!target || !target.isTextBased()) return false;
    vaultCooldown.set(`${guild.id}:${rule.vault}`, Date.now());
    await target.send({
      components: [vaultCard(rule, guild.id)],
      flags: require('discord.js').MessageFlags.IsComponentsV2,
      allowedMentions: { roles: [rule.role_id] }
    });
    return true;
  }

  // Stability: log problems clearly. A failed task is reported and the bot keeps running.
  process.on('unhandledRejection', error => console.error('Unhandled rejection:', error && error.stack ? error.stack : error));
  process.on('uncaughtException', error => {
    console.error('Uncaught exception, restarting:', error && error.stack ? error.stack : error);
    setTimeout(() => process.exit(1), 500);
  });
  client.on('error', error => console.error('Discord client error:', error.message));
  client.on('shardDisconnect', (event, shardId) => console.warn(`Shard ${shardId} disconnected (code ${event.code}). Reconnecting.`));
  client.on('shardReconnecting', shardId => console.warn(`Shard ${shardId} reconnecting.`));
  client.on('shardResume', shardId => console.log(`Shard ${shardId} resumed.`));

  client.nxLastHeartbeat = Date.now();
  setInterval(() => {
    if (client.ws.ping >= 0) client.nxLastHeartbeat = Date.now();
    const silentFor = Date.now() - client.nxLastHeartbeat;
    if (silentFor > 60000) {
      console.warn(`Gateway: no heartbeat for ${Math.round(silentFor / 1000)}s (status ${client.ws.status}).`);
    }
  }, 30000).unref();

  // Developer commands: apply the per-server visibility after startup, and again whenever ZERON joins a server.
  client.once(Events.ClientReady, () => {
    setTimeout(() => syncDevCommandPermissions(client, [...client.guilds.cache.values()]).catch(() => {}), 40000);
  });
  client.on(Events.GuildCreate, guild => {
    setTimeout(() => syncDevCommandPermissions(client, [guild]).catch(() => {}), 40000);
  });

  // Stats channels: rename voice channels with live counts. Discord allows about 2 renames per channel per 10 minutes,
  // so this runs every 10 minutes.
  const updateStatsChannels = async () => {
    for (const guildId of db.statsGuildIds()) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const total = guild.memberCount;
      const bots = guild.members.cache.filter(m => m.user.bot).size;
      const humans = Math.max(0, total - bots);
      for (const row of db.getStatsChannels(guildId)) {
        const channel = guild.channels.cache.get(row.channel_id);
        if (!channel) continue;
        const name = row.template
          .replace(/\{members\}/gi, total.toLocaleString('en-US'))
          .replace(/\{humans\}/gi, humans.toLocaleString('en-US'))
          .replace(/\{bots\}/gi, bots.toLocaleString('en-US'))
          .slice(0, 100);
        if (channel.name !== name) await channel.setName(name, 'ZERON stats channel').catch(() => {});
      }
    }
  };
  client.once(Events.ClientReady, () => {
    setTimeout(() => updateStatsChannels().catch(() => {}), 30000);
    setInterval(() => updateStatsChannels().catch(() => {}), 10 * 60 * 1000);
  });

  // Onboarding: a welcome card in the onboarding channel with a button to start.
  client.on(Events.GuildMemberAdd, async member => {
    if (member.user.bot) return;
    const cfg = db.getOnboardingConfig(member.guild.id);
    if (!cfg.enabled || !cfg.channelId) return;
    const channel = member.guild.channels.cache.get(cfg.channelId);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setColor(db.accentColor(member.guild.id))
      .setTitle('👋 Welcome to ' + member.guild.name)
      .setDescription(member.toString() + ', take a minute to read the rules and pick your roles.');
    await channel.send(toV2Payload({
      content: member.toString(),
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('onb:start:' + member.guild.id + ':' + member.id)
          .setLabel('Start onboarding')
          .setStyle(ButtonStyle.Primary)
      )]
    })).catch(() => {});
  });

  client.on(Events.GuildMemberAdd, member => {
    const guildId = member.guild.id;
    if (Number(db.getSettings(guildId).module_invites) === 0) return;
    const previous = inviteJoinQueues.get(guildId) || Promise.resolve();

    const current = previous.catch(() => {}).then(async () => {
      try {
        const settings = db.getInviteTrackerSettings(guildId);
        if (!settings?.enabled || !settings.channel_id) return;

        let inviterId = null;
        try {
          const before = inviteSnapshots.get(guildId);
          const after = await readInviteSnapshot(member.guild);
          inviteSnapshots.set(guildId, after);

          if (before) {
            const candidates = [];
            for (const [code, invite] of after) {
              const old = before.get(code);
              if (old && invite.uses > old.uses) candidates.push(invite);
            }
            // An invite used up to its limit is deleted by Discord, so it is matched from the earlier snapshot.
            for (const [code, old] of before) {
              if (!after.has(code) && old.maxUses > 0 && old.uses + 1 >= old.maxUses) candidates.push(old);
            }
            if (candidates.length === 1 && candidates[0].inviterId) {
              inviterId = candidates[0].inviterId;
            }
          }
        } catch (error) {
          console.warn('Invite attribution unavailable:', error.message);
        }

        const joinedAt = (member.joinedAt || new Date()).toISOString();
        const total = db.recordTrackedInvite(guildId, member.id, inviterId, joinedAt);

        const channel = await member.guild.channels.fetch(settings.channel_id).catch(() => null);
        if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') return;

        const inviterText = inviterId ? `<@${inviterId}>` : 'Unknown';
        const totalText = total === null ? 'Unknown' : String(total);

        const joinedTimestamp = Math.floor(new Date(joinedAt).getTime() / 1000);
        const embed = new EmbedBuilder()
          .setColor(db.accentColor(member.guild.id))
          .setTitle('📨 New Member Joined')
          .setDescription(
            `**Member:** <@${member.id}>\n` +
            `**Invited by:** ${inviterText}\n` +
            `**Tracked invites:** ${totalText}\n` +
            `**Joined:** <t:${joinedTimestamp}:R>`
          );

        // The bot must be able to see, write, and embed in the tracker channel, or nothing shows up.
        const me = member.guild.members.me;
        const perms = me ? channel.permissionsFor(me) : null;
        if (!perms || !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
          console.warn(`Invite tracker: ZERON needs View Channel, Send Messages and Embed Links in #${channel.name} (${channel.id}).`);
          return;
        }
        await channel.send({ components: [embedToContainer(embed, [])], flags: require('discord.js').MessageFlags.IsComponentsV2 }).catch(error => {
          console.error(`Invite tracker could not post in #${channel.name} (${channel.id}):`, error.message);
        });
      } catch (error) {
        console.error('Invite tracker failed:', error.message);
      }
    });

    inviteJoinQueues.set(guildId, current);
    current.then(() => {
      if (inviteJoinQueues.get(guildId) === current) inviteJoinQueues.delete(guildId);
    }).catch(error => console.error('Invite queue failed:', error.message));
  });

  // When verification is on, every new member gets the unverified role right away.
  // The approve button later removes it and gives the verified role.
  async function giveUnverifiedOnJoin(member) {
    if (member.user.bot) return;
    const cfg = db.getVerificationConfig(member.guild.id);
    if (!cfg.enabled || !cfg.unverifiedRoleId) return;
    const role = member.guild.roles.cache.get(cfg.unverifiedRoleId);
    const botMember = member.guild.members.me;
    if (!role || !botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return;
    if (role.position >= botMember.roles.highest.position || member.roles.cache.has(role.id)) return;
    await member.roles.add(role, 'ZERON verification: unverified on join');
  }

  client.on(Events.GuildMemberAdd, async member => {
    try {
      await giveUnverifiedOnJoin(member).catch(error => console.error('Unverified role on join failed:', error.message));
      const s = db.getSettings(member.guild.id);
      if (!Number(s.autorole_enabled)) return;
      const roleIds = db.getAutoRoles(member.guild.id);
      if (roleIds.length === 0) return;
      const botMember = member.guild.members.me;
      if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return;
      const roles = roleIds
        .map(id => member.guild.roles.cache.get(id))
        .filter(role => role && !role.managed && role.id !== member.guild.id && role.position < botMember.roles.highest.position);
      if (roles.length === 0) return;
      await member.roles.add(roles, 'ZERON auto-role on join');
    } catch (error) {
      console.error('Auto-role failed:', error.message);
    }
  });

  client.on(Events.GuildMemberAdd, async member => {
    try {
      const s = db.getSettings(member.guild.id);
      if (!s.welcome_enabled || !s.welcome_channel_id || Number(s.module_welcome) === 0) return;
      const channel = member.guild.channels.cache.get(s.welcome_channel_id);
      if (!channel || !channel.isTextBased()) return;
      const content = s.welcome_message
        .replaceAll('{user}', `<@${member.id}>`)
        .replaceAll('{username}', member.user.username)
        .replaceAll('{server}', member.guild.name)
        .slice(0, 1900);
      await channel.send(toV2Payload({ content }));
    } catch (e) { console.error('Welcome handler failed:', e.message); }
  });

  const recentXpMessages = new Map();
  const spamDuplicateTracker = new Map();
  const spamBurstTracker = new Map();
  const spamWarningCooldown = new Map();
  const fishingAgainCooldowns = new Map();
const fishWaitMessages = new Map();

  client.once(Events.ClientReady, () => removeCoinEmoji(client).catch(error => console.error('Coin emoji cleanup failed:', error.message)));
  client.once(Events.ClientReady, () => syncGlobalCommands(client).catch(error => console.error('Command sync failed:', error.message)));
  client.verification = {
    postPanel: async guildId => {
      const cfg = db.getVerificationConfig(guildId);
      const guild = client.guilds.cache.get(guildId);
      if (!guild) throw new Error('Server not found.');
      const channel = guild.channels.cache.get(cfg.panelChannelId);
      if (!channel) throw new Error('Choose a panel channel first.');
      await channel.send(toV2Payload({ embeds: [verifyPanelEmbed(db.accentColor(guildId), cfg)], components: [verifyPanelRow(guildId)] }));
      return true;
    }
  };
  // Posts due announcements once a minute, using each server's own time zone.
  // Do not let a slow run overlap the next interval and send the same due job twice.
  client.once(Events.ClientReady, () => {
    let announcementCheckRunning = false;
    setInterval(async () => {
      if (announcementCheckRunning) return;
      announcementCheckRunning = true;
      try {
        const now = Date.now();
        for (const job of db.dueAnnouncements(now)) {
          try {
            const guild = client.guilds.cache.get(job.guild_id);
            const channel = guild ? guild.channels.cache.get(job.channel_id) : null;
            if (!channel) {
              db.markAnnouncementFailed(job.id, 'Channel not found');
              continue;
            }
            const payload = job.use_embed
              ? { embeds: [new EmbedBuilder().setColor(db.accentColor(job.guild_id)).setTitle(job.title || 'Announcement').setDescription(job.body)] }
              : { content: job.title ? '**' + job.title + '**\n' + job.body : job.body };
            await channel.send(toV2Payload(payload));
            const timezone = db.getAnnouncementTimezone(job.guild_id);
            const next = job.repeat_mode === 'once'
              ? null
              : nextOccurrence(job.start_date, job.time_of_day, job.repeat_mode, timezone, now);
            db.markAnnouncementSent(job.id, now, next);
          } catch (error) {
            db.markAnnouncementFailed(job.id, error.message);
          }
        }
      } finally {
        announcementCheckRunning = false;
      }
    }, 60000);
  });
  client.on(Events.GuildCreate, guild => sendSetupMessage(client, guild).catch(error => console.error('Setup message failed:', error.message)));
  client.giveaways = createGiveawayService(client, db);

  // Automod: removes bad words, links and mention spam. Staff with Manage Messages are exempt.
  const automodStrikes = new Map();
  const AUTOMOD_LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

  function normalizeAutomod(text) {
    return String(text).toLowerCase().replace(/[013457@$!]/g, c => AUTOMOD_LEET[c]).replace(/(.)\1+/g, '$1');
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function automodViolation(message, cfg) {
    const raw = message.content || '';
    if (raw.length === 0) return null;

    const normalized = normalizeAutomod(raw);
    for (const word of cfg.bad_words) {
      const normWord = normalizeAutomod(word);
      // Letters may be split by spaces or dots (b a d or b.a.d), but the word must stand on its own.
      const body = normWord.split('').map(ch => ch === ' ' ? '[\\s._\\-*]+' : escapeRegex(ch)).join('[\\s._\\-*]*');
      const pattern = new RegExp('(^|[^a-z0-9])' + body + '([^a-z0-9]|$)');
      if (pattern.test(normalized)) return 'Blocked word';
    }

    if (cfg.link_mode === 'all' && /(https?:\/\/|www\.)\S+/i.test(raw)) return 'Links are not allowed';
    if (cfg.link_mode !== 'off' && /discord(?:\.gg|(?:app)?\.com\/invite)\/\S+/i.test(raw)) return 'Discord invites are not allowed';
    if (cfg.max_mentions > 0 && message.mentions.users.size > cfg.max_mentions) return 'Too many mentions';
    return null;
  }

  async function runAutomod(message) {
    const cfg = db.getAutomodConfig(message.guild.id);
    if (!cfg.enabled) return false;
    if (message.member && message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
    const reason = automodViolation(message, cfg);
    if (!reason) return false;

    await message.delete().catch(() => {});
    const key = message.guild.id + ':' + message.author.id;
    const now = Date.now();
    const previous = automodStrikes.get(key);
    const inWindow = previous && now - previous.first < 10 * 60000;
    const strikes = inWindow ? previous.count + 1 : 1;
    automodStrikes.set(key, { count: strikes, first: inWindow ? previous.first : now });

    const notice = await message.channel.send(toV2Payload({
      content: '🛡️ <@' + message.author.id + '>, your message was removed: ' + reason + '.',
      allowedMentions: { users: [message.author.id] }
    })).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 8000);

    await writeLog(message.guild, 'automod', message.author.id, reason, client.user.id).catch(() => {});
    if (cfg.strike_limit > 0 && strikes >= cfg.strike_limit && message.member) {
      automodStrikes.delete(key);
      await message.member.timeout(cfg.timeout_minutes * 60000, 'Automod: ' + strikes + ' strikes').catch(() => {});
      await writeLog(message.guild, 'automod_timeout', message.author.id, 'Reached ' + strikes + ' strikes', client.user.id).catch(() => {});
    }
    return true;
  }

  // Custom commands: cooldown per member per command (5 seconds) so chat cannot be spammed.
  const customCommandCooldowns = new Map();

  async function sendCustomCommand(channel, command) {
    if (command.kind === 'embed') {
      const { buildEmbedCard } = require('./embed-card');
      const card = buildEmbedCard({
        title: command.title,
        description: command.content,
        imageUrl: command.image_url,
        colorHex: db.accentHex(channel.guild.id)
      });
      return channel.send({ components: [card], flags: require('discord.js').MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    }
    return channel.send(toV2Payload({ content: command.content, allowedMentions: { parse: [] } }));
  }

  client.on(Events.MessageCreate, async message => {
    // Checked before the bot filter, because followed channels post as webhooks
    if (message.guild && message.author.id !== client.user.id) {
      await checkVaultAlert(message).catch(error => console.error('Vault alert failed:', error.message));
      await handleAIChat(message).catch(error => console.error('AI chat error:', error.message));
    }
    if (!message.guild || message.author.bot) return;

    // In the configured source channel, seed each member message with a ⭐ reaction.
    try {
      const starboard = db.getStarboardSettings(message.guild.id);
      if (starboard?.enabled && message.channel.id === starboard.source_channel_id) {
        await message.react('⭐').catch(error => console.error('Starboard seed reaction failed:', error.message));
      }
    } catch (error) {
      console.error('Starboard source-message handler failed:', error.message);
    }

    // Anyone who mentions an AFK member gets a short reply with the reason and how long they have been away.
    try {
      const mentioned = [...message.mentions.users.values()]
        .filter(user => !user.bot && user.id !== message.author.id)
        .slice(0, 5);
      if (mentioned.length) {
        const rows = db.getAfkForUsers(message.guild.id, mentioned.map(user => user.id));
        if (rows.length) {
          const lines = rows.map(row => {
            const user = mentioned.find(item => item.id === row.user_id);
            const minutes = Math.max(1, Math.round((Date.now() - row.since) / 60000));
            const ago = minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
            return `💤 **${user ? user.username : 'That member'}** is AFK: ${row.reason} (${ago} ago)`;
          });
          await message.reply(toV2Payload({ content: lines.join('\n'), allowedMentions: { repliedUser: false, parse: [] } })).catch(() => {});
        }
      }
    } catch (error) {
      console.error('AFK mention reply failed:', error.message);
    }

    try {
      const s = db.getSettings(message.guild.id);
      const now = Date.now();
      const rawContent = message.content.trim();
      const content = rawContent.toLowerCase();

      // Trivia: the first correct answer in the trivia channel wins the reward.
      const activeTrivia = db.getActiveTrivia(message.guild.id);
      if (activeTrivia && message.channel.id === activeTrivia.channel_id) {
        if (Date.now() > activeTrivia.ends_at) {
          db.endTrivia(activeTrivia.id, 'expired');
        } else {
          const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
          const accepted = activeTrivia.answer.split('|').map(normalize).filter(Boolean);
          if (accepted.includes(normalize(rawContent))) {
            if (db.winTrivia(activeTrivia.id, message.author.id)) {
              db.addCoins(message.guild.id, message.author.id, activeTrivia.reward, 'trivia reward');
              await message.reply({ content: `✅ ${message.author} got it! Correct answer: ${activeTrivia.answer.split('|')[0]}. You earned ${coinText(activeTrivia.reward)}.`, allowedMentions: { repliedUser: false } }).catch(() => {});
            }
          }
        }
      }

      db.recordMessage(message.guild.id, Date.now());

      // Automod runs first, so removed messages never earn XP or trigger commands.
      if (await runAutomod(message)) return;

      // Custom commands: "<prefix><name>" replies with the saved text or embed.
      const commandPrefix = s.prefix || '!';
      if (rawContent.startsWith(commandPrefix) && rawContent.length > commandPrefix.length) {
        const typedName = rawContent.slice(commandPrefix.length).split(/\s+/)[0].toLowerCase();
        const custom = db.getCustomCommand(message.guild.id, typedName);
        if (custom) {
          const cooldownKey = message.guild.id + ':' + message.author.id + ':' + typedName;
          if (now - (customCommandCooldowns.get(cooldownKey) || 0) < 5000) return;
          customCommandCooldowns.set(cooldownKey, now);
          await sendCustomCommand(message.channel, custom);
          return;
        }
      }

      // Spam protection runs independently of XP and is OFF by default.
      if (s.spam_enabled && rawContent) {
        const member = message.member;
        const trusted = member?.permissions?.has(PermissionFlagsBits.ManageMessages);
        if (!trusted) {
          const memberKey = `${message.guild.id}:${message.channel.id}:${message.author.id}`;
          const burst = (spamBurstTracker.get(memberKey) || [])
            .filter(timestamp => now - timestamp < 5000);
          burst.push(now);
          spamBurstTracker.set(memberKey, burst);

          const normalized = content.replace(/\s+/g, ' ');
          const duplicateKey = memberKey + ':' + normalized;
          const duplicate = spamDuplicateTracker.get(duplicateKey);
          const duplicateCount = duplicate && now - duplicate.firstAt < 15000
            ? duplicate.count + 1
            : 1;
          spamDuplicateTracker.set(duplicateKey, {
            count: duplicateCount,
            firstAt: duplicate && now - duplicate.firstAt < 15000 ? duplicate.firstAt : now
          });

          let reason = '';
          if (duplicateCount >= 3) {
            reason = 'Repeated identical message (3 or more within 15 seconds)';
          } else if (burst.length >= 5) {
            reason = 'Message burst (5 messages within 5 seconds)';
          }

          if (reason) {
            const strike = s.strike_enabled
              ? db.recordSpamStrike(message.guild.id, message.author.id, now)
              : null;
            const strikeReason = strike
              ? `Strike ${strike.strikes}/3: ${reason}`
              : `Strike system OFF: ${reason}`;

            try {
              if (message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
                await message.delete();
              }
            } catch (error) {
              console.error('Spam message deletion failed:', error.message);
            }

            try {
              writeLog(message.guild, 'AutoMod Spam Detected', message.author.id, strikeReason, null);
            } catch (error) {
              console.error('Spam logging failed:', error.message);
            }

            if (strike && strike.strikes >= 3) {
              try {
                const botMember = message.guild.members.me;
                if (
                  botMember?.permissions.has(PermissionFlagsBits.ModerateMembers) &&
                  member?.moderatable &&
                  member.id !== message.guild.ownerId
                ) {
                  await member.timeout(
                    10 * 60 * 1000,
                    `ZERON AutoMod: ${reason} (strike ${strike.strikes})`
                  );
                  await writeLog(
                    message.guild,
                    'AutoMod Spam Timeout',
                    message.author.id,
                    `10-minute timeout applied after ${strike.strikes} strikes. ${reason}`,
                    null
                  );
                } else {
                  console.warn(
                    'Spam timeout skipped: missing Moderate Members permission or member is not moderatable.'
                  );
                }
              } catch (error) {
                console.error('Spam timeout failed:', error.message);
              }
            }

            const warningKey = message.channel.id + ':' + message.author.id;
            if (now - (spamWarningCooldown.get(warningKey) || 0) > 8000) {
              spamWarningCooldown.set(warningKey, now);
              try {
                const warning = await message.channel.send(toV2Payload({
                  content: `⚠️ <@${message.author.id}> Please stop spamming. Further spam may result in moderation action.`
                }));
                setTimeout(() => warning.delete().catch(() => {}), 6000);
              } catch (error) {
                console.error('Spam warning failed:', error.message);
              }
            }
            return; // Detected spam must not earn XP.
          }

          if (spamDuplicateTracker.size > 3000) spamDuplicateTracker.clear();
          if (spamBurstTracker.size > 3000) spamBurstTracker.clear();
        }
      }

      if (!s.xp_enabled || Number(s.module_xp) === 0) return;


      // Premium XP channel filter: when channels are selected, only those earn XP.
      const allowedXpChannels = parseChannelIds(s.xp_channel_ids);
      if (allowedXpChannels.length > 0) {
        const inAllowedChannel =
          allowedXpChannels.includes(message.channel.id) ||
          (message.channel.isThread?.() && allowedXpChannels.includes(message.channel.parentId));
        if (!inAllowedChannel) return;
      }

      // Ignore empty messages and messages without meaningful text.
      if (!content) return;

      const key = `${message.guild.id}:${message.author.id}`;
      const previous = recentXpMessages.get(key);

      // Identical messages from the same member: no XP for 10 minutes.
      if (
        previous &&
        previous.content === content &&
        now - previous.timestamp < 10 * 60 * 1000
      ) {
        return;
      }

      const row = db.getXp(message.guild.id, message.author.id);

      // Keep the existing dashboard-configured cooldown (default: 60 seconds).
      if (now - (row.last_message_at || 0) < s.xp_cooldown * 1000) {
        return;
      }

      const configuredMin = Number(s.xp_min);
      const configuredMax = Number(s.xp_max);
      const xpMin = Number.isInteger(configuredMin) && configuredMin >= 1 && configuredMin <= 100
        ? configuredMin
        : 10;
      const xpMaxCandidate = Number.isInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 100
        ? configuredMax
        : 20;
      const xpMax = Math.max(xpMin, xpMaxCandidate);
      const baseXp = Math.floor(Math.random() * (xpMax - xpMin + 1)) + xpMin;

      // Messages with at least 200 characters earn double XP.
      const amount = content.length >= 200 ? baseXp * 2 : baseXp;

      recentXpMessages.set(key, { content, timestamp: now });

      // Prevent the map growing indefinitely.
      if (recentXpMessages.size > 5000) {
        for (const [storedKey, value] of recentXpMessages) {
          if (now - value.timestamp > 10 * 60 * 1000) {
            recentXpMessages.delete(storedKey);
          }
        }
      }

      const result = db.addXp(
        message.guild.id,
        message.author.id,
        amount,
        now
      );
      syncAchievements(db, message.guild.id, message.author.id);

      // Guilds gain progression XP when a member earns normal server XP.
      db.addPlayerGuildXp(message.guild.id, message.author.id, 1);

      let grantedRewards = [];
      // Level rewards are granted whether or not level-up announcements are enabled.
      if (result.level > result.previousLevel) {
        grantedRewards = await grantLevelRewards(db, message, result.level).catch(error => {
          console.error('Level reward grant failed:', error.message);
          return [];
        });
      }

      if (result.level > result.previousLevel && s.levelup_enabled) {
        const channelId = s.xp_channel_id || message.channel.id;
        const channel = message.guild.channels.cache.get(channelId);

        if (channel && channel.isTextBased()) {
          const template = String(s.levelup_message || '🎉 Congratulations {user}! You reached level {level} in {server}!');
          const rewardText = grantedRewards.map(id => '<@&' + id + '>').join(', ');
          let announcement = template
            .replaceAll('{user}', '<@' + message.author.id + '>')
            .replaceAll('{username}', message.author.username)
            .replaceAll('{server}', message.guild.name)
            .replaceAll('{level}', String(result.level))
            .replaceAll('{reward}', rewardText);
          if (rewardText && !template.includes('{reward}')) announcement += '\n🎁 You earned ' + rewardText + '!';
          await channel.send(toV2Payload({
            embeds: [new EmbedBuilder().setColor(db.accentColor(message.guild.id)).setDescription(announcement)],
            allowedMentions: { parse: [] }
          }));
        }
      }
    } catch (e) {
      console.error('XP handler failed:', e.message);
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    // Global Components V2: all bot interaction responses and component updates use V2 by default.
    // Legacy exceptions are centralized in LEGACY_V2_EXCLUSIONS above for future per-message opt-outs.
    v2Proxy(interaction);
    // Components V2 is enabled only for the specific flows that need it.
    // Ordinary commands such as /rank must keep their native Discord response payloads.
    try {
      if (interaction.isButton() && interaction.customId.startsWith('zeron_guild_') && !interaction.customId.startsWith('zeron_guild_accept:') && !interaction.customId.startsWith('zeron_guild_war_respond:')) {
        if (!interaction.guildId || !interaction.guild) return interaction.reply({ content: 'Guilds only work inside a server.', ephemeral: true });
        const action = interaction.customId.slice('zeron_guild_'.length);
        if (action === 'create') return interaction.showModal(guildCreateModal());
        if (action === 'explore') {
          const rows = db.listPlayerGuilds(interaction.guildId, 10);
          if (!rows.length) return interaction.update({ embeds: [new EmbedBuilder().setColor(db.accentColor(interaction.guildId)).setTitle('🔎 Explore Guilds').setDescription('No guilds exist yet. Be the first to create one!')], components: guildMenuRows() });
          const options = rows.slice(0, 25).map(g => ({ label: g.name.slice(0, 100), description: `${g.member_count}/25 members · Leader <@${g.leader_id}>`.slice(0, 100), value: String(g.id) }));
          const menu = new StringSelectMenuBuilder().setCustomId('zeron_guild_join_select').setPlaceholder('Choose a guild to join').addOptions(options);
          return interaction.update({ embeds: [new EmbedBuilder().setColor(db.accentColor(interaction.guildId)).setTitle('🔎 Explore Guilds').setDescription('Choose a guild below. You must have an active invitation from its leader to join.')], components: [new ActionRowBuilder().addComponents(menu), ...guildMenuRows()] });
        }
        if (action === 'mine') {
          const g = db.getPlayerGuild(interaction.guildId, interaction.user.id);
          if (!g) {
            const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
            return sendPlainReply({ content: 'You are not in a guild. Use `/guild` and choose **Create Guild** or explore existing guilds.', ephemeral: true });
          }
          const members = db.getPlayerGuildMembers(interaction.guildId, g.id);
          const desc = members.slice(0, 20).map(m => `${m.role === 'leader' ? '👑' : '⚔️'} <@${m.user_id}>`).join('\n');
          const embed = new EmbedBuilder().setColor(db.accentColor(interaction.guildId)).setTitle('🏰 ' + g.name)
            .setDescription(`Leader: <@${g.leader_id}>\nMembers: **${members.length}/25**\nCreated: <t:${Math.floor(g.created_at / 1000)}:D>\n\n${desc || 'No members yet.'}`)
            .setFooter({ text: g.role === 'leader' ? 'You are the guild leader.' : 'You are a guild member.' });
          // Discord allows at most 5 buttons in each action row.
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('zeron_guild_invite').setLabel('Invite Member').setEmoji('✉️').setStyle(ButtonStyle.Primary).setDisabled(g.role !== 'leader' || members.length >= 25),
            new ButtonBuilder().setCustomId('zeron_guild_leave').setLabel('Leave Guild').setStyle(ButtonStyle.Secondary).setDisabled(g.role === 'leader'),
            new ButtonBuilder().setCustomId('zeron_guild_disband').setLabel('Disband').setStyle(ButtonStyle.Danger).setDisabled(g.role !== 'leader'),
            new ButtonBuilder().setCustomId('zeron_guild_bank').setLabel('Guild Bank').setEmoji('🏦').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('zeron_guild_progress').setLabel('Guild Progress').setEmoji('📈').setStyle(ButtonStyle.Secondary)
          );
          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('zeron_guild_war').setLabel('Guild War').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('zeron_guild_rewards').setLabel('Level Rewards').setEmoji('🎁').setStyle(ButtonStyle.Success)
          );
          return interaction.reply({ embeds: [embed], components: [row, row2], ephemeral: true });
        }
        if (action === 'top') {
          const rows = db.getPlayerGuildLeaderboard(interaction.guildId, 10);
          const lines = rows.map((g, i) => `**${i + 1}. ${g.name}** — ${g.member_count}/25 members · Leader <@${g.leader_id}>`);
          return interaction.update({ embeds: [new EmbedBuilder().setColor(db.accentColor(interaction.guildId)).setTitle('🏆 Guild Leaderboard').setDescription(lines.join('\n') || 'No guilds yet.')], components: guildMenuRows() });
        }
        if (action === 'war') {
          const own = db.getPlayerGuild(interaction.guildId, interaction.user.id);
          if (!own) return interaction.reply({ content: 'You are not in a guild.', ephemeral: true });
          const rows = db.listPlayerGuilds(interaction.guildId, 10).filter(g => g.id !== own.id);
          const wars = db.listGuildWars(interaction.guildId, own.id);
          const summary = wars.map(w => `• **${w.challenger_name} vs ${w.opponent_name}** — ${w.status}${w.status === 'completed' ? ` (${w.challenger_score}-${w.opponent_score})` : ''}`).join('\n');
          if (own.role !== 'leader') return interaction.reply({ content: 'Only guild leaders can start or accept wars. Recent wars:\n' + (summary || 'No wars yet.'), ephemeral: true });
          if (!rows.length) return interaction.reply({ content: 'You need at least one other guild in this server to start a war.', ephemeral: true });
          const menu = new StringSelectMenuBuilder().setCustomId('zeron_guild_war_opponent').setPlaceholder('Choose a fishing war opponent').addOptions(rows.slice(0,12).map(g => ({ label: `${g.name} · Fishing`.slice(0,100), description: `${g.member_count}/25 members · catches only`, value: `${g.id}:fishing` })));
          const components = [new ActionRowBuilder().addComponents(menu)];
          const activeWars = wars.filter(w => w.status === 'active');
          for (const w of activeWars.slice(0, 4)) components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`zeron_guild_war_finish:${w.id}:${interaction.user.id}`).setLabel(Date.now() >= w.ends_at ? `Finalize: ${w.challenger_name} vs ${w.opponent_name}`.slice(0,80) : `War running: ends <t:${Math.floor(w.ends_at/1000)}:R>`).setStyle(ButtonStyle.Secondary).setDisabled(Date.now() < w.ends_at)));
          return interaction.reply({ content: `⚔️ **Guild Wars**\nChoose an opponent for a Fishing War. It starts when the opponent leader accepts and runs for 24 hours. The guild with more new catches wins.\n\n${summary || 'No previous wars.'}`, components, ephemeral: true });
        }
        if (action === 'rewards') {
          const own = db.getPlayerGuild(interaction.guildId, interaction.user.id);
          if (!own) return interaction.reply({ content: 'You are not in a guild.', ephemeral: true });
          const granted = db.claimPlayerGuildLevelRewards(interaction.guildId, own.id);
          const p = db.getPlayerGuildProgress(interaction.guildId, own.id);
          const lines = ['Level 2 — 500 coins to guild bank','Level 3 — 1,000 coins to guild bank','Level 5 — 2,500 coins to guild bank','Level 10 — 5,000 coins to guild bank'];
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(db.accentColor(interaction.guildId)).setTitle(`🎁 ${own.name} Level Rewards`).setDescription((granted.length ? `**New rewards claimed:**\n${granted.map(r => `• Level ${r.level}: +${r.coins.toLocaleString()} coins`).join('\n')}\n\n` : 'No new level rewards to claim.\n\n') + `Current level: **${p.level}**\n\n**Reward track**\n${lines.join('\n')}\n\nEach reward is granted once and deposited into the guild bank.`)], ephemeral: true });
        }
        if (action === 'bank') {
          const g = db.getPlayerGuild(interaction.guildId, interaction.user.id);
          if (!g) return interaction.reply({ content: 'You are not in a guild.', ephemeral: true });
          const progress = db.getPlayerGuildProgress(interaction.guildId, g.id);
          const rows = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('zeron_guild_deposit').setLabel('Deposit Coins').setEmoji('📥').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('zeron_guild_withdraw').setLabel('Withdraw (Leader)').setEmoji('📤').setStyle(ButtonStyle.Primary).setDisabled(g.role !== 'leader')
          ), new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('zeron_guild_bank_transfer').setLabel('Transfer to Member (Leader)').setEmoji('🎁').setStyle(ButtonStyle.Secondary).setDisabled(g.role !== 'leader')
          )];
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(db.accentColor(interaction.guildId)).setTitle(`🏦 ${g.name} Guild Bank`).setDescription(`Shared balance: **${Number(progress.bank_balance).toLocaleString()} coins**\nAnyone in the guild can deposit. Only the leader can withdraw or transfer bank coins directly to a guild member.`)], components: rows, ephemeral: true });
        }
        if (action === 'progress') {
          const g = db.getPlayerGuild(interaction.guildId, interaction.user.id);
          if (!g) return interaction.reply({ content: 'You are not in a guild.', ephemeral: true });
          const p = db.getPlayerGuildProgress(interaction.guildId, g.id);
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(db.accentColor(interaction.guildId)).setTitle(`📈 ${g.name} Progress`).setDescription(`**Guild Level ${p.level}**\nXP: **${p.xp_into_level}/${p.xp_needed}** toward next level\nTotal XP: **${p.xp.toLocaleString()}**\n\nMembers earn 1 Guild XP when they earn normal server XP. Each guild level requires 100 XP.`)], ephemeral: true });
        }
        if (action === 'deposit' || action === 'withdraw') {
          const modal = new ModalBuilder().setCustomId(`zeron_guild_bank_modal:${action}`).setTitle(action === 'deposit' ? 'Deposit to Guild Bank' : 'Withdraw from Guild Bank')
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_amount').setLabel('Amount of coins').setPlaceholder('Enter a positive whole number').setMinLength(1).setMaxLength(12).setRequired(true).setStyle(TextInputStyle.Short)));
          return interaction.showModal(modal);
        }
        if (action === 'bank_transfer') {
          const modal = new ModalBuilder().setCustomId('zeron_guild_bank_transfer_modal').setTitle('Transfer Guild Bank Coins')
            .addComponents(
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_target').setLabel('Member username').setPlaceholder('Enter exact server username').setMinLength(2).setMaxLength(30).setRequired(true).setStyle(TextInputStyle.Short)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_amount').setLabel('Amount of coins').setPlaceholder('Enter a positive whole number').setMinLength(1).setMaxLength(12).setRequired(true).setStyle(TextInputStyle.Short))
            );
          return interaction.showModal(modal);
        }
        if (action === 'invite') return interaction.showModal(guildInviteModal());
        if (action === 'leave') {
          const result = db.leavePlayerGuild(interaction.guildId, interaction.user.id);
          return interaction.reply({ content: result.ok ? `You left **${result.guild.name}**.` : result.reason === 'leader' ? 'Guild leaders must disband their guild before leaving.' : 'You are not in a guild.', ephemeral: true });
        }
        if (action === 'disband') {
          const result = db.disbandPlayerGuild(interaction.guildId, interaction.user.id);
          const replyPayload = { content: result.ok ? `🏚️ **${result.name}** has been disbanded.` : 'Only your guild leader can disband the guild.', ephemeral: true };
          const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
          return sendPlainReply(replyPayload);
        }
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'zeron_guild_war_opponent') {
        if (!interaction.guildId) return interaction.reply({ content: 'Use this inside a server.', ephemeral: true });
        const own = db.getPlayerGuild(interaction.guildId, interaction.user.id);
        if (!own || own.role !== 'leader') return interaction.reply({ content: 'Only guild leaders can challenge another guild.', ephemeral: true });
        const [opponentId, mode] = interaction.values[0].split(':');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`zeron_guild_war_create:${opponentId}:${mode}:${interaction.user.id}`).setLabel(`Create ${mode === 'fishing' ? 'Fishing' : 'Mixed'} War Challenge`).setStyle(ButtonStyle.Danger));
        return interaction.reply({ content: `Challenge selected: **${mode === 'fishing' ? 'Fishing War' : 'Mixed War'}**. The opponent leader must accept; then it runs for 24 hours.`, components: [row], ephemeral: true });
      }
      if (interaction.isButton() && interaction.customId.startsWith('zeron_guild_war_create:')) {
        const [, opponentText, mode, ownerId] = interaction.customId.split(':');
        if (interaction.user.id !== ownerId) return interaction.reply({ content: 'This war setup belongs to another user.', ephemeral: true });
        const result = db.createGuildWar(interaction.guildId, interaction.user.id, Number(opponentText), mode);
        if (!result.ok) return interaction.reply({ content: ({permission:'Only your guild leader can challenge.',self:'You cannot challenge your own guild.',missing:'Opponent guild not found.',busy:'One of these guilds already has a pending or active war.'}[result.reason] || 'Could not create war.'), ephemeral: true });
        const opponent = db.getPlayerGuild(interaction.guildId, '');
        const war = result.war;
        const target = db.getPlayerGuildMembers(interaction.guildId, Number(opponentText)).find(m => m.role === 'leader');
        let sent = false;
        if (target) sent = await interaction.client.users.fetch(target.user_id).then(user => user.send(toV2Payload({ content: `⚔️ **Guild War Challenge**\nYour guild has been challenged to a **${mode === 'fishing' ? 'Fishing' : 'Mixed'} War** by guild ID ${war.challenger_id}. Accept within Discord by using the button below. If accepted, the war lasts 24 hours.`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`zeron_guild_war_respond:${interaction.guildId}:${war.id}:yes:${target.user_id}`).setLabel('Accept War').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`zeron_guild_war_respond:${interaction.guildId}:${war.id}:no:${target.user_id}`).setLabel('Decline').setStyle(ButtonStyle.Danger))] }))).then(() => true).catch(() => false);
        return interaction.reply({ content: sent ? 'War challenge sent to the opponent leader by DM.' : 'War challenge created, but I could not DM the opponent leader. They may have DMs disabled; ask them to contact the bot owner.', ephemeral: true });
      }
      if (interaction.isButton() && interaction.customId.startsWith('zeron_guild_war_finish:')) {
        const [, warId, ownerId] = interaction.customId.split(':');
        if (interaction.user.id !== ownerId) return interaction.reply({ content: 'Reopen your own Guild War menu to finalize it.', ephemeral: true });
        const result = db.resolveGuildWar(interaction.guildId, Number(warId));
        if (!result.ok) return interaction.reply({ content: result.reason === 'running' ? `War still running until <t:${Math.floor(result.war.ends_at/1000)}:F>.` : 'Could not finalize this war.', ephemeral: true });
        const w = result.war;
        // Tell both guild leaders the result by DM. A closed DM is skipped quietly.
        const challengerGuild = db.guildLeaderInfo(w.challenger_id);
        const opponentGuild = db.guildLeaderInfo(w.opponent_id);
        const scoreLine = `**${challengerGuild?.name || 'Challenger'}** ${w.challenger_score} – ${w.opponent_score} **${opponentGuild?.name || 'Opponent'}**`;
        const notifyLeader = (guild, won) => {
          if (!guild) return;
          const outcome = w.winner_id == null ? 'It was a draw.' : won ? '🏆 Your guild won the war!' : 'Your guild lost this war.';
          const reward = won ? '1,000 coins for each member' : '250 coins for each member';
          interaction.client.users.fetch(guild.leader_id)
            .then(user => user.send(toV2Payload({ content: `⚔️ **Guild war finished**\n${scoreLine}\n${outcome}\nRewards: ${reward}, paid in the server where the war started.` })))
            .catch(() => {});
        };
        notifyLeader(challengerGuild, w.winner_id === w.challenger_id);
        notifyLeader(opponentGuild, w.winner_id === w.opponent_id);
        return interaction.reply({ content: `🏁 War finalized! **${w.challenger_score}–${w.opponent_score}**. ${w.winner_id ? `Winner: <@${w.winner_id}> (guild ID).` : 'It is a draw.'} Winning members got 1,000 coins each, and the others got 250 coins each, paid in the server where the war started.`, ephemeral: true });
      }
      if (interaction.isButton() && interaction.customId.startsWith('zeron_guild_war_respond:')) {
        const [, guildId, warId, decision, ownerId] = interaction.customId.split(':');
        if (interaction.user.id !== ownerId) return interaction.reply({ content: 'This challenge belongs to another leader.', ephemeral: true });
        const result = db.respondGuildWar(guildId, interaction.user.id, Number(warId), decision === 'yes');
        return interaction.reply({ content: result.ok ? (result.declined ? 'Challenge declined.' : '⚔️ War accepted! It will end in 24 hours. Use `/guild` → My Guild → Guild War to view it.') : 'Only the challenged guild leader can respond, and the challenge must still be pending.', ephemeral: true });
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'zeron_guild_join_select') {
        if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
        const result = db.acceptPlayerGuildInvite(interaction.guildId, Number(interaction.values[0]), interaction.user.id);
        const message = result.ok ? `Welcome to **${result.guild.name}**! ⚔️` : ({ member: 'You are already in a guild.', invite: 'You need a valid invitation from that guild leader. Invitations expire after 24 hours.', full: 'That guild is full (25 members).' }[result.reason] || 'Could not join that guild.');
        return interaction.reply({ content: message, ephemeral: true });
      }
      if (interaction.isButton() && interaction.customId === 'zeron_guild_bank_transfer') {
        if (!interaction.guildId) return interaction.reply({ content: 'Use this inside a server.', ephemeral: true });
        const own = db.getPlayerGuild(interaction.guildId, interaction.user.id);
        if (!own || own.role !== 'leader') return interaction.reply({ content: 'Only the guild leader can transfer coins from the guild bank.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('zeron_guild_bank_transfer_modal').setTitle('Transfer Guild Bank Coins')
          .addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_target').setLabel('Member username').setPlaceholder('Enter exact server username').setMinLength(2).setMaxLength(30).setRequired(true).setStyle(TextInputStyle.Short)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_amount').setLabel('Amount of coins').setPlaceholder('Enter a positive whole number').setMinLength(1).setMaxLength(12).setRequired(true).setStyle(TextInputStyle.Short))
          );
        return interaction.showModal(modal);
      }
      if (interaction.isModalSubmit() && interaction.customId === 'zeron_guild_bank_transfer_modal') {
        if (!interaction.guildId) return interaction.reply({ content: 'Use this inside a server.', ephemeral: true });
        const rawTarget = interaction.fields.getTextInputValue('bank_target').trim().replace(/^@/, '');
        const amount = Number(interaction.fields.getTextInputValue('bank_amount').trim());
        if (!rawTarget || !Number.isSafeInteger(amount) || amount <= 0) {
          return interaction.reply({ content: 'Enter a member username and a positive whole number of coins.', ephemeral: true });
        }
        const ownGuild = db.getPlayerGuild(interaction.guildId, interaction.user.id);
        if (!ownGuild || ownGuild.role !== 'leader') {
          return interaction.reply({ content: 'Only your guild leader can transfer coins from the guild bank.', ephemeral: true });
        }
        const guildMembers = await interaction.guild.members.fetch({ query: rawTarget, limit: 100 }).catch(() => new Map());
        const normalized = rawTarget.toLocaleLowerCase();
        const matches = [...guildMembers.values()].filter(member =>
          [member.user.username, member.user.globalName, member.displayName, member.user.tag]
            .filter(Boolean).some(name => name.toLocaleLowerCase() === normalized)
        );
        if (matches.length === 0) {
          return interaction.reply({ content: 'Could not find a server member with that exact username. Check the spelling and try again.', ephemeral: true });
        }
        if (matches.length > 1) {
          return interaction.reply({ content: 'More than one member matches that name. Please use a more unique username.', ephemeral: true });
        }
        const targetId = matches[0].id;
        const result = db.transferPlayerGuildBank(interaction.guildId, interaction.user.id, targetId, amount);
        const messages = { member: 'You are not in a guild.', permission: 'Only the guild leader can transfer coins from the guild bank.', target: 'That user must be a different member of your own guild.', bank_funds: `The guild bank only has ${(result.bank || 0).toLocaleString()} coins.`, amount: 'Enter a valid positive whole number.' };
        if (!result.ok) return interaction.reply({ content: `❌ ${messages[result.reason] || 'Could not transfer guild bank coins.'}`, ephemeral: true });
        let targetName = `<@${targetId}>`;
        try { targetName = (await interaction.guild.members.fetch(targetId)).user.tag; } catch {}
        return interaction.reply({ content: `🎁 Transferred **${amount.toLocaleString()} coins** from **${result.guild.name} Guild Bank** to **${targetName}**.\nGuild bank balance: **${result.bank.toLocaleString()} coins**.`, ephemeral: true });
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('zeron_guild_bank_modal:')) {
        if (!interaction.guildId) return interaction.reply({ content: 'Use this inside a server.', ephemeral: true });
        const action = interaction.customId.split(':')[1];
        const amount = Number(interaction.fields.getTextInputValue('bank_amount').trim());
        if (!Number.isSafeInteger(amount) || amount <= 0) return interaction.reply({ content: 'Enter a positive whole number of coins.', ephemeral: true });
        const result = db.playerGuildBank(interaction.guildId, interaction.user.id, action, amount);
        const messages = { member: 'You are not in a guild.', funds: `You do not have enough coins. Balance: ${(result.balance || 0).toLocaleString()}.`, bank_funds: `The guild bank only has ${(result.bank || 0).toLocaleString()} coins.`, permission: 'Only the guild leader can withdraw from the shared bank.', amount: 'Enter a valid positive whole number.' };
        return interaction.reply({ content: result.ok ? `${action === 'deposit' ? '📥 Deposited' : '📤 Withdrew'} **${amount.toLocaleString()} coins**. Personal balance: **${result.balance.toLocaleString()}** · Guild bank: **${result.bank.toLocaleString()}**.` : `❌ ${messages[result.reason] || 'Could not complete this bank transaction.'}`, ephemeral: true });
      }
      if (interaction.isModalSubmit() && interaction.customId === 'zeron_guild_create_modal') {
        if (!interaction.guildId) return interaction.reply({ content: 'Guilds only work inside a server.', ephemeral: true });
        const result = db.createPlayerGuild(interaction.guildId, interaction.user.id, interaction.fields.getTextInputValue('guild_name'), 500);
        const messages = { name: 'Use 3–24 letters, numbers, spaces, underscores, or hyphens.', member: 'You are already in a guild.', taken: 'That guild name is already taken in this server.', funds: `Creating a guild costs 500 coins. Your balance is ${(result.balance || 0).toLocaleString()} coins.` };
        const replyPayload = { content: result.ok ? `🏰 Guild **${result.guild.name}** created! **500 coins** were deducted. You are its leader. Use **/guild** to manage it.` : `❌ ${messages[result.reason] || 'Could not create that guild.'}`, ephemeral: true };
        const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        if (!result.ok && result.reason === 'funds') {
          const sendPlainFollowUp = interaction.__v2OriginalMethods?.followUp || interaction.followUp.bind(interaction);
          return sendPlainFollowUp(replyPayload);
        }
        return sendPlainReply(replyPayload);
      }
      if (interaction.isModalSubmit() && interaction.customId === 'zeron_guild_invite_modal') {
        if (!interaction.guildId) return interaction.reply({ content: 'Guilds only work inside a server.', ephemeral: true });
        const rawUsername = interaction.fields.getTextInputValue('invite_user').trim().replace(/^@/, '');
        if (!rawUsername) return interaction.reply({ content: 'Enter the member’s exact server username.', ephemeral: true });
        const fetchedMembers = await interaction.guild.members.fetch({ query: rawUsername, limit: 100 }).catch(() => new Map());
        const normalizedUsername = rawUsername.toLocaleLowerCase();
        const matches = [...fetchedMembers.values()].filter(candidate =>
          !candidate.user.bot && [candidate.user.username, candidate.user.globalName, candidate.displayName, candidate.user.tag]
            .filter(Boolean).some(name => name.toLocaleLowerCase() === normalizedUsername)
        );
        if (matches.length === 0) return interaction.reply({ content: 'Could not find a non-bot server member with that exact username. Check the spelling and try again.', ephemeral: true });
        if (matches.length > 1) return interaction.reply({ content: 'More than one member matches that name. Please enter a more unique username.', ephemeral: true });
        const member = matches[0];
        const userId = member.id;
        if (userId === interaction.user.id) return interaction.reply({ content: 'You cannot invite yourself.', ephemeral: true });
        const g = db.getPlayerGuild(interaction.guildId, interaction.user.id);
        if (!g) return interaction.reply({ content: 'You are not in a guild.', ephemeral: true });
        const result = db.invitePlayerGuild(interaction.guildId, g.id, interaction.user.id, userId);
        if (!result.ok) {
          const msg = { missing: 'Guild not found.', permission: 'Only the guild leader can invite members.', member: 'That member is already in a guild.', pending: 'That member already has a pending invitation.' };
          return interaction.reply({ content: msg[result.reason] || 'Could not invite that member.', ephemeral: true });
        }
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`zeron_guild_accept:${interaction.guildId}:${g.id}:${userId}`).setLabel('Accept Guild Invite').setStyle(ButtonStyle.Success));
        const dm = await member.send(toV2Payload({ content: `⚔️ <@${interaction.user.id}> invited you to join **${g.name}** in **${interaction.guild.name}**. This invitation expires in 24 hours.`, components: [row] })).then(() => true).catch(() => false);
        return interaction.reply({ content: dm ? `Invitation sent to ${member}.` : `Invitation created, but I couldn't DM ${member}. They may have DMs disabled.`, ephemeral: true });
      }
      if (interaction.isButton() && interaction.customId.startsWith('zeron_guild_accept:')) {
        const [, guildId, guildRecordId, userId] = interaction.customId.split(':');
        if (interaction.user.id !== userId) return interaction.reply({ content: 'This invitation belongs to another member.', ephemeral: true });
        const result = db.acceptPlayerGuildInvite(guildId, Number(guildRecordId), userId);
        return interaction.reply({ content: result.ok ? `⚔️ You joined **${result.guild.name}**!` : result.reason === 'full' ? 'That guild is full.' : result.reason === 'member' ? 'You are already in a guild.' : 'This invitation is invalid or has expired.', ephemeral: true });
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'guild') {
        if (!interaction.guild || !interaction.guildId) return interaction.reply({ content: 'The guild menu only works inside a server.', ephemeral: true });
        return interaction.reply({ embeds: [guildMenuEmbed(db, interaction.guild, interaction.user.id)], components: guildMenuRows() });
      }
      if (interaction.isButton() && interaction.customId.startsWith('zeron_slots_wager:')) {
        const ownerId = interaction.customId.split(':')[1];
        if (interaction.user.id !== ownerId) {
          return interaction.reply({ content: 'This is not your slots game.', ephemeral: true });
        }
        return interaction.update({ content: slotsWagerPrompt(), embeds: [], components: [slotsWagerRow(ownerId)] });
      }

      if (interaction.isButton() && interaction.customId.startsWith('zeron_slots_again:')) {
        const [, ownerId, amountText] = interaction.customId.split(':');
        if (interaction.user.id !== ownerId) {
          return interaction.reply({ content: 'This is not your slots game.', ephemeral: true });
        }
        const amount = Number(amountText);
        if (!SLOT_WAGERS.includes(amount)) {
          return interaction.update({ content: slotsWagerPrompt(), embeds: [], components: [slotsWagerRow(ownerId)] });
        }
        return playSlots(interaction, db, ownerId, amount);
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('zeron_slots_bet:')) {
        const ownerId = interaction.customId.split(':')[1];
        if (interaction.user.id !== ownerId) {
          return interaction.reply({ content: 'This is not your slots game.', ephemeral: true });
        }
        const amount = Number(interaction.values[0]);
        if (!SLOT_WAGERS.includes(amount)) {
          return interaction.reply({ content: 'Invalid wager amount.', ephemeral: true });
        }
        return playSlots(interaction, db, ownerId, amount);
      }

    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('onb:')) {
      const [, action, guildId, userId, arg] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        return interaction.reply({ content: 'This onboarding is for another member.', ephemeral: true });
      }
      const guild = interaction.guild;
      const cfg = db.getOnboardingConfig(guildId);
      const accent = db.accentColor(guildId);

      const doneView = () => ({
        content: '',
        embeds: [new EmbedBuilder().setColor(accent).setTitle("🎉 You're all set!").setDescription('Welcome to ' + guild.name + '!')],
        components: []
      });

      const roleView = () => {
        const me = guild.members.me;
        const roles = cfg.roles
          .map(id => guild.roles.cache.get(id))
          .filter(role => role && !role.managed && me && role.position < me.roles.highest.position);
        if (!roles.length) return doneView();
        return {
          content: '',
          embeds: [new EmbedBuilder().setColor(accent).setTitle('🎭 Pick your roles').setDescription('Choose the roles you want. You can pick several.')],
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('onb:roles:' + guildId + ':' + userId)
              .setPlaceholder('Choose roles')
              .setMinValues(0)
              .setMaxValues(roles.length)
              .addOptions(roles.map(role => ({ label: role.name.slice(0, 100), value: role.id })))
          )]
        };
      };

      const stepView = index => {
        if (index >= cfg.steps.length) return cfg.roles.length ? roleView() : doneView();
        const step = cfg.steps[index];
        const isLast = index === cfg.steps.length - 1;
        const label = isLast && !cfg.roles.length ? 'Finish' : 'Next';
        return {
          content: '',
          embeds: [new EmbedBuilder().setColor(accent).setTitle(step.title).setDescription(step.text)
            .setFooter({ text: 'Step ' + (index + 1) + ' of ' + cfg.steps.length })],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('onb:next:' + guildId + ':' + userId + ':' + (index + 1))
              .setLabel(label)
              .setStyle(ButtonStyle.Success)
          )]
        };
      };

      if (action === 'start') return interaction.reply({ ...stepView(0), ephemeral: true });
      if (action === 'next') return interaction.update(stepView(Number(arg)));

      if (action === 'roles') {
        const member = await guild.members.fetch(userId).catch(() => null);
        const me = guild.members.me;
        if (member && me) {
          for (const id of interaction.values) {
            const role = guild.roles.cache.get(id);
            if (!role || role.managed || role.position >= me.roles.highest.position) continue;
            await member.roles.add(role, 'Onboarding role pick').catch(() => {});
          }
        }
        return interaction.update(doneView());
      }
      return null;
    }

    if (interaction.isButton() && interaction.customId.startsWith('nx-verify-start:')) {
      const guildId = interaction.customId.split(':')[1];
      const cfg = db.getVerificationConfig(guildId);
      if (!cfg.enabled || cfg.questions.length === 0) return replyVerificationNotice(interaction, 'Verification is not open right now.');
      if (cfg.verifiedRoleId && interaction.member && interaction.member.roles.cache.has(cfg.verifiedRoleId)) return replyVerificationNotice(interaction, 'You are already verified.');
      if (db.hasPendingVerification(guildId, interaction.user.id)) return replyVerificationNotice(interaction, 'Your application is already waiting for review.');
      const modal = new ModalBuilder().setCustomId('nx-verify-form:' + guildId).setTitle((cfg.panelTitle && cfg.panelTitle.trim() ? cfg.panelTitle.trim() : VERIFY_DEFAULTS.title).slice(0, 45));
      modal.addComponents(...cfg.questions.slice(0, 5).map((question, index) =>
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('q' + index).setLabel(question.slice(0, 45)).setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(true)
        )
      ));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('nx-verify-form:')) {
      // Acknowledge the modal immediately so review-channel delivery cannot expire the interaction.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const guildId = interaction.customId.split(':')[1];
      const cfg = db.getVerificationConfig(guildId);
      if (!cfg.enabled) return replyVerificationNotice(interaction, 'Verification is not open right now.');
      if (db.hasPendingVerification(guildId, interaction.user.id)) return replyVerificationNotice(interaction, 'Your application is already waiting for review.');
      const answers = cfg.questions.slice(0, 5).map((question, index) => ({ question, answer: interaction.fields.getTextInputValue('q' + index).trim() }));
      const reviewChannel = interaction.guild ? interaction.guild.channels.cache.get(cfg.reviewChannelId) : null;
      if (!reviewChannel) return replyVerificationNotice(interaction, 'The review channel is not set. Ask staff to set it in the dashboard.');
      const appId = db.createVerificationApplication(guildId, interaction.user.id, answers);
      const embed = new EmbedBuilder()
        .setColor(db.accentColor(guildId))
        .setTitle('📝 Verification application #' + appId)
        .setDescription('Applicant: <@' + interaction.user.id + '>')
        .addFields(answers.map(item => ({ name: item.question.slice(0, 256), value: (item.answer || '-').slice(0, 1024) })))
        .setFooter({ text: 'Approve to swap the Unverified role for Verified.' });
      let message;
      try {
        message = await reviewChannel.send(toV2Payload({ embeds: [embed], components: [verifyReviewRow(appId)] }));
      } catch (error) {
        console.error('Verification review message delivery failed:', error.message);
        db.failVerificationApplication(appId);
        return replyVerificationNotice(interaction, 'ZERON could not send your application to the staff review channel. Your application was not submitted. Please try again later or contact a server staff member.');
      }
      db.setVerificationReviewMessage(appId, message.id);
      return replyVerificationNotice(interaction, 'Your application was sent to the staff. You will get a DM when it is reviewed.');
    }

    if (interaction.isButton() && (interaction.customId.startsWith('nx-verify-approve:') || interaction.customId.startsWith('nx-verify-reject:'))) {
      const [prefix, appIdText] = interaction.customId.split(':');
      const approve = prefix === 'nx-verify-approve';
      const reviewer = interaction.member;
      if (!reviewer || !(reviewer.permissions.has(PermissionFlagsBits.ManageGuild) || reviewer.permissions.has(PermissionFlagsBits.ManageRoles))) {
        return replyVerificationNotice(interaction, 'Only staff with Manage Server or Manage Roles can review applications.');
      }
      const app = db.getVerificationApplication(Number(appIdText));
      if (!app || app.status !== 'pending') return replyVerificationNotice(interaction, 'This application was already reviewed.');
      const guild = interaction.guild;
      const cfg = db.getVerificationConfig(app.guild_id);
      const target = await guild.members.fetch(app.user_id).catch(() => null);

      if (approve) {
        if (!target) return replyVerificationNotice(interaction, 'That member has left the server. Reject the application instead.');
        const me = guild.members.me;
        const verified = cfg.verifiedRoleId ? guild.roles.cache.get(cfg.verifiedRoleId) : null;
        if (!verified || !me || !me.permissions.has(PermissionFlagsBits.ManageRoles) || verified.position >= me.roles.highest.position) {
          return replyVerificationNotice(interaction, 'ZERON cannot give the Verified role. Check the role and ZERON\'s role position.');
        }
        try {
          if (cfg.unverifiedRoleId && target.roles.cache.has(cfg.unverifiedRoleId)) await target.roles.remove(cfg.unverifiedRoleId, 'Verification approved');
          await target.roles.add(verified, 'Verification approved');
        } catch (error) {
          console.error('Verification roles failed:', error.message);
          return replyVerificationNotice(interaction, 'Could not update roles: ' + error.message);
        }
      }

      if (!db.decideVerificationApplication(app.id, approve ? 'approved' : 'rejected', interaction.user.id)) {
        return replyVerificationNotice(interaction, 'This application was already reviewed.');
      }

      // Rebuild the persistent V2 review card from saved data, with exactly one decision field.
      const updated = new EmbedBuilder()
        .setColor(approve ? 0x22c55e : 0xef4444)
        .setTitle('📝 Verification application #' + app.id)
        .setDescription('Applicant: <@' + app.user_id + '>')
        .addFields(app.answers.map(item => ({ name: String(item.question || 'Question').slice(0, 256), value: String(item.answer || '-').slice(0, 1024) })))
        .addFields({ name: approve ? 'Approved' : 'Rejected', value: 'By <@' + interaction.user.id + '>' })
        .setFooter({ text: 'This application has been reviewed.' });
      await interaction.update(toV2Payload({ embeds: [updated], components: [] }));

      if (target) {
        const dmCard = textCard(
          approve ? '✅ Verification approved' : '❌ Verification rejected',
          approve ? verifyText(cfg.approveMessage, VERIFY_DEFAULTS.approve, guild.name) : verifyText(cfg.rejectMessage, VERIFY_DEFAULTS.reject, guild.name),
          guild.name,
          approve ? 0x22c55e : 0xef4444
        );
        sendVerificationDm(target, dmCard).catch(() => {});
      }
      return null;
    }

    if ((interaction.isButton() || interaction.isStringSelectMenu()) && /^zeron_(fish_shop|fish_menu|fish_home|fish_profile|shop_)/.test(interaction.customId)) {
      const parts = interaction.customId.split(':');
      const action = parts[0];
      const guildId = parts[1];
      const ownerId = parts[2];
      if (interaction.user.id !== ownerId || interaction.guildId !== guildId) {
        return interaction.reply({ content: 'This is not your fishing session. Use /fish command to open your fishing session.', ephemeral: true });
      }

      const color = db.accentColor(guildId);
      const views = {
        categories: () => ({ content: '', embeds: [shopCategoriesEmbed(color)], components: [shopCategoriesRow(guildId, ownerId)] }),
        rods: () => {
          const gear = db.getFishingGear(guildId, ownerId);
          const balance = db.getBalance(guildId, ownerId).coins;
          return { content: '', embeds: [rodShopEmbed(gear, balance, color)], components: rodShopRows(guildId, ownerId, gear) };
        },
        bait: () => {
          const gear = db.getFishingGear(guildId, ownerId);
          const balance = db.getBalance(guildId, ownerId).coins;
          const stock = db.getBaitStock(guildId, ownerId);
          const level = db.getFishingLevel(guildId, ownerId);
          return { content: '', embeds: [baitShopEmbed(stock, gear, balance, level, color)], components: baitShopRows(guildId, ownerId, stock) };
        },
        home: () => ({ content: '', embeds: [fishHomeEmbed(color)], components: [fishStartRow(guildId, ownerId)] }),
        menu: () => ({ content: '', embeds: [fishMenuEmbed(color)], components: [fishMenuRow(guildId, ownerId)] }),
        profile: () => ({ content: '', embeds: [fishProfileEmbed(db.getFishingProfile(guildId, ownerId), color)], components: [fishProfileRow(guildId, ownerId)] })
      };

      const openView = { zeron_fish_shop: 'categories', zeron_shop_cats: 'categories', zeron_shop_rods: 'rods', zeron_shop_bait: 'bait', zeron_shop_home: 'home', zeron_fish_menu: 'menu', zeron_fish_home: 'home', zeron_fish_profile: 'profile' }[action];
      if (openView) return interaction.update(views[openView]());

      if (action === 'zeron_shop_rod' && interaction.isStringSelectMenu()) {
        const key = interaction.values[0].split(':')[1];
        const rod = FISH_RODS[key];
        if (!rod) return null;
        const result = db.buyRod(guildId, ownerId, key, rod.price);
        if (!result.ok) {
          return interaction.reply({
            content: 'You need ' + coinText(rod.price) + ' for the ' + rod.name + '. Your balance is ' + coinText(result.balance) + '.',
            ephemeral: true
          });
        }
        db.selectRod(guildId, ownerId, key);
        return interaction.update(views.rods());
      }

      if (action === 'zeron_shop_bait_buy' && interaction.isStringSelectMenu()) {
        const key = interaction.values[0].split(':')[1];
        const bait = FISH_BAIT[key];
        if (!bait) return null;
        const level = db.getFishingLevel(guildId, ownerId);
        if (bait.level && level < bait.level) {
          return interaction.reply({ content: bait.name + ' unlocks at fishing level ' + bait.level + '.', ephemeral: true });
        }
        const result = db.buyBait(guildId, ownerId, key, bait.pack, bait.price);
        if (!result.ok) {
          return interaction.reply({
            content: 'You need ' + coinText(bait.price) + ' for ' + bait.pack + ' ' + bait.name + '. Your balance is ' + coinText(result.balance) + '.',
            ephemeral: true
          });
        }
        return interaction.update(views.bait());
      }

      if (action === 'zeron_shop_bait_use' && interaction.isStringSelectMenu()) {
        const key = interaction.values[0].split(':')[1];
        const ok = db.selectBait(guildId, ownerId, key === 'none' ? null : key);
        if (!ok) {
          return interaction.reply({ content: 'You do not have any of that bait. Buy some first.', ephemeral: true });
        }
        return interaction.update(views.bait());
      }

      return null;
    }

    if (
      interaction.isButton() &&
      (
        interaction.customId.startsWith('zeron_fish_start:') ||
        interaction.customId.startsWith('zeron_fish_again:') ||
        interaction.customId.startsWith('zeron_fish_sell:') ||
        interaction.customId.startsWith('zeron_fish_quests:')
      )
    ) {
      const parts = interaction.customId.split(':');
      const action = parts[0];
      const guildId = parts[1];
      const ownerId = parts[2];

      if (
        interaction.user.id !== ownerId ||
        interaction.guildId !== guildId
      ) {
        return interaction.reply({
          content: 'This is not your fishing session. Use /fish command to open your fishing session.',
          ephemeral: true
        });
      }

      if (action === 'zeron_fish_again') {
        const cooldownKey = guildId + ':' + ownerId;
        const now = Date.now();
        const lastFishAt = fishingAgainCooldowns.get(cooldownKey) || 0;
        if (now - lastFishAt < 3000) {
          // Only one wait message per player: later presses update it, and it disappears when the cooldown ends.
          const remaining = Math.max(1, Math.ceil((3000 - (now - lastFishAt)) / 1000));
          const waitText = `⏳ Please wait ${remaining} second${remaining === 1 ? '' : 's'} before fishing again!`;
          const pending = fishWaitMessages.get(cooldownKey);
          if (pending) {
            clearTimeout(pending.timer);
            await interaction.deferUpdate().catch(() => {});
            const editPlainReply = pending.interaction.__v2OriginalMethods?.editReply || pending.interaction.editReply.bind(pending.interaction);
            await editPlainReply({ content: waitText }).catch(() => {});
          } else {
            const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
            await sendPlainReply({ content: waitText, ephemeral: true });
          }
          const owner = pending ? pending.interaction : interaction;
          const timer = setTimeout(async () => {
            fishWaitMessages.delete(cooldownKey);
            await owner.deleteReply().catch(() => owner.editReply({ content: '\u200b' }).catch(() => {}));
          }, 3000 - (now - lastFishAt) + 300);
          fishWaitMessages.set(cooldownKey, { interaction: owner, timer });
          return;
        }
        fishingAgainCooldowns.set(cooldownKey, now);
      }

      if (action === 'zeron_fish_quests') {
        const progress = db.getFishingQuestProgress(guildId, ownerId, FISH_QUESTS);
        return interaction.reply({ embeds: [fishQuestsEmbed(progress, db.accentColor(guildId))], ephemeral: true });
      }

      if (action === 'zeron_fish_sell') {
        const result = db.sellAllFish(guildId, ownerId);

        if (result.ok) {
          return interaction.update({
            content:
              '💰 **Fishing inventory sold!**\n' +
              'Fish sold: **' + result.count + '**\n' +
              'Coins earned: **' + coinText(result.total) + '**\n' +
              'New wallet balance: **' + coinText(result.balance) + '**',
            embeds: [],
            components: [fishStartRow(guildId, ownerId)]
          });
        }

        const message = result.reason === 'empty'
          ? '🐟 Your fishing inventory is empty. Catch some fish first!'
          : '⚠️ Your wallet balance limit prevents this sale. Your fish have not been removed.';

        return interaction.update({
          content: message,
          embeds: [],
          components: [fishStartRow(guildId, ownerId)]
        });
      }

      const gear = db.getFishingGear(guildId, ownerId);
      const usedBait = db.consumeBait(guildId, ownerId);
      const fish = chooseFish(gear.rod, usedBait);
      db.catchFish(guildId, ownerId, fish);
      db.recordCatch(guildId, ownerId, fish.name);
      db.addFishingXp(guildId, ownerId, fishingXpFromValue(fish.value));
      syncAchievements(db, guildId, ownerId);
      let bonus = null;
      if (usedBait && Math.random() < FISH_BAIT[usedBait].bonusChance) {
        bonus = chooseFish(gear.rod, usedBait);
        db.catchFish(guildId, ownerId, bonus);
        db.recordCatch(guildId, ownerId, bonus.name);
        db.addFishingXp(guildId, ownerId, fishingXpFromValue(bonus.value));
      }
      const awarded = db.awardFishingQuests(guildId, ownerId, FISH_QUESTS);

      const inventory = db.getFishingInventory(guildId, ownerId);
      const embed = fishResultEmbed(fish, inventory, db.accentColor(interaction.guildId), awarded, bonus);

      return interaction.update({
        content: '',
        embeds: [embed],
        components: [fishResultRow(guildId, ownerId)]
      });
    }

    if (interaction.isButton() && interaction.customId.startsWith('nx-poll-vote:')) {
      const [, rawPollId, rawOptionIndex] = interaction.customId.split(':');
      const pollId = Number(rawPollId);
      const optionIndex = Number(rawOptionIndex);
      if (!interaction.guildId) return interaction.reply({ content: 'Poll voting only works inside its server.', ephemeral: true });
      const poll = db.getPoll(interaction.guildId, pollId);
      if (!poll) return interaction.reply({ content: 'This poll could not be found.', ephemeral: true });
      if (poll.status !== 'active' || Number(poll.ends_at) <= Date.now()) {
        if (poll.status === 'active') {
          db.closePoll(interaction.guildId, poll.id);
          const closedPoll = { ...poll, status: 'closed' };
          await interaction.message.edit(pollV2Payload(closedPoll, db.getPollVotes(poll.id), true)).catch(() => {});
        }
        return interaction.reply({ content: 'This poll has closed. You can no longer vote.', ephemeral: true });
      }
      const options = JSON.parse(poll.options || '[]');
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
        return interaction.reply({ content: 'That poll option is invalid.', ephemeral: true });
      }
      if (poll.required_role_id) {
        const member = interaction.guild.members.cache.get(interaction.user.id)
          || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member?.roles.cache.has(poll.required_role_id)) {
          return interaction.reply({ content: 'You need the required role to vote in this poll.', ephemeral: true });
        }
      }
      const previous = db.getPollVote(poll.id, interaction.user.id);
      if (previous && !poll.allow_change && !poll.multiple) {
        return interaction.reply({ content: 'You have already voted in this poll. Vote changes are disabled.', ephemeral: true });
      }
      let selected = [optionIndex];
      if (poll.multiple) {
        selected = previous ? [...previous.options] : [];
        if (!poll.allow_change && selected.includes(optionIndex)) {
          return interaction.reply({ content: 'You have already selected this option. Vote changes are disabled.', ephemeral: true });
        }
        selected = selected.includes(optionIndex) ? selected.filter(index => index !== optionIndex) : [...selected, optionIndex];
        if (!selected.length) {
          return interaction.reply({ content: 'Select at least one option before submitting your vote.', ephemeral: true });
        }
      }
      db.savePollVote(poll.id, interaction.user.id, selected, Date.now());
      return interaction.update(pollV2Payload(poll, db.getPollVotes(poll.id), false));
    }

    if (interaction.isButton() && interaction.customId.startsWith('nx-lb:')) {
      const [, boardType, pageText] = interaction.customId.split(':');
      return interaction.update(buildLeaderboard(interaction.guild, boardType, Number(pageText), interaction.user.id))
        .catch(error => console.error('Leaderboard page failed:', error.message));
    }
    if (interaction.isModalSubmit() && interaction.customId === 'nx-birthday-set') {
      if (!interaction.guildId) {
        return interaction.reply({ content: 'Set your birthday inside a server.', ephemeral: true });
      }
      const day = Number(interaction.fields.getTextInputValue('day').trim());
      const month = Number(interaction.fields.getTextInputValue('month').trim());
      if (!Number.isInteger(day) || !Number.isInteger(month) || !isValidBirthday(day, month)) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('❌ Invalid date')
            .setDescription('That day does not exist in that month. Use `/birthday action:Set my birthday` to try again.')],
          ephemeral: true
        });
      }
      db.setBirthday(interaction.guildId, interaction.user.id, day, month);
      const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
      return sendPlainReply({
        content: '### 🎂 Birthday saved\nWe will wish you on **' + formatBirthday(day, month) + '**.',
        ephemeral: true
      });
    }
    if (interaction.isButton() && interaction.customId.startsWith('nx-gw-enter:')) {
      return handleGiveawayEnter(interaction, db).catch(error => console.error('Giveaway entry failed:', error.message));
    }
    if (interaction.isButton() && interaction.customId.startsWith('nx-ticket-open:')) {
      const typeId = Number(interaction.customId.split(':')[1]);
      const type = db.getTicketType(interaction.guild.id, typeId);
      if (!type) return ticketError(interaction, 'This ticket type no longer exists. Ask an admin to post a new panel.');
      return interaction.showModal(ticketFormModal(type, typeId)).catch(error => {
        console.error('Ticket form failed:', error.message);
        return ticketError(interaction, 'Could not open the ticket form. Please try again.');
      });
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('nx-ticket-form:')) {
      const typeId = Number(interaction.customId.split(':')[1]);
      const details = {
        subject: interaction.fields.getTextInputValue('subject').trim(),
        description: interaction.fields.getTextInputValue('description').trim()
      };
      return openTicket(interaction, typeId, details).catch(error => {
        console.error('Ticket open failed:', error.message);
        return ticketError(interaction, 'Could not open your ticket. Please try again.');
      });
    }
    if (interaction.isButton() && interaction.customId === 'nx-ticket-open') {
      return interaction.reply({ content: 'This ticket panel is outdated. Ask an admin to post a new one from the dashboard.', ephemeral: true });
    }
    if (interaction.isButton() && interaction.customId === 'nx-ticket-claim') {
      return claimTicket(interaction).catch(error => {
        console.error('Ticket claim failed:', error.message);
        return ticketError(interaction, 'Could not claim this ticket. Please try again.');
      });
    }
    if (interaction.isButton() && interaction.customId === 'nx-ticket-close') {
      return closeTicket(interaction).catch(error => {
        console.error('Ticket close failed:', error.message);
        return ticketError(interaction, 'Could not close this ticket. Please try again.');
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('nx-help:')) {
      const value = interaction.values[0];
      if (value.startsWith('folder:')) {
        const folder = HELP_FOLDERS.find(f => 'folder:' + f.id === value);
        if (!folder) return interaction.reply({ content: 'That folder could not be found.', ephemeral: true });
        return interaction.update({ embeds: [helpFolderEmbed(folder, db.accentColor(interaction.guildId), helpHiddenFor(interaction))], components: helpComponents() });
      }
      const cmd = helpCommands().find(c => c.name === value);
      if (!cmd) return interaction.reply({ content: 'That command could not be found.', ephemeral: true });
      return interaction.update({ embeds: [helpDetailEmbed(cmd, db.accentColor(interaction.guildId))], components: helpComponents() });
    }

    if ((interaction.isChatInputCommand() && interaction.commandName === 'fish') ||
        (interaction.isButton() && (interaction.customId.startsWith('zeron_fish') || interaction.customId.startsWith('zeron_shop_')))) {
      v2Proxy(interaction);
    }

    if ((interaction.isChatInputCommand() && interaction.commandName === 'guild') ||
        (typeof interaction.customId === 'string' && interaction.customId.startsWith('zeron_guild_'))) {
      v2Proxy(interaction);
    }

    if ((interaction.isChatInputCommand() && interaction.commandName === 'play') ||
        (typeof interaction.customId === 'string' && interaction.customId.startsWith('zeron_slots_'))) {
      v2Proxy(interaction);
    }

    // Any button or menu on a Components V2 message answers in Components V2, whatever its custom ID is.
    if (interaction.isMessageComponent() && interaction.message && interaction.message.flags &&
        interaction.message.flags.has(require('discord.js').MessageFlags.IsComponentsV2)) {
      v2Proxy(interaction);
    }

    if (interaction.isAutocomplete() && interaction.commandName === 'vaultpost') {
      const typed = String(interaction.options.getFocused() || '').toLowerCase();
      const choices = db.listVaultRules(interaction.guild.id)
        .filter(rule => rule.label.toLowerCase().includes(typed))
        .slice(0, 25)
        .map(rule => ({ name: `${rule.label} Vault`, value: rule.vault }));
      return interaction.respond(choices).catch(() => {});
    }
    if (interaction.isAutocomplete() && interaction.commandName === 'roblox') {
      const typed = String(interaction.options.getFocused() || '').toLowerCase();
      const names = [...new Set([interaction.user.username, interaction.user.globalName].filter(Boolean))];
      const choices = names.filter(name => name.toLowerCase().includes(typed)).slice(0, 25).map(name => ({ name, value: name }));
      return interaction.respond(choices).catch(() => {});
    }

    if (interaction.isAutocomplete() && interaction.commandName === 'manage-cmnds') {
      const typed = String(interaction.options.getFocused() || '').toLowerCase();
      const disabled = interaction.guildId ? db.getDisabledCommands(interaction.guildId) : new Set();
      const choices = commands.map(c => c.name)
        .filter(name => name !== 'manage-cmnds' && name.includes(typed))
        .slice(0, 25)
        .map(name => ({ name: disabled.has(name) ? `${name} (disabled)` : name, value: name }));
      return interaction.respond(choices).catch(() => {});
    }

    if (interaction.isButton() && interaction.customId.startsWith('zeron_devgive:')) {
      const [, action, token] = interaction.customId.split(':');
      if (interaction.user.id !== '1560621828982968470') return interaction.reply({ content: '🔒 Only the ZERON developer can use this.', ephemeral: true });
      const pending = devGivePending.get(token);
      devGivePending.delete(token);
      if (!pending || pending.expires < Date.now() || pending.developerId !== interaction.user.id) {
        return interaction.update({ components: [textCard('🏦 Expired', 'This transfer expired. Run /devgive again.', null)] });
      }
      if (action === 'cancel') {
        return interaction.update({ components: [textCard('🏦 Cancelled', 'No coins were sent.', null)] });
      }
      await interaction.update({ components: [textCard('🏦 Sending…', `Sending coins to ${pending.memberIds.length} members.`, null)] });
      let paid = 0;
      let failed = 0;
      for (const memberId of pending.memberIds) {
        const result = db.giveDeveloperCoins(pending.guildId, memberId, pending.amount, pending.developerId);
        if (result.ok) paid++; else failed++;
      }

      const guildForLog = interaction.guild;
      if (guildForLog) writeLog(guildForLog, 'devgive', pending.roleId, `${pending.amount} coins to ${paid} members · ${pending.reason}`, pending.developerId);
      const summary = `Role <@&${pending.roleId}> · **${paid}** members received **${pending.amount.toLocaleString()} coins** each.
Total sent: **${(paid * pending.amount).toLocaleString()} coins**.${failed ? `
${failed} could not receive coins (balance limit).` : ''}`;
      return interaction.editReply({ components: [textCard('🏦 Developer transfer complete', summary, `Reason: ${pending.reason}`, 0x22c55e)] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('zeron_enable_list:')) {
      const guild = interaction.guild;
      if (!guild) return;
      if (interaction.user.id !== guild.ownerId) return interaction.reply({ content: 'Only the server owner can use this.', ephemeral: true });
      const [, kind, rawId] = interaction.customId.split(':');
      const memberId = rawId && rawId !== 'none' ? rawId : null;
      const names = commands.map(c => c.name).filter(name => name !== 'manage-cmnds');
      const blocked = memberId ? db.getUserRestrictions(guild.id, memberId) : db.getDisabledCommands(guild.id);
      const wantBlocked = kind === 'disabled' || kind === 'restricted';
      const list = names.filter(name => blocked.has(name) === wantBlocked);
      const labelOf = name => {
        const folder = HELP_FOLDERS.find(f => f.names.includes(name));
        return folder ? folder.label : 'Other';
      };
      const groups = new Map();
      list.forEach(name => {
        const label = labelOf(name);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push('/' + name);
      });
      const empty = wantBlocked ? 'Nothing is restricted.' : 'Nothing is blocked.';
      const body = groups.size ? [...groups.entries()].map(([label, items]) => `**${label}**\n${items.join('   ')}`).join('\n\n') : empty;
      const title = memberId
        ? (wantBlocked ? '⛔ Restricted commands' : '✅ Allowed commands')
        : (wantBlocked ? '⛔ Disabled commands' : '✅ Enabled commands');
      const content = `${title}\n${memberId ? `For <@${memberId}>\n\n` : ''}${body}\n\n${list.length} command(s)`;
      const updatePlain = interaction.__v2OriginalMethods?.update || interaction.update.bind(interaction);
      return updatePlain({ content, components: [] });
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.guildId && interaction.commandName !== 'manage-cmnds') {
      if (db.getDisabledCommands(interaction.guildId).has(interaction.commandName)) {
        return interaction.reply({ content: 'This command is disabled in this server.', ephemeral: true });
      }
      if (db.getUserRestrictions(interaction.guildId, interaction.user.id).has(interaction.commandName)) {
        return interaction.reply({ content: 'You are not allowed to use this command in this server.', ephemeral: true });
      }
    }

    const commandModule = COMMAND_MODULES[interaction.commandName];
    if (commandModule && interaction.guildId && Number(db.getSettings(interaction.guildId)[commandModule]) === 0) {
      return interaction.reply({
        content: '🔒 This module is turned off for this server. An admin can turn it on from the ZERON dashboard.',
        ephemeral: true
      });
    }
      const { commandName } = interaction;
      if (!interaction.guild || !interaction.guildId) return interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
      if (commandName === 'starboard') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'You need Manage Server permission to configure Starboard.', ephemeral: true });
        }
        const existing = db.getStarboardSettings(interaction.guild.id);
        const enabled = interaction.options.getBoolean('enabled', true);

        // Disabling only changes the status; saved channels and threshold are retained.
        if (!enabled) {
          if (!existing) {
            return interaction.reply({
              content: 'Starboard is not configured yet. No source or destination channel has been selected. Set up the channels and star threshold first, then you can disable it.',
              ephemeral: true
            });
          }
          const saved = db.saveStarboardSettings(interaction.guild.id, {
            sourceChannelId: existing.source_channel_id,
            destinationChannelId: existing.destination_channel_id,
            threshold: existing.threshold,
            enabled: false
          });
          return interaction.reply({
            content: [
              'Starboard has been disabled.',
              `Saved source channel: <#${saved.source_channel_id}>`,
              `Saved destination channel: <#${saved.destination_channel_id}>`,
              `Saved star threshold: ${saved.threshold}`,
              'Existing starboard posts will remain in the destination channel.'
            ].join('\n'),
            ephemeral: true
          });
        }

        const sourceOption = interaction.options.getChannel('source_channel');
        const destinationOption = interaction.options.getChannel('destination_channel');
        const thresholdOption = interaction.options.getInteger('threshold');
        const source = sourceOption || (existing ? await interaction.guild.channels.fetch(existing.source_channel_id).catch(() => null) : null);
        const destination = destinationOption || (existing ? await interaction.guild.channels.fetch(existing.destination_channel_id).catch(() => null) : null);
        const threshold = thresholdOption ?? existing?.threshold;

        if (!source || !destination || !threshold) {
          return interaction.reply({
            content: 'Starboard has no channel setup yet. To enable it, select a source channel, a destination channel, and a star threshold.',
            ephemeral: true
          });
        }
        if (!source.isTextBased() || source.guildId !== interaction.guild.id || typeof source.messages?.fetch !== 'function') {
          return interaction.reply({ content: 'Choose a text channel in this server as the source channel.', ephemeral: true });
        }
        if (!destination.isTextBased() || destination.guildId !== interaction.guild.id || typeof destination.send !== 'function') {
          return interaction.reply({ content: 'Choose a text channel in this server as the destination channel.', ephemeral: true });
        }
        if (source.id === destination.id) {
          return interaction.reply({ content: 'Source and destination channels must be different.', ephemeral: true });
        }
        const botMember = interaction.guild.members.me;
        const sourcePermissions = source.permissionsFor(botMember);
        const destinationPermissions = destination.permissionsFor(botMember);
        const sourceReady = sourcePermissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AddReactions
        ]);
        const destinationReady = destinationPermissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.AddReactions
        ]);
        if (!sourceReady || !destinationReady) {
          return interaction.reply({
            content: 'ZERON needs View Channel, Read Message History and Add Reactions in the source channel, plus View Channel, Send Messages, Embed Links, Attach Files and Add Reactions in the destination channel.',
            ephemeral: true
          });
        }
        const saved = db.saveStarboardSettings(interaction.guild.id, {
          sourceChannelId: source.id,
          destinationChannelId: destination.id,
          threshold,
          enabled: true
        });
        return interaction.reply({
          content: [
            'Starboard settings saved.',
            `Source channel: <#${saved.source_channel_id}>`,
            `Destination channel: <#${saved.destination_channel_id}>`,
            `Star threshold: ${saved.threshold} stars`,
            'Enabled: Yes',
            'ZERON will add a star reaction to new messages in the source channel and repost eligible messages when they reach the threshold.'
          ].join('\n'),
          ephemeral: true
        });
      }
      if (commandName === 'fish') {
      const embed = new EmbedBuilder()
        .setColor(db.accentColor(interaction.guildId))
        .setTitle('🎣 ZERON Fishing')
        .setDescription(
          'Go fishing, collect valuable catches, and sell your fishing inventory for coins.'
        )
        .setFooter({ text: 'Your fishing inventory is separate from your item inventory.' });

      return interaction.reply({
        embeds: [embed],
        components: [fishStartRow(interaction.guildId, interaction.user.id)]
      });
    }

    if (commandName === 'play') {
        return interaction.reply({
          content: slotsWagerPrompt(),
          components: [slotsWagerRow(interaction.user.id)]
        });
      }

      const guild = interaction.guild;
      const actor = interaction.member;
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const target = interaction.options.getUser('user');
      const targetMember = target ? await guild.members.fetch(target.id).catch(() => null) : null;
      if (commandName === 'track-invite') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'You need Manage Server permission.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        const enabled = interaction.options.getBoolean('enabled');

        if (!channel || channel.guildId !== guild.id ||
            !channel.isTextBased() || typeof channel.send !== 'function') {
          return interaction.reply({
            content: 'Choose a text channel in this server.',
            ephemeral: true
          });
        }

        const botMember = guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: 'ZERON needs Manage Server permission to inspect invite usage.',
            ephemeral: true
          });
        }

        db.saveInviteTrackerSettings(guild.id, channel.id, enabled);

        let snapshotReady = true;
        if (enabled) {
          snapshotReady = await refreshInviteSnapshot(guild);
        } else {
          inviteSnapshots.delete(guild.id);
        }

        const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        return replyPlain({
          content: !enabled
            ? `Invite tracking disabled. The selected log channel is <#${channel.id}>. Existing tracked history is preserved.`
            : snapshotReady
              ? `Invite tracking enabled. Join logs will be sent to <#${channel.id}>. Inviter attribution will show Unknown whenever it cannot be confirmed.`
              : `Invite tracking is enabled and logs are configured for <#${channel.id}>, but Discord did not allow ZERON to read the current invite snapshot. New joins may show Unknown until access is fixed. Check the startup/command logs for the Discord error code.`,
          ephemeral: true
        });
      }

      if (commandName === 'welcome') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'You need Manage Server permission.', ephemeral: true });
        }

        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const message = interaction.options.getString('message');
        const patch = {};

        if (enabled !== null) patch.welcome_enabled = enabled ? 1 : 0;

        if (channel) {
          if (!channel.isTextBased() || channel.guildId !== guild.id) {
            const plainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
            return plainReply({ content: 'Choose a text channel in this server.', ephemeral: true });
          }
          patch.welcome_channel_id = channel.id;
        }

        if (message !== null) patch.welcome_message = message;

        if (Object.keys(patch).length === 0) {
          const plainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
          return plainReply({ content: 'Choose at least one option: enabled, channel, or message.', ephemeral: true });
        }

        db.saveSettings(guild.id, patch);
        const saved = db.getSettings(guild.id);
        const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        return sendPlainReply({
          content: 'Welcome settings updated!\n' +
            '**Status:** ' + (saved.welcome_enabled ? 'Enabled' : 'Disabled') + '\n' +
            '**Channel:** ' + (saved.welcome_channel_id ? '<#' + saved.welcome_channel_id + '>' : 'Not configured') + '\n' +
            '**Message:** ' + (message !== null ? 'Updated' : 'Existing message preserved'),
          ephemeral: true
        });
      }
      if (commandName === 'enable-level-up') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: 'You need Manage Server permission to configure XP and leveling.',
            ephemeral: true
          });
        }

        const enabled = interaction.options.getBoolean('enabled', true);
        const channel = interaction.options.getChannel('channel');
        const message = interaction.options.getString('message');
        const patch = {
          xp_enabled: enabled ? 1 : 0,
          levelup_enabled: enabled ? 1 : 0
        };

        if (channel) {
          if (!channel.isTextBased() || channel.guildId !== guild.id) {
            return interaction.reply({
              content: 'Please choose a text channel in this server.',
              ephemeral: true
            });
          }
          patch.xp_channel_id = channel.id;
        }

        if (message !== null) patch.levelup_message = message;

        db.saveSettings(guild.id, patch);

        const saved = db.getSettings(guild.id);
        const channelText = saved.xp_channel_id
          ? '<#' + saved.xp_channel_id + '>'
          : 'the channel where the member earns XP';

        const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        return sendPlainReply({
          content: 'XP earning and level-up announcements are now **' +
            (enabled ? 'ENABLED' : 'DISABLED') + '**.' +
            '\n**Announcement channel:** ' + channelText +
            (message !== null ? '\n**Custom message:** saved.' : '\nExisting custom message preserved.'),
          ephemeral: true
        });
      }

      if (commandName === 'role-reward') {
        const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return replyPlain({ content: 'You need Manage Server permission to manage level rewards.', ephemeral: true });
        }

        const level = interaction.options.getInteger('level', true);
        const enabled = interaction.options.getBoolean('enabled', true);
        const role = interaction.options.getRole('role');

        if (!enabled) {
          const removed = db.deleteLevelReward(guild.id, level);
          return replyPlain({
            content: removed
              ? '✅ Removed the role reward for level **' + level + '**.'
              : 'There was no role reward set for level **' + level + '**.',
            ephemeral: true
          });
        }

        if (!role) {
          return replyPlain({ content: 'Choose a role to give. The role option is required when enabled is true.', ephemeral: true });
        }
        if (role.managed || role.id === guild.id) {
          return replyPlain({ content: 'That role cannot be assigned to members.', ephemeral: true });
        }

        const botMember = guild.members.me;
        if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return replyPlain({ content: 'ZERON needs the Manage Roles permission before it can give rewards.', ephemeral: true });
        }
        if (role.position >= botMember.roles.highest.position) {
          return replyPlain({
            content: 'ZERON cannot give <@&' + role.id + '>. Move ZERON\'s role above it in Server Settings → Roles.',
            ephemeral: true
          });
        }

        db.setLevelReward(guild.id, level, role.id);
        return replyPlain({
          content: '✅ Members who reach level **' + level + '** will receive <@&' + role.id + '>. Rewards stack, so earlier level roles are kept.',
          ephemeral: true
        });
      }

      if (commandName === 'poll') {
        const action = interaction.options.getString('action', true);
        const permission = interaction.memberPermissions;
        if (['create', 'end'].includes(action) &&
            !permission?.has(PermissionFlagsBits.ManageMessages) &&
            !permission?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: 'Only administrators and moderators with Manage Messages can create or close polls.', ephemeral: true });
        }
        const guild = interaction.guild;
        if (action === 'create') {
          const question = (interaction.options.getString('question') || '').trim();
          if (!question) return interaction.reply({ content: 'The poll question cannot be empty.', ephemeral: true });
          const optionText = interaction.options.getString('options') || '';
          const options = optionText.split('|').map(value => value.trim()).filter(Boolean);
          const unique = new Set(options.map(value => value.toLocaleLowerCase()));
          if (options.length < 2 || options.length > 10 || unique.size !== options.length || options.some(value => value.length > 80)) {
            return interaction.reply({ content: 'Provide 2–10 different options separated by |. Each option must be 80 characters or fewer.', ephemeral: true });
          }
          const duration = interaction.options.getInteger('duration') ?? 1440;
          const anonymous = interaction.options.getBoolean('anonymous') ?? false;
          const multiple = interaction.options.getBoolean('multiple') ?? false;
          const allowChange = interaction.options.getBoolean('allow_change') ?? true;
          const requiredRole = interaction.options.getRole('required_role');
          const me = guild.members.me;
          const channelPermissions = interaction.channel?.permissionsFor(me);
          if (!interaction.channel?.isTextBased?.() || !channelPermissions?.has(PermissionFlagsBits.SendMessages) || !channelPermissions?.has(PermissionFlagsBits.EmbedLinks)) {
            return interaction.reply({ content: 'ZERON needs Send Messages and Embed Links permission in this channel to publish polls.', ephemeral: true });
          }
          const createdAt = Date.now();
          const endsAt = createdAt + duration * 60 * 1000;
          const pollId = db.createPoll(guild.id, {
            channelId: interaction.channelId, question, options, createdBy: interaction.user.id,
            createdAt, endsAt, anonymous, multiple, allowChange, requiredRoleId: requiredRole?.id || null
          });
          const poll = db.getPoll(guild.id, pollId);
          await interaction.deferReply({ ephemeral: true });
          try {
            const message = await interaction.channel.send(pollV2Payload(poll, [], false));
            db.setPollMessage(pollId, message.id);
            return interaction.editReply({ content: 'Poll #' + pollId + ' published in this channel. It closes <t:' + Math.floor(endsAt / 1000) + ':R>.' });
          } catch (error) {
            db.closePoll(guild.id, pollId);
            console.error('Poll publish failed:', error.message);
            return interaction.editReply({ content: 'ZERON could not publish the poll. Check its channel permissions and try again.' });
          }
        }
        if (action === 'list') {
          const active = db.listActivePolls(guild.id);
          if (!active.length) return interaction.reply({ content: 'There are no active polls in this server.', ephemeral: true });
          const body = active.map(poll => '**#' + poll.id + '** · ' + poll.question.slice(0, 120) + '\n<#' + poll.channel_id + '> · closes <t:' + Math.floor(poll.ends_at / 1000) + ':R>').join('\n\n');
          return interaction.reply({ content: '📊 **Active polls**\n' + body, ephemeral: true });
        }
        const pollId = interaction.options.getInteger('poll_id');
        if (!pollId) return interaction.reply({ content: 'Choose a Poll ID when using End or Results.', ephemeral: true });
        const poll = db.getPoll(guild.id, pollId);
        if (!poll) return interaction.reply({ content: 'Poll #' + pollId + ' was not found in this server.', ephemeral: true });
        if (action === 'end') {
          if (poll.status !== 'active') return interaction.reply({ content: 'Poll #' + pollId + ' is already closed.', ephemeral: true });
          db.closePoll(guild.id, pollId);
          const closedPoll = { ...poll, status: 'closed' };
          const channel = await guild.channels.fetch(poll.channel_id).catch(() => null);
          const message = channel && poll.message_id ? await channel.messages.fetch(poll.message_id).catch(() => null) : null;
          if (message) await message.edit(pollV2Payload(closedPoll, db.getPollVotes(pollId), true)).catch(() => {});
          return interaction.reply({ content: 'Poll #' + pollId + ' has been closed. Final results are available with /poll results.', ephemeral: true });
        }
        if (action === 'results') {
          const closed = poll.status !== 'active' || Number(poll.ends_at) <= Date.now();
          return interaction.reply({
            ...pollV2Payload({ ...poll, status: closed ? 'closed' : poll.status }, db.getPollVotes(pollId), closed),
            flags: require('discord.js').MessageFlags.IsComponentsV2 | require('discord.js').MessageFlags.Ephemeral
          });
        }
      }

      if (commandName === 'trivia') {
        if (!interaction.guild) return (interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction))({ content: 'Use this inside a server.', ephemeral: true });
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return (interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction))({ content: 'You need Manage Server to run trivia.', ephemeral: true });
        }
        const guild = interaction.guild;
        const accent = db.accentColor(guild.id);

        if (interaction.options.getBoolean('cancel')) {
          if (!db.getActiveTrivia(guild.id)) return (interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction))({ content: 'No trivia is running right now.', ephemeral: true });
          db.cancelTrivia(guild.id);
          return (interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction))({ content: 'Trivia cancelled.', ephemeral: true });
        }

        const question = (interaction.options.getString('question') || '').trim();
        const answer = (interaction.options.getString('answer') || '').trim();
        const reward = interaction.options.getInteger('reward') ?? 100;
        if (!question || !answer) {
          return (interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction))({ content: 'Give a question and an answer, for example `/trivia question:Capital of France? answer:Paris|Paris France`.', ephemeral: true });
        }
        if (db.getActiveTrivia(guild.id)) {
          return (interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction))({ content: 'A trivia is already running. Cancel it first with `/trivia cancel:true`.', ephemeral: true });
        }

        const endsAt = Date.now() + 10 * 60 * 1000;
        db.startTrivia(guild.id, interaction.channel.id, question.slice(0, 300), answer.slice(0, 200), reward, interaction.user.id, endsAt);
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(accent)
            .setTitle('🧠 Trivia time!')
            .setDescription(question.slice(0, 300))
            .addFields({ name: 'Reward', value: coinText(reward) + ' for the first correct answer', inline: true })
            .setFooter({ text: 'Type your answer in this channel. Ends in 10 minutes.' })]
        });
      }

      if (commandName === 'manage-cmnds') {
        const guild = interaction.guild;
        const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        const deferPlain = interaction.__v2OriginalMethods?.deferReply || interaction.deferReply.bind(interaction);
        const editPlain = interaction.__v2OriginalMethods?.editReply || interaction.editReply.bind(interaction);
        if (interaction.user.id !== guild.ownerId) return replyPlain({ content: 'Only the server owner can use this command.', ephemeral: true });
        const target = interaction.options.getUser('user');
        if (interaction.options.getString('action') === 'show') {
          const suffix = target ? target.id : 'none';
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`zeron_enable_list:${target ? 'allowed' : 'enabled'}:${suffix}`).setLabel(target ? 'Allowed for member' : 'Enabled list').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`zeron_enable_list:${target ? 'restricted' : 'disabled'}:${suffix}`).setLabel(target ? 'Restricted for member' : 'Disabled list').setEmoji('⛔').setStyle(ButtonStyle.Danger)
          );
          return replyPlain({ content: target ? `Which list for ${target.username}?` : 'Which list do you want to see?', components: [row], ephemeral: true });
        }
        const name = String(interaction.options.getString('command') || '').trim().toLowerCase();
        if (!name) return replyPlain({ content: 'Pick a command, then True or False.', ephemeral: true });
        if (name === 'manage-cmnds' || !commands.some(c => c.name === name)) {
          return replyPlain({ content: 'That is not a command. Pick one from the list.', ephemeral: true });
        }
        const enable = interaction.options.getString('action') === 'true';
        await deferPlain({ ephemeral: true });
        if (target) {
          if (target.bot || target.id === guild.ownerId) return editPlain('You cannot restrict a bot or the server owner.');
          db.setUserRestriction(guild.id, target.id, name, !enable);
          await applyCommandVisibility(guild, [name]).catch(() => {});
          return interaction.editReply(enable
            ? `✅ **/${name}** is allowed again for ${target.username}.`
            : `⛔ **/${name}** is restricted for ${target.username}. They cannot see or use it.`);
        }
        db.setCommandEnabled(guild.id, name, enable);
        await applyCommandVisibility(guild, [name]).catch(() => {});
        return interaction.editReply(enable
          ? `✅ **/${name}** is enabled. It is shown in help and works again.`
          : `⛔ **/${name}** is disabled. It is hidden here and cannot be used.`);
      }

      if (commandName === 'roblox') {
        const guild = interaction.guild;
        const action = interaction.options.getString('action');
        if (action === 'unlink') {
          const removed = db.clearRobloxLink(guild.id, interaction.user.id);
          const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
          return sendPlainReply({ content: removed ? '✅ Your Roblox account is unlinked.' : 'You have not linked a Roblox account here.', ephemeral: true });
        }
        // Link: the username is filled in from the member's own name when they do not type one.
        const username = String(interaction.options.getString('username') || interaction.user.username || '').trim();
        if (!username) return (interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction))({ content: 'Give your Roblox username, for example: action Link, username yourname.', ephemeral: true });
        const deferPlainReply = interaction.__v2OriginalMethods?.deferReply || interaction.deferReply.bind(interaction);
        const editPlainReply = interaction.__v2OriginalMethods?.editReply || interaction.editReply.bind(interaction);
        await deferPlainReply({ ephemeral: true });
        const info = await fetchRobloxUser(username).catch(() => null);
        if (!info) return editPlainReply({ content: 'No Roblox user found with that name.' });
        db.setRobloxLink(guild.id, interaction.user.id, info);
        return editPlainReply({ content: `✅ Linked Roblox **${info.displayName}** (@${info.username}). It now shows in /userinfo.` });
      }

      if (commandName === 'vaultalert') {
        const guild = interaction.guild;
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'You need the Manage Server permission to use this.', ephemeral: true });
        }
        const action = interaction.options.getString('action');
        if (action === 'list') {
          const rules = db.listVaultRules(guild.id);
          if (!rules.length) return interaction.reply({ content: 'No vault alerts are set up. Use action Add.', ephemeral: true });
          const lines = rules.map(rule => {
            const channel = guild.channels.cache.get(rule.channel_id);
            const role = guild.roles.cache.get(rule.role_id);
            return `• **${rule.label} Vault** → ${channel ? `#${channel.name}` : 'missing channel'} → ${role ? `@${role.name}` : 'missing role'}`;
          });
          return interaction.reply({ content: `**Vault alerts**\n${lines.join('\n')}`, ephemeral: true });
        }
        const label = String(interaction.options.getString('vault') || '').trim().replace(/\s*vault$/i, '');
        if (!label) return interaction.reply({ content: 'Give a vault name, for example Sapphire.', ephemeral: true });
        const key = label.toLowerCase();
        if (action === 'remove') {
          const removed = db.deleteVaultRule(guild.id, key);
          return interaction.reply({ content: removed ? `✅ Stopped pinging for **${label} Vault**.` : `No alert set up for **${label} Vault**.`, ephemeral: true });
        }
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('role');
        if (!channel || !role) return interaction.reply({ content: 'For Add, give the vault, the channel, and the role.', ephemeral: true });
        if (!channel.isTextBased()) return interaction.reply({ content: 'Pick a text or announcement channel.', ephemeral: true });
        db.setVaultRule(guild.id, key, label, channel.id, role.id);
        const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        return sendPlainReply({
          content: `✅ Watching #${channel.name} for **${label} Vault**. **@${role.name}** will be pinged when it shows up.`,
          ephemeral: true
        });
      }

      if (commandName === 'vaultpost') {
        const djs = require('discord.js');
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'You need the Manage Server permission to use this.', flags: djs.MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: djs.MessageFlags.Ephemeral });
        const vault = interaction.options.getString('vault');
        const rule = db.listVaultRules(interaction.guild.id).find(item => item.vault === vault);
        if (!rule) return interaction.editReply({ content: 'No alert rule for that vault. Add one with /vaultalert action:Add.' });
        const waitMs = VAULT_COOLDOWN_MS - (Date.now() - (vaultCooldown.get(`${interaction.guild.id}:${rule.vault}`) || 0));
        if (waitMs > 0) {
          return interaction.editReply({ content: `⏳ The ${rule.label} Vault was posted recently. Try again in ${Math.ceil(waitMs / 60000)} min.` });
        }
        const posted = await postVaultNow(interaction.guild, rule);
        if (!posted) return interaction.editReply({ content: 'The vault intel channel is missing or the bot cannot post there.' });
        const editPlainReply = interaction.__v2OriginalMethods?.editReply || interaction.editReply.bind(interaction);
        return editPlainReply({ content: `✅ The ${rule.label} Vault was posted in <#${rule.channel_id}>.` });
      }

      if (commandName === 'aichat') {
        const guildForAi = interaction.guild;
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'You need the Manage Server permission to use this.', ephemeral: true });
        }
        const action = interaction.options.getString('action');
        const selectedChannel = interaction.options.getChannel('channel');
        const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);

        if (action === 'off') {
          if (selectedChannel) {
            const removed = db.removeAiChannel(guildForAi.id, selectedChannel.id);
            return sendPlainReply({
              content: removed
                ? `✅ AI chat is off in ${selectedChannel}.`
                : `AI chat was not enabled in ${selectedChannel}.`,
              ephemeral: true
            });
          }
          db.clearAiChannels(guildForAi.id);
          return sendPlainReply({ content: '✅ AI chat is off in all channels.', ephemeral: true });
        }

        const aiChannel = selectedChannel || interaction.channel;
        if (!aiChannel || !aiChannel.isTextBased()) {
          return sendPlainReply({ content: 'Pick a text or announcement channel.', ephemeral: true });
        }
        const added = db.addAiChannel(guildForAi.id, aiChannel.id);
        return sendPlainReply({
          content: added
            ? `✅ AI chat is on in ${aiChannel}. I'll chat naturally with members in that channel.`
            : `AI chat is already on in ${aiChannel}.`,
          ephemeral: true
        });
      }

      if (commandName === 'jail') {
        const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        const deferPlain = interaction.__v2OriginalMethods?.deferReply || interaction.deferReply.bind(interaction);
        const editPlain = interaction.__v2OriginalMethods?.editReply || interaction.editReply.bind(interaction);
        const guild = interaction.guild;
        const target = interaction.options.getMember('user');
        const reason = 'Jailed by the server owner';
        const me = guild.members.me;
        if (interaction.user.id !== guild.ownerId) return replyPlain({ content: 'Only the server owner can use this command.', ephemeral: true });
        const jailRoleId = db.getSettings(guild.id).jail_role_id;
        const jailRole = jailRoleId ? guild.roles.cache.get(jailRoleId) : null;
        if (!jailRole) return replyPlain({ content: 'Set a jail role first on the dashboard (Jail page).', ephemeral: true });
        if (!target) return replyPlain({ content: 'That member is not in this server.', ephemeral: true });
        if (target.user.bot) return replyPlain({ content: 'You cannot jail a bot.', ephemeral: true });
        if (target.id === interaction.user.id) return replyPlain({ content: 'You cannot jail yourself.', ephemeral: true });
        if (target.id === guild.ownerId) return replyPlain({ content: 'You cannot jail the server owner.', ephemeral: true });
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return replyPlain({ content: 'ZERON needs the Manage Roles permission.', ephemeral: true });
        if (jailRole.id === guild.id || jailRole.managed || jailRole.position >= me.roles.highest.position) {
          return replyPlain({ content: 'Pick a role below ZERON\'s highest role that is not managed by an integration.', ephemeral: true });
        }
        if (target.roles.highest.position >= me.roles.highest.position) {
          return replyPlain({ content: 'ZERON cannot manage that member, because their top role is above ZERON.', ephemeral: true });
        }
        if (interaction.user.id !== guild.ownerId && target.roles.highest.position >= interaction.member.roles.highest.position) {
          return replyPlain({ content: 'You cannot jail someone with the same or a higher role than yours.', ephemeral: true });
        }
        if (db.getJail(guild.id, target.id)) {
          return replyPlain({ content: `${target.user.username} is already jailed. Use /unjail first.`, ephemeral: true });
        }
        await deferPlain({ ephemeral: true });
        const toRemove = target.roles.cache
          .filter(role => role.id !== guild.id && role.id !== jailRole.id && role.editable)
          .map(role => role.id);
        try {
          db.setJail(guild.id, target.id, jailRole.id, JSON.stringify(toRemove), Date.now());
          await target.roles.add(jailRole, reason);
          if (toRemove.length) await target.roles.remove(toRemove, reason);
        } catch (error) {
          return editPlain(`Could not jail ${target.user.username}: ${error.message}`);
        }
        writeLog(guild, 'jail', target.id, reason, interaction.user.id);
        return editPlain(`🔒 **${target.user.username}** is jailed with **${jailRole.name}**. ${toRemove.length} role(s) saved for /unjail.`);
      }

      if (commandName === 'unjail') {
        const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        const deferPlain = interaction.__v2OriginalMethods?.deferReply || interaction.deferReply.bind(interaction);
        const editPlain = interaction.__v2OriginalMethods?.editReply || interaction.editReply.bind(interaction);
        const guild = interaction.guild;
        const target = interaction.options.getMember('user');
        const me = guild.members.me;
        if (interaction.user.id !== guild.ownerId) return replyPlain({ content: 'Only the server owner can use this command.', ephemeral: true });
        if (!target) return replyPlain({ content: 'That member is not in this server.', ephemeral: true });
        const record = db.getJail(guild.id, target.id);
        if (!record) return replyPlain({ content: `${target.user.username} is not jailed.`, ephemeral: true });
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return replyPlain({ content: 'ZERON needs the Manage Roles permission.', ephemeral: true });
        await deferPlain({ ephemeral: true });
        const saved = JSON.parse(record.roles || '[]');
        const restore = saved.filter(id => {
          const role = guild.roles.cache.get(id);
          return role && role.editable && !target.roles.cache.has(id);
        });
        try {
          if (target.roles.cache.has(record.jailed_role_id)) await target.roles.remove(record.jailed_role_id, 'Unjailed');
          if (restore.length) await target.roles.add(restore, 'Unjailed');
        } catch (error) {
          return editPlain(`Could not unjail ${target.user.username}: ${error.message}`);
        }
        db.clearJail(guild.id, target.id);
        writeLog(guild, 'unjail', target.id, 'Roles restored', interaction.user.id);
        return editPlain(`🔓 **${target.user.username}** is unjailed. ${restore.length} role(s) restored.`);
      }

      if (commandName === 'afk') {
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const action = interaction.options.getString('action');
        const plainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        if (action === 'off') {
          if (!db.getAfk(guildId, userId)) return plainReply({ content: 'You are not AFK right now.', ephemeral: true });
          db.clearAfk(guildId, userId);
          return plainReply({ content: '✅ AFK is now off. Welcome back!', ephemeral: true });
        }
        const reason = (interaction.options.getString('reason') || '').trim() || 'No reason given';
        db.setAfk(guildId, userId, reason, Date.now());
        return plainReply({ content: `💤 AFK is now on: ${reason}`, ephemeral: true });
      }

      if (commandName === 'birthday') {
        const action = interaction.options.getString('action') || 'view';
        const accent = parseInt(String(db.getSettings(guild.id).rank_accent || '#46BBFF').slice(1), 16) || 0x46BBFF;

        if (action === 'set') {
          const modal = new ModalBuilder().setCustomId('nx-birthday-set').setTitle('Set your birthday');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('day').setLabel('Day (1 to 31)')
              .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(2).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('month').setLabel('Month (1 to 12)')
              .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(2).setRequired(true))
          );
          return interaction.showModal(modal);
        }
        if (action === 'remove') {
          const removed = db.removeBirthday(guild.id, interaction.user.id);
          const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
          return sendPlainReply({
            content: removed
              ? '### 🗑️ Birthday removed\nYour birthday has been removed from this server.'
              : 'You have not saved a birthday here yet.',
            ephemeral: true
          });
        }

        const target = interaction.options.getUser('user') || interaction.user;
        const saved = db.getBirthday(guild.id, target.id);
        const description = saved
          ? '**' + formatBirthday(saved.day, saved.month) + '**'
          : target.id === interaction.user.id
            ? 'You have not set a birthday yet. Use `/birthday set`.'
            : target.username + ' has not set a birthday yet.';
        const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        return sendPlainReply({
          content: '-# ' + target.username + '\n### 🎂 Birthday\n' + description
        });
      }

      if (commandName === 'help') {
        return interaction.reply({ embeds: [helpListEmbed(db.accentColor(interaction.guildId), helpHiddenFor(interaction))], components: helpComponents(), ephemeral: true });
      }

      if (commandName === 'serverinfo') {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(db.accentColor(guild.id)).setTitle(guild.name)
          .setThumbnail(guild.iconURL()).addFields(
            { name: 'Server ID', value: guild.id, inline: true },
            { name: 'Members', value: String(guild.memberCount), inline: true },
            { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true }
          )] });
      }
      if (commandName === 'userinfo') {
        const djs = require('discord.js');
        const invoker = interaction.user;
        const discordPick = interaction.options.getUser('discord-user');
        const robloxPick = interaction.options.getUser('roblox-user');
        const noPick = !discordPick && !robloxPick;
        // No option: both cards for the caller (Roblox only if linked). discord-user: that member's Discord card. roblox-user: that member's Roblox card.
        const discordTarget = discordPick || (noPick ? invoker : null);
        const robloxTarget = robloxPick || (noPick ? invoker : null);
        const robloxLink = robloxTarget ? db.getRobloxLink(guild.id, robloxTarget.id) : null;
        const showDiscord = !!discordTarget;
        const showRoblox = !!robloxTarget && (!!robloxPick || !!robloxLink);
        const color = db.accentColor(guild.id);
        const accent = typeof color === 'number' ? color : parseInt(String(color).replace('#', ''), 16);
        const components = [];

        if (showRoblox) {
          const link = robloxLink;
          const roblox = new djs.ContainerBuilder().setAccentColor(accent);
          if (link) {
            const details = await fetchRobloxDetails(link.roblox_id);
            const headline = `### Roblox Information\n**[${link.display_name || link.username}](https://www.roblox.com/users/${link.roblox_id}/profile)**\n@${link.username}${details && details.created ? `\nAccount Created: <t:${Math.floor(Date.parse(details.created) / 1000)}:F>` : ''}`;
            if (link.avatar_url) {
              roblox.addSectionComponents(new djs.SectionBuilder()
                .addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(headline))
                .setThumbnailAccessory(new djs.ThumbnailBuilder().setURL(link.avatar_url)));
            } else {
              roblox.addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(headline));
            }
            roblox.addSeparatorComponents(new djs.SeparatorBuilder().setDivider(true).setSpacing(djs.SeparatorSpacingSize.Small));
            roblox.addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(
              `### Description\n${details && details.description ? details.description.slice(0, 1500) : '*No description.*'}`));
          } else {
            roblox.addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(
              `### Roblox Information\n${robloxTarget.username} has not linked a Roblox account in this server.`));
          }
          components.push(roblox);
        }

        if (showDiscord) {
          const member = guild.members.cache.get(discordTarget.id) || await guild.members.fetch(discordTarget.id).catch(() => null);
          const name = member ? member.displayName : (discordTarget.globalName || discordTarget.username);
          const topRole = member && member.roles.highest.id !== guild.id ? member.roles.highest.name : 'None';
          const joined = member && member.joinedTimestamp ? `\nJoined Server: <t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : '';
          components.push(new djs.ContainerBuilder().setAccentColor(accent).addSectionComponents(
            new djs.SectionBuilder()
              .addTextDisplayComponents(new djs.TextDisplayBuilder().setContent(
                `### Discord Information\n**${name}**  ·  @${discordTarget.username}\nAccount Created: <t:${Math.floor(discordTarget.createdTimestamp / 1000)}:F>${joined}\nTop role: ${topRole}`))
              .setThumbnailAccessory(new djs.ThumbnailBuilder().setURL(discordTarget.displayAvatarURL({ size: 256 })))
          ));
        }

        await interaction.reply({ components, flags: djs.MessageFlags.IsComponentsV2 });

        // One time for the caller: explain Roblox linking if they have not linked yet.
        if (noPick && !robloxLink && !db.hasSeenTip(guild.id, invoker.id, 'roblox-link')) {
          db.markTipSeen(guild.id, invoker.id, 'roblox-link');
          await interaction.followUp({
            content: '🔗 **Link your Roblox account**\nYou have not linked Roblox in this server yet. Use `/roblox action:Link` and your Roblox card will appear in /userinfo.',
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      if (['kick','ban','timeout','untimeout'].includes(commandName)) {
        const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        const permission = { kick: PermissionFlagsBits.KickMembers, ban: PermissionFlagsBits.BanMembers,
          timeout: PermissionFlagsBits.ModerateMembers, untimeout: PermissionFlagsBits.ModerateMembers }[commandName];
        if (!interaction.memberPermissions?.has(permission)) return replyPlain({ content: 'You do not have permission to do that.', ephemeral: true });
        if (!guild.members.me?.permissions.has(permission)) return replyPlain({ content: 'ZERON lacks the required server permission.', ephemeral: true });
        if (commandName === 'unban') { /* handled below */ }
        if (!targetMember) return replyPlain({ content: 'That member is not in this server.', ephemeral: true });
        if (targetMember.id === interaction.user.id) return replyPlain({ content: 'You cannot moderate yourself.', ephemeral: true });
        if (targetMember.id === guild.ownerId) return replyPlain({ content: 'The server owner cannot be moderated by this command.', ephemeral: true });
        if (targetMember.roles.highest.position >= guild.members.me.roles.highest.position) return replyPlain({ content: 'ZERON role must be higher than the target member role.', ephemeral: true });
        if (actor.roles?.highest?.position <= targetMember.roles.highest.position && interaction.user.id !== guild.ownerId) return replyPlain({ content: 'Your highest role must be higher than the target member role.', ephemeral: true });
        if (commandName === 'kick') await targetMember.kick(reason);
        if (commandName === 'ban') await targetMember.ban({ reason });
        if (commandName === 'timeout') {
          const minutes = interaction.options.getInteger('minutes');
          await targetMember.timeout(minutes * 60 * 1000, reason);
        }
        if (commandName === 'untimeout') await targetMember.timeout(null, 'Timeout removed by moderator');
        await writeLog(guild, commandName, targetMember.id, reason, interaction.user.id);
        return replyPlain({ content: `✅ ${target.tag} — ${commandName} completed.`, ephemeral: true });
      }
      if (commandName === 'unban') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) return replyPlain({ content: 'You need Ban Members permission.', ephemeral: true });
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) return replyPlain({ content: 'ZERON lacks Ban Members permission.', ephemeral: true });
        const userId = interaction.options.getString('user_id');
        if (!/^\d{17,20}$/.test(userId)) return replyPlain({ content: 'Enter a valid Discord user ID.', ephemeral: true });
        await guild.members.unban(userId, reason);
        await writeLog(guild, 'unban', userId, reason, interaction.user.id);
        return replyPlain({ content: `✅ Unbanned user ID ${userId}.`, ephemeral: true });
      }
      if (commandName === 'purge') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'You need Manage Messages permission.', ephemeral: true });
        if (!guild.members.me?.permissionsIn(interaction.channel).has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'ZERON needs Manage Messages in this channel.', ephemeral: true });
        const amount = interaction.options.getInteger('amount');
        const deferPlainReply = interaction.__v2OriginalMethods?.deferReply || interaction.deferReply.bind(interaction);
        const editPlainReply = interaction.__v2OriginalMethods?.editReply || interaction.editReply.bind(interaction);
        await deferPlainReply({ ephemeral: true });
        const channel = interaction.channel;
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        let remaining = amount === 0 ? Infinity : amount;
        let deleted = 0;
        let lastId;
        let oldSkipped = 0;
        // Works through the channel 100 messages at a time, newest first.
        while (remaining > 0) {
          const batch = await channel.messages.fetch({ limit: Math.min(100, remaining), ...(lastId ? { before: lastId } : {}) }).catch(() => null);
          if (!batch || batch.size === 0) break;
          lastId = batch.last().id;
          const now = Date.now();
          const recent = [...batch.values()].filter(m => now - m.createdTimestamp < fourteenDays);
          const old = [...batch.values()].filter(m => now - m.createdTimestamp >= fourteenDays);
          if (recent.length) {
            const result = await channel.bulkDelete(recent, true).catch(() => null);
            deleted += result ? result.size : 0;
          }
          // Discord cannot bulk delete messages older than 14 days, so they are removed one by one.
          for (const message of old) {
            const removed = await message.delete().then(() => true).catch(() => false);
            if (removed) deleted++; else oldSkipped++;
            await new Promise(resolve => setTimeout(resolve, 1100));
          }
          remaining -= batch.size;
          // Let the event loop breathe between batches, so long purges never delay the Discord connection.
          await new Promise(resolve => setImmediate(resolve));
          await editPlainReply({ content: `🧹 Deleting… ${deleted} of ${amount === 0 ? 'all' : amount} messages done so far.` }).catch(() => {});
        }
        await writeLog(guild, 'purge', null, `${deleted} messages deleted`, interaction.user.id);
        const note = oldSkipped ? ` ${oldSkipped} messages could not be deleted.` : '';
        return editPlainReply({ content: `🧹 Done. Deleted ${deleted} messages.${note}` }).catch(() => {});
      }
      if (commandName === 'ping') {
        const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        // One short line: response time, gateway latency, and a status dot.
        const roundtrip = Date.now() - interaction.createdTimestamp;
        const gateway = interaction.client.ws.ping;
        const dot = roundtrip < 300 ? '🟢' : roundtrip < 800 ? '🟡' : '🔴';
        return replyPlain({
          content: `🏓 **${roundtrip} ms** · gateway **${gateway >= 0 ? gateway + ' ms' : 'n/a'}** ${dot}`
        });
      }

      if (commandName === 'rank') {
        const user = target || interaction.user;
        const member = guild.members.cache.get(user.id);
        const displayName = member?.displayName || user.globalName || user.username;
        const row = db.getXp(guild.id, user.id);
        const rank = db.getRank(guild.id, user.id) ?? '—';
        const level = row.level;
        const xp = row.xp;
        const xpIntoLevel = Math.max(0, xp - level * level * 100);
        const xpNeeded = ((level + 1) ** 2 - level ** 2) * 100;

        await interaction.deferReply();
        const savedBackground = db.getRankBackground(guild.id, user.id);
        const background = savedBackground
          ? (savedBackground.kind === 'preset'
            ? { key: 'preset:' + savedBackground.preset + ':' + savedBackground.updated_at, buffer: loadPresetBackground(savedBackground.preset) }
            : { key: 'custom:' + savedBackground.updated_at, buffer: savedBackground.image })
          : null;

        // Reuse the user's last downloaded avatar across restarts. Discord's
        // avatar URL changes when their profile picture changes, invalidating
        // the old cached image automatically.
        const avatarKey = user.displayAvatarURL({ extension: 'png', size: 256 });
        let avatarBuffer = db.getRankAvatar(user.id, avatarKey);
        if (!avatarBuffer) {
          try {
            avatarBuffer = await downloadAvatar(avatarKey);
            db.setRankAvatar(user.id, avatarKey, avatarBuffer);
          } catch (error) {
            console.warn('Rank avatar cache miss:', error.message);
          }
        }

        const image = await renderRankCard({
          user, displayName, xp, level, rank, xpIntoLevel, xpNeeded,
          accent: db.getSettings(guild.id).rank_accent, background, avatarBuffer
        });

        return interaction.editReply({
          files: [new AttachmentBuilder(image, { name: 'zeron-rank.png' })]
        });
      }


      if (commandName === 'devgive') {
        const djs = require('discord.js');
        if (interaction.user.id !== '1560621828982968470') {
          return interaction.reply({ content: '🔒 Only the ZERON developer can use this command.', ephemeral: true });
        }
        const guildForGive = interaction.guild;
        const amount = interaction.options.getInteger('amount', true);
        const user = interaction.options.getUser('user');
        const role = interaction.options.getRole('role');
        const reason = (interaction.options.getString('reason') || 'Developer transfer').trim();
        if (!user && !role) return interaction.reply({ content: 'Pick a member or a role.', ephemeral: true });
        if (user && role) return interaction.reply({ content: 'Pick either a member or a role, not both.', ephemeral: true });

        if (user) {
          if (user.bot) return interaction.reply({ content: 'You cannot give coins to a bot.', ephemeral: true });
          const result = db.giveDeveloperCoins(guildForGive.id, user.id, amount, interaction.user.id);
          if (!result.ok) {
            const message = result.reason === 'limit' ? 'The recipient balance has reached its safe limit.' : 'Enter a valid positive amount.';
            return interaction.reply({ content: message, ephemeral: true });
          }
          writeLog(guildForGive, 'devgive', user.id, `${amount} coins · ${reason}`, interaction.user.id);
          const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
          return sendPlainReply({
            content: `🏦 Developer transfer complete: **🪙 ${amount.toLocaleString()} coins** credited to <@${user.id}>. Their public balance is now **🪙 ${result.balance.toLocaleString()}**.`,
            ephemeral: true
          });
        }

        // A role: count the members first, then ask for a confirm press before sending anything.
        await interaction.reply({
          components: [textCard('🏦 Counting members', 'Looking up everyone with that role…', null)],
          flags: djs.MessageFlags.IsComponentsV2 | djs.MessageFlags.Ephemeral
        });
        const members = (await guildForGive.members.fetch()).filter(member => member.roles.cache.has(role.id) && !member.user.bot);
        if (!members.size) {
          return interaction.editReply({ components: [textCard('🏦 Nobody to pay', `No members have the **${role.name}** role.`, guildForGive.name)] });
        }
        const token = require('crypto').randomUUID();
        devGivePending.set(token, {
          guildId: guildForGive.id, roleId: role.id, roleName: role.name, amount, reason,
          memberIds: [...members.keys()], developerId: interaction.user.id, expires: Date.now() + 120000
        });
        const confirmRow = new djs.ActionRowBuilder().addComponents(
          new djs.ButtonBuilder().setCustomId(`zeron_devgive:confirm:${token}`).setLabel('Confirm and send').setStyle(djs.ButtonStyle.Success),
          new djs.ButtonBuilder().setCustomId(`zeron_devgive:cancel:${token}`).setLabel('Cancel').setStyle(djs.ButtonStyle.Secondary)
        );
        const preview = textCard('🏦 Developer role transfer',
          `Role **${role.name}**: **${members.size}** members\n**${amount.toLocaleString()} coins** each, total **${(amount * members.size).toLocaleString()} coins**\nReason: ${reason}`,
          'This sends coins to every member with the role. Confirm to continue.', 0x46BBFF);
        preview.addActionRowComponents(confirmRow);
        return interaction.editReply({ components: [preview] });
      }

      if (commandName === 'ownergive') {
        const djs = require('discord.js');
        const owner = interaction.user;
        const guildForGift = interaction.guild;
        if (!guildForGift || owner.id !== guildForGift.ownerId) {
          return interaction.reply({ content: '🔒 Only this server’s owner can use `/ownergive`.', ephemeral: true });
        }
        const recipient = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const reason = (interaction.options.getString('reason') || 'Owner gift').trim();
        const now = Date.now();
        const ephemeralV2 = djs.MessageFlags.IsComponentsV2 | djs.MessageFlags.Ephemeral;
        const ts = t => Math.floor(t / 1000);

        // No member and no amount: show the wallet and its batch.
        if (!recipient && !amount) {
          const status = db.ownerWalletStatus(guildForGift.id, now);
          const next = status.readyAt
            ? `Wallet is resting. Next batch <t:${ts(status.readyAt)}:R>.`
            : `Members left in this batch: **${status.leftInBatch} of 30**`;
          const card = textCard('🎁 Owner gift wallet',
            `Balance: **${status.balance.toLocaleString()} coins**\nUp to **10,000 coins** per gift.\nThe wallet gifts up to **30 members per hour**. After 30 gifts it rests for **1 hour**, then the next batch starts.\nEach member can receive one gift every **24 hours**, including you. Members who already got a gift stay on their cooldown.\n${next}`,
            'Use /ownergive user:@member amount:1000 to send a gift.', 0x46BBFF);
          return interaction.reply({ components: [card], flags: ephemeralV2 });
        }
        const plainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        if (!recipient) return plainReply({ content: '🎁 Pick a member\nChoose who receives the gift.', ephemeral: true });
        if (!amount) return plainReply({ content: '🎁 Enter an amount\nChoose how many coins to gift, from 1 to 10,000.', ephemeral: true });
        if (recipient.bot) return plainReply({ content: '🎁 Not allowed\nYou cannot gift coins to a bot.', ephemeral: true });

        const result = db.giftFromOwnerWallet(guildForGift.id, recipient.id, amount, now);
        if (!result.ok) {
          const messages = {
            amount: ['🎁 Invalid amount', 'Choose from 1 to 10,000 coins per gift.'],
            wallet: ['🎁 Wallet resting', `The batch of 30 is done. The next batch starts <t:${ts(result.readyAt)}:R>.`],
            balance: ['🎁 Not enough in the wallet', `The gift wallet has only **${(result.balance || 0).toLocaleString()} coins** left.`],
            recipient: ['🎁 Already gifted', `<@${recipient.id}> already received a gift. They can receive another <t:${ts(result.readyAt)}:R>.`]
          };
          const [heading, body] = messages[result.reason] || ['🎁 Gift failed', 'Something went wrong.'];
          const plainBody = body.replace(/\*\*/g, '');
          return plainReply({ content: `${heading}\n${plainBody}`, ephemeral: true });
        }

        writeLog(guildForGift, 'ownergive', recipient.id, `${amount} coins · ${reason}`, owner.id);
        recipient.send({
          components: [textCard('🎁 You received a gift', `The owner of **${guildForGift.name}** sent you **${amount.toLocaleString()} coins**.\nReason: ${reason}`, guildForGift.name, 0x22c55e)],
          flags: djs.MessageFlags.IsComponentsV2
        }).catch(() => {});
        const batchLine = result.readyAt
          ? `This batch is complete. The wallet rests until <t:${ts(result.readyAt)}:R>.`
          : `Members left in this batch: **${result.leftInBatch} of 30**`;
        const done = textCard('🎁 Gift sent',
          `<@${recipient.id}> received **${amount.toLocaleString()} coins**.\nWallet left: **${result.balance.toLocaleString()} coins**\n${batchLine}\nReason: ${reason}`,
          'This member can receive another gift in 24 hours.', 0x22c55e);
        return interaction.reply({ components: [done], flags: ephemeralV2 });
      }

      if (commandName === 'pay') {
        const replyPlain = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        const recipient = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount', true);

        if (recipient.bot) {
          return replyPlain({ content: 'You cannot pay a bot.', ephemeral: true });
        }

        const result = db.transferCoins(guild.id, interaction.user.id, recipient.id, amount);
        if (!result.ok) {
          const messages = {
            self: 'You cannot pay yourself.',
            amount: 'Enter a valid positive amount.',
            funds: `Not enough coins. Your balance is 🪙 ${result.balance.toLocaleString()}.`,
            limit: 'The recipient balance has reached its limit.'
          };
          return replyPlain({ content: messages[result.reason] || 'Payment failed.', ephemeral: true });
        }

        return replyPlain(`💸 <@${interaction.user.id}> paid **🪙 ${amount.toLocaleString()}** to <@${recipient.id}>.`);
      }

      if (commandName === 'bank') {
        const action = interaction.options.getString('action', true);
        const amount = interaction.options.getInteger('amount');
        if (action === 'view') {
          const bank = db.getBank(guild.id, interaction.user.id), wallet = db.getBalance(guild.id, interaction.user.id);
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(db.accentColor(guild.id)).setTitle('🏦 ZERON Personal Bank').setDescription(`Wallet: **🪙 ${wallet.coins.toLocaleString()}**\nBank savings: **🪙 ${bank.balance.toLocaleString()}**\nBase interest: **2% every 24 hours** · Collectible bonus: **+${db.getCollectibleBonuses(guild.id, interaction.user.id).bankInterestPercent}%**\nNext interest: ${bank.last_interest_at ? `<t:${Math.floor((bank.last_interest_at+86400000)/1000)}:R>` : 'Available now after depositing coins'}`)], ephemeral:true });
        }
        if (action === 'interest') {
          const result = db.claimBankInterest(guild.id, interaction.user.id);
          if (!result.ok) return interaction.reply({content: result.reason==='empty' ? '🏦 Deposit coins first to earn interest.' : `⏳ Interest is not ready yet. Available <t:${Math.floor(result.next/1000)}:R>.`,ephemeral:true});
          const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
          return sendPlainReply({content:`💹 Bank interest claimed: **🪙 ${result.interest.toLocaleString()}** (${result.rate}% total rate). New bank balance: **🪙 ${result.bank.toLocaleString()}**.`,ephemeral:true});
        }
        const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
        if (!amount) return sendPlainReply({content:'Enter an amount for deposit or withdrawal.',ephemeral:true});
        const result=db.bankMove(guild.id,interaction.user.id,action,amount);
        if(!result.ok) return sendPlainReply({content:result.reason==='funds' ? `Not enough wallet coins. Wallet: 🪙 ${result.wallet.toLocaleString()}.` : result.reason==='bank_funds' ? `Not enough bank savings. Bank: 🪙 ${result.bank.toLocaleString()}.` : 'Enter a valid amount.',ephemeral:true});
        return sendPlainReply({content:`${action==='deposit'?'📥 Deposited':'📤 Withdrew'} **🪙 ${amount.toLocaleString()}**. Wallet: **🪙 ${result.wallet.toLocaleString()}** · Bank: **🪙 ${result.bank.toLocaleString()}**.`,ephemeral:true});
      }

      if (commandName === 'collectibles') {
        const action=interaction.options.getString('action') || 'browse';
        const items=[{id:'common_crystal',name:'Common Crystal',emoji:'🔹',rarity:'Common',price:500},{id:'rare_phoenix',name:'Rare Phoenix',emoji:'🔥',rarity:'Rare',price:2500},{id:'epic_dragon',name:'Epic Dragon',emoji:'🐉',rarity:'Epic',price:10000},{id:'legendary_crown',name:'Legendary Crown',emoji:'👑',rarity:'Legendary',price:50000}];
        if(action==='buy') {
          const sendPlainReply = interaction.__v2OriginalMethods?.reply || interaction.reply.bind(interaction);
          const id=interaction.options.getString('item'); if(!id) return sendPlainReply({content:'Choose an item to buy.',ephemeral:true});
          const item=items.find(x=>x.id===id); const result=db.buyCollectible(guild.id,interaction.user.id,item.id,item.price);
          if(!result.ok) return sendPlainReply({content:`Not enough coins. Your wallet has 🪙 ${result.balance.toLocaleString()}.`,ephemeral:true});
          syncAchievements(db, guild.id, interaction.user.id);
          return sendPlainReply({content:`✨ Purchased ${item.emoji} **${item.name}** (${item.rarity}) for 🪙 ${item.price.toLocaleString()}!`,ephemeral:true});
        }
        if(action==='mine') {
          const rows=db.getCollectibles(guild.id,interaction.user.id); const desc=rows.length?rows.map(row=>{const i=items.find(x=>x.id===row.collectible_id);return `${i?.emoji||'💎'} **${i?.name||row.collectible_id}** · ${i?.rarity||'Collectible'} × ${row.quantity}`;}).join('\n'):'Your collection is empty. Use `/collectibles action:buy` to collect your first item.';
          return interaction.reply({embeds:[new EmbedBuilder().setColor(db.accentColor(guild.id)).setTitle('💎 Your Collectibles').setDescription(desc)],ephemeral:true});
        }
        return interaction.reply({embeds:[new EmbedBuilder().setColor(db.accentColor(guild.id)).setTitle('💎 ZERON Rare Collectibles').setDescription(items.map(i=>`${i.emoji} **${i.name}** — ${i.rarity}\nPrice: 🪙 ${i.price.toLocaleString()} · ID: \`${i.id}\`\nPerk: ${{common_crystal:'+2% daily/work/weekly rewards and +1% bank interest',rare_phoenix:'+3% daily/work/weekly rewards and +2% bank interest',epic_dragon:'+4% daily/work/weekly rewards and +5% bank interest',legendary_crown:'+5% daily/work/weekly rewards and +10% bank interest'}[i.id]}`).join('\n\n')+'\n\nBonuses stack by quantity (maximum +20% per bonus type). Reward bonus applies to daily, work and weekly claims. Buy with `/collectibles action:buy item:<item>`.')],ephemeral:true});
      }

      if (commandName === 'inventory') {
        const rows = db.getInventory(guild.id, interaction.user.id);
        const body = rows.length
          ? rows.map(row => {
              const item = SHOP_ITEMS.find(x => x.id === row.item_id);
              return `${item?.emoji || '📦'} **${item?.name || row.item_id}** × ${row.quantity}`;
            }).join('\n')
          : '';
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(db.accentColor(guild.id)).setTitle('🎒 Your Inventory').setDescription([body, '**🎣 Fishing catches**\n' + fishingCatchesText(db.getFishingInventory(guild.id, interaction.user.id))].filter(Boolean).join('\n\n').slice(0, 4000))],
          ephemeral: true
        });
      }

      if (commandName === 'profile') {
        const user = interaction.options.getUser('user') || interaction.user;
        const balance = db.getBalance(guild.id, user.id);
        const fishing = db.getFishingProfile(guild.id, user.id);
        const fishInBag = db.getFishingInventory(guild.id, user.id).length;
        const achievementState = syncAchievements(db, guild.id, user.id);
        const unlockedBadges = achievementState.unlocked.length
          ? achievementState.unlocked.map(item => item.emoji + ' **' + item.name + '**').join(' · ')
          : 'No badges unlocked yet.';
        const nextBadges = achievementState.locked.slice(0, 3).map(item =>
          item.emoji + ' **' + item.name + '** — ' + item.progress.toLocaleString() + '/' + item.target.toLocaleString()
        );
        const size = 10;
        const filled = Math.round((fishing.xpIntoLevel / fishing.xpForNext) * size);
        const bar = '█'.repeat(filled) + '░'.repeat(size - filled);

        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(db.accentColor(guild.id))
            .setTitle('🌌 ' + (user.globalName || user.username) + "'s ZERON Profile")
            .setThumbnail(user.displayAvatarURL())
            .setDescription(
              '**Coins:** 🪙 ' + balance.coins.toLocaleString() + '\n\n' +
              '**🎣 Fishing level ' + fishing.level + '**\n' +
              bar + '\n' +
              fishing.xpIntoLevel.toLocaleString() + ' / ' + fishing.xpForNext.toLocaleString() + ' XP to level ' + (fishing.level + 1) + '\n\n' +
              'Fish caught: **' + fishing.totalCaught.toLocaleString() + '**\n' +
              'Fish in inventory: **' + fishInBag.toLocaleString() + '**\n' +
              'Sharks: **' + fishing.sharks.toLocaleString() + '**\n' +
              'Legendary fish: **' + fishing.legendary.toLocaleString() + '**\n' +
              'Quests completed: **' + fishing.questsDone.toLocaleString() + '**\n\n' +
              '**🏅 Achievements (' + achievementState.unlocked.length + '/' + achievementState.total + ')**\n' +
              unlockedBadges + (nextBadges.length ? '\n\n**Next badges**\n' + nextBadges.join('\n') : '')
            )],
          ephemeral: true
        });
      }

      if (commandName === 'transactions') {
        const limit = interaction.options.getInteger('limit') || 5;
        const rows = db.getTransactions(guild.id, interaction.user.id, limit);

        const description = rows.length
          ? rows.map(row => {
              const sign = row.amount > 0 ? '+' : '';
              const timestamp = Math.floor(new Date(row.created_at + ' UTC').getTime() / 1000);
              const date = Number.isFinite(timestamp)
                ? `<t:${timestamp}:R>`
                : row.created_at;
              return `🪙 **${sign}${row.amount}** — ${row.reason} · ${date}`;
            }).join('\n')
          : 'No transactions yet. Open /profile to see your coins.';

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(db.accentColor(guild.id))
              .setTitle('📜 Your Coin Transactions')
              .setDescription(description)
          ],
          ephemeral: true
        });
      }

      if (commandName === 'leaderboard') {
        const boardType = interaction.options.getString('type') || 'xp';
        return interaction.reply(buildLeaderboard(guild, boardType, 0, interaction.user.id));
      }
    } catch (error) {
      console.error(`Command /${interaction.commandName} failed:`, error);
      const content = error.message === 'Rank card queue is full'
        ? '⏳ Rank cards are busy right now. Please try again shortly.'
        : `Command failed: ${error.message?.includes('Missing Permissions') ? 'Discord denied the action. Check bot permissions and role hierarchy.' : 'an unexpected error occurred. Check server logs.'}`;
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content, ephemeral: true }).catch(() => {});
      else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
  });
  return client;
}
module.exports = { createClient };
