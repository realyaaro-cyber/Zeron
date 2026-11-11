const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('welcome').setDescription('Configure welcome messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable welcome messages').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Welcome destination channel').setRequired(false))
    .addStringOption(o => o.setName('message').setDescription('Use {user}, {username}, and {server}').setMaxLength(1800).setRequired(false)),

  new SlashCommandBuilder().setName('starboard')
    .setDescription('Set up Starboard to repost messages with enough ⭐ reactions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('setup').setDescription('Set the source, destination, star threshold, and status.')
      .addBooleanOption(o => o.setName('enabled').setDescription('True = enable Starboard, False = disable it').setRequired(true))
      .addChannelOption(o => o.setName('source_channel').setDescription('Source channel (required when setting up for the first time)').setRequired(false))
      .addChannelOption(o => o.setName('destination_channel').setDescription('Destination channel (required when setting up for the first time)').setRequired(false))
      .addIntegerOption(o => o.setName('threshold').setDescription('Unique member ⭐ reactions needed (required for first-time setup)').setMinValue(1).setMaxValue(100000).setRequired(false))),

  new SlashCommandBuilder().setName('track-invite')
    .setDescription('Configure invite join tracking.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Invite log channel').setRequired(true))
    .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable tracking').setRequired(true)),

  new SlashCommandBuilder().setName('enable-level-up')
    .setDescription('Configure XP earning and level-up announcements.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable XP and leveling').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Level-up announcement channel').setRequired(false))
    .addStringOption(o => o.setName('message').setDescription('Custom message: {user}, {username}, {server}, {level}, {reward}').setMaxLength(1800).setRequired(false)),

  new SlashCommandBuilder().setName('role-reward')
    .setDescription('Set or remove the role given at a level.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('level').setDescription('Level that gives the role (1-1000)').setMinValue(1).setMaxValue(1000).setRequired(true))
    .addBooleanOption(o => o.setName('enabled').setDescription('true = set the reward, false = remove it').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to give (required when enabled is true)').setRequired(false)),

  new SlashCommandBuilder().setName('poll')
    .setDescription('Create and manage server polls.')
    .addStringOption(o => o.setName('action').setDescription('Choose what to do with polls').setRequired(true)
      .addChoices(
        { name: 'Create', value: 'create' },
        { name: 'List active polls', value: 'list' },
        { name: 'End a poll', value: 'end' },
        { name: 'View poll results', value: 'results' }
      ))
    .addStringOption(o => o.setName('question').setDescription('Poll question (for Create)').setMaxLength(180).setRequired(false))
    .addStringOption(o => o.setName('options').setDescription('2–10 options separated by | (for Create)').setMaxLength(1000).setRequired(false))
    .addIntegerOption(o => o.setName('duration').setDescription('Voting duration in minutes (default 1440)').setMinValue(1).setMaxValue(10080).setRequired(false))
    .addBooleanOption(o => o.setName('anonymous').setDescription('Hide voter identities (for Create)').setRequired(false))
    .addBooleanOption(o => o.setName('multiple').setDescription('Allow multiple selections (for Create)').setRequired(false))
    .addBooleanOption(o => o.setName('allow_change').setDescription('Allow members to change their vote (for Create)').setRequired(false))
    .addRoleOption(o => o.setName('required_role').setDescription('Role required to vote (for Create)').setRequired(false))
    .addIntegerOption(o => o.setName('poll_id').setDescription('Poll ID (for End or Results)').setMinValue(1).setRequired(false)),

  new SlashCommandBuilder().setName('trivia')
    .setDescription('Start a trivia question, or cancel the running one (Manage Server).').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('question').setDescription('The question to ask').setRequired(false))
    .addStringOption(o => o.setName('answer').setDescription('Correct answer (use | for alternatives)').setRequired(false))
    .addIntegerOption(o => o.setName('reward').setDescription('Coins for the winner (1-5000, default 100)').setMinValue(1).setMaxValue(5000).setRequired(false))
    .addBooleanOption(o => o.setName('cancel').setDescription('Cancel the running trivia').setRequired(false)),

  new SlashCommandBuilder().setName('birthday')
    .setDescription('Set, view or remove a birthday.')
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(false)
      .addChoices({ name: 'Set my birthday', value: 'set' }, { name: 'View a birthday', value: 'view' }, { name: 'Remove my birthday', value: 'remove' }))
    .addUserOption(o => o.setName('user').setDescription('Member to view (optional)').setRequired(false)),

  new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server.'),
  new SlashCommandBuilder().setName('userinfo').setDescription('Show Discord and Roblox information. Both options are optional.')
    .addUserOption(o => o.setName('discord-user').setDescription('Show only the Discord card for this member').setRequired(false))
    .addUserOption(o => o.setName('roblox-user').setDescription('Show only the Roblox card for this member').setRequired(false)),

  new SlashCommandBuilder().setName('kick').setDescription('Kick a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(400).setRequired(false)),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(400).setRequired(false)),
  new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('user_id').setDescription('Discord user ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(400).setRequired(false)),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to timeout').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes (1-40320)').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(400).setRequired(false)),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove a member timeout.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('purge').setDescription('Delete any number of messages in this channel, in batches.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('amount').setDescription('How many messages to delete. Use 0 to delete all, including old ones.').setMinValue(0).setRequired(true)),
  new SlashCommandBuilder().setName('jail')
    .setDescription('Jail a member (server owner only).')
    .setDefaultMemberPermissions(0)
    .addUserOption(o => o.setName('user').setDescription('Member to jail').setRequired(true)),

  new SlashCommandBuilder().setName('unjail')
    .setDescription('Release a jailed member (server owner only).')
    .setDefaultMemberPermissions(0)
    .addUserOption(o => o.setName('user').setDescription('Member to release').setRequired(true)),

  new SlashCommandBuilder().setName('manage-cmnds')
    .setDescription('Turn a command on or off in this server (server owner only).')
    .setDefaultMemberPermissions(0)
    .addStringOption(o => o.setName('action').setDescription('True to enable, False to disable, or Show the lists').setRequired(true)
      .addChoices({ name: 'True', value: 'true' }, { name: 'False', value: 'false' }, { name: 'Show', value: 'show' }))
    .addStringOption(o => o.setName('command').setDescription('Command name (needed for True or False)').setRequired(false).setAutocomplete(true))
    .addUserOption(o => o.setName('user').setDescription('Restrict only this member (optional)').setRequired(false)),

  new SlashCommandBuilder().setName('vaultalert')
    .setDescription('Ping a role when a vault alert shows up in a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('action').setDescription('Add, remove, or list vault alerts').setRequired(true)
      .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' }))
    .addStringOption(o => o.setName('vault').setDescription('Vault name, e.g. Sapphire, Ruby, Diamond, Amethyst (Add and Remove)').setRequired(false).setMaxLength(30))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to watch (Add)').setRequired(false))
    .addRoleOption(o => o.setName('role').setDescription('Role to ping (Add)').setRequired(false)),

  new SlashCommandBuilder().setName('roblox')
    .setDescription('Link or unlink your Roblox account in this server.')
    .addStringOption(o => o.setName('action').setDescription('Link or unlink your Roblox account').setRequired(true)
      .addChoices({ name: 'Link', value: 'link' }, { name: 'Unlink', value: 'unlink' }))
    .addStringOption(o => o.setName('username').setDescription('Your Roblox username (for Link)').setRequired(false).setMaxLength(32)),

  new SlashCommandBuilder().setName('vaultpost')
    .setDescription('Manually post a vault alert when its Vault Intel message is delayed.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('vault').setDescription('Vault to post').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder().setName('aichat')
    .setDescription('Turn the ZERON AI assistant on or off in a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('action').setDescription('On or off').setRequired(true)
      .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }))
    .addChannelOption(o => o.setName('channel').setDescription('Channel for the AI (default: this channel)').setRequired(false)),

  new SlashCommandBuilder().setName('afk')
    .setDescription('Turn AFK on or off.')
    .addStringOption(o => o.setName('action').setDescription('Turn AFK on or off').setRequired(true)
      .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }))
    .addStringOption(o => o.setName('reason').setDescription('Why you are away (optional, used with On)').setMaxLength(100).setRequired(false)),

  new SlashCommandBuilder().setName('ping').setDescription('Check how fast ZERON is responding right now.'),

  new SlashCommandBuilder().setName('rank').setDescription('Show your rank card. Change its background on the dashboard.')
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(false)),
  new SlashCommandBuilder().setName('leaderboard')
    .setDescription('Show the server leaderboard.')
    .addStringOption(o => o.setName('type').setDescription('What to rank by').setRequired(false)
      .addChoices({ name: 'XP', value: 'xp' }, { name: 'Coins', value: 'coins' }, { name: 'This week', value: 'weekly' })),

  new SlashCommandBuilder().setName('pay')
    .setDescription('Send coins to another member.')
    .addUserOption(o => o.setName('user').setDescription('Member to pay').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Coins to send').setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName('inventory')
    .setDescription('View your shop inventory.'),
  new SlashCommandBuilder().setName('bank').setDescription('Manage your personal bank and claim daily interest.')
    .addStringOption(o => o.setName('action').setDescription('Bank action').setRequired(true).addChoices({name:'View balance',value:'view'},{name:'Deposit',value:'deposit'},{name:'Withdraw',value:'withdraw'},{name:'Claim interest',value:'interest'}))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount for deposit/withdraw').setMinValue(1).setRequired(false)),
  new SlashCommandBuilder().setName('collectibles').setDescription('Browse or buy rare collectibles.')
    .addStringOption(o => o.setName('action').setDescription('Browse or buy').setRequired(false).addChoices({name:'Browse collection',value:'browse'},{name:'My collection',value:'mine'},{name:'Buy',value:'buy'}))
    .addStringOption(o => o.setName('item').setDescription('Collectible ID to buy').setRequired(false).addChoices({name:'Common Crystal — 500 coins',value:'common_crystal'},{name:'Rare Phoenix — 2500 coins',value:'rare_phoenix'},{name:'Epic Dragon — 10000 coins',value:'epic_dragon'},{name:'Legendary Crown — 50000 coins',value:'legendary_crown'})),
  new SlashCommandBuilder().setName('profile')
    .setDescription('View your coins and fishing profile.')
    .addUserOption(o => o.setName('user').setDescription('Member to view').setRequired(false)),
  new SlashCommandBuilder().setName('guild')
    .setDescription('Open the ZERON Guild menu: create, join, or war with guilds.'),

  new SlashCommandBuilder().setName('fish')
    .setDescription('Catch fish, finish daily quests, and sell your fishing inventory.'),
  new SlashCommandBuilder().setName('play')
    .setDescription('Start a ZERON slots game.'),
  new SlashCommandBuilder().setName('transactions')
    .setDescription('View your recent ZERON coin transactions.')
    .addIntegerOption(o => o.setName('limit')
      .setDescription('Number of transactions (1-10)')
      .setMinValue(1).setMaxValue(10).setRequired(false)),

  new SlashCommandBuilder().setName('devgive')
    .setDescription('Developer only: send private bank coins to a member, or to everyone with a role.')
    .addIntegerOption(o => o.setName('amount').setDescription('Coins per member').setMinValue(1).setRequired(true))
    .addUserOption(o => o.setName('user').setDescription('One member (choose this or a role)').setRequired(false))
    .addRoleOption(o => o.setName('role').setDescription('Everyone with this role (choose this or a member)').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the log').setMaxLength(100).setRequired(false)),

  new SlashCommandBuilder().setName('ownergive')
    .setDescription('Owner only: gift coins from the server gift wallet. Leave empty to see the wallet.')
    .addUserOption(o => o.setName('user').setDescription('Member to gift (you may choose yourself)').setRequired(false))
    .addIntegerOption(o => o.setName('amount').setDescription('Coins to gift, up to 10,000').setMinValue(1).setMaxValue(10000).setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the log').setMaxLength(100).setRequired(false)),

  new SlashCommandBuilder().setName('help')
    .setDescription('Show all ZERON commands and how to use them.'),
];
// Commands that exist only in one server, not globally.
// No command is limited to one server now. /vaultalert is global.
const GUILD_ONLY_COMMANDS = {};
module.exports = { commands, GUILD_ONLY_COMMANDS };
