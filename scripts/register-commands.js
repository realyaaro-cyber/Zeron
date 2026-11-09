require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { commands, GUILD_ONLY_COMMANDS } = require('../src/commands/definitions');

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
  console.error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required.');
  process.exit(1);
}

const guildOnly = new Set(Object.values(GUILD_ONLY_COMMANDS).flat());
const publicCommands = commands.filter(c => !guildOnly.has(c.name)).map(c => c.toJSON());

if (publicCommands.length > 100) {
  console.error(
    `Discord allows at most 100 global commands, found ${publicCommands.length}. Registration cancelled.`
  );
  process.exit(1);
}

const rest = new REST({ version: '10' })
  .setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body: publicCommands }
  );

  console.log(`Registered ${publicCommands.length} global commands.`);

  for (const [guildId, names] of Object.entries(GUILD_ONLY_COMMANDS)) {
    const guildBody = commands.filter(c => names.includes(c.name)).map(c => c.toJSON());
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body: guildBody });
  }

  // Servers that used to have a guild-only copy of /vaultalert: remove that copy so only the global command shows.
  const LEGACY_GUILD_IDS = ['1553884001545097377'];
  for (const guildId of LEGACY_GUILD_IDS) {
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body: [] });
  }

  const guildIds = (process.env.DEV_GUILD_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  for (const guildId of guildIds) {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        guildId
      ),
      { body: [] }
    );

  }

  console.log('Global registration completed.');
})().catch(err => {
  console.error('Registration failed:', err.message);
  process.exit(1);
});
