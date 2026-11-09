const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { toV2Payload } = require('./components-v2');

function colorNumber(hex) {
  return parseInt(String(hex || '').replace('#', ''), 16) || 0x46BBFF;
}

function buildEmbed(g, entryCount, winners) {
  const ended = g.status === 'ended';
  const endsUnix = Math.floor(Number(g.ends_at) / 1000);
  const requirements = [];
  if (g.min_level) requirements.push('Level ' + g.min_level + '+');
  if (g.required_role_id) requirements.push('<@&' + g.required_role_id + '>');
  const fields = [
    { name: ended ? 'Ended' : 'Ends', value: ended ? '<t:' + endsUnix + ':f>' : '<t:' + endsUnix + ':R>', inline: true },
    { name: 'Winners', value: String(g.winners_count), inline: true },
    { name: 'Entries', value: String(entryCount), inline: true },
    { name: 'Requirements', value: requirements.length ? requirements.join(' · ') : 'None', inline: false }
  ];
  if (ended) {
    fields.push({
      name: 'Winners drawn',
      value: winners && winners.length ? winners.map(id => '<@' + id + '>').join(' ') : 'No valid entries',
      inline: false
    });
  }
  return new EmbedBuilder()
    .setColor(colorNumber(g.color))
    .setTitle((ended ? '🏁 ' : '🎉 ') + g.title)
    .setDescription(g.description || 'Press the button below to enter!')
    .addFields(fields)
    .setFooter({ text: ended ? 'Giveaway ended' : 'Good luck!' })
    .setTimestamp();
}

function buildRow(g, ended) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('nx-gw-enter:' + g.id)
      .setLabel(ended ? 'Giveaway ended' : '🎉 Enter')
      .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(ended)
  );
}

function withAccent(g, db) {
  return { ...g, color: db.accentHex(g.guild_id) };
}

function pickWinners(entries, count, exclude) {
  const pool = entries.filter(id => !exclude.includes(id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function createGiveawayService(client, db) {
  // Dashboard actions and the expiry poll can try to end the same giveaway together.
  // Share one in-flight end operation per giveaway so winners are drawn and announced once.
  const ending = new Map();

  async function post(channelId, g) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new Error('Choose a text channel the bot can see.');
    const message = await channel.send(toV2Payload({
      embeds: [buildEmbed(withAccent(g, db), 0, [])],
      components: [buildRow(g, false)],
      allowedMentions: { parse: [] }
    }));
    db.setGiveawayMessage(g.id, message.id);
    return message;
  }

  async function end(g, reroll) {
    const id = Number(g.id);
    if (ending.has(id)) return ending.get(id);

    const operation = Promise.resolve().then(async () => {
      const current = db.getGiveaway(id);
      if (!current) throw new Error('Giveaway not found.');
      const entries = db.getGiveawayEntries(id);
      const previous = reroll ? JSON.parse(current.winner_ids || '[]') : [];
      const winners = pickWinners(entries, current.winners_count, previous);
      db.endGiveaway(id, winners);
      const ended = db.getGiveaway(id);

      const channel = await client.channels.fetch(ended.channel_id).catch(() => null);
      if (channel && channel.isTextBased()) {
        const message = await channel.messages.fetch(ended.message_id).catch(() => null);
        if (message) {
          await message.edit(toV2Payload({
            embeds: [buildEmbed(withAccent(ended, db), entries.length, winners)],
            components: [buildRow(ended, true)]
          })).catch(() => {});
        }
        const mentions = winners.map(id => '<@' + id + '>').join(' ');
        const text = winners.length
          ? (reroll ? '🔁 New winner ' + mentions + ' for **' + ended.title + '**!' : '🎉 Congratulations ' + mentions + '! You won **' + ended.title + '**.')
          : 'No valid entries for **' + ended.title + '**.';
        await channel.send(toV2Payload({ content: text, allowedMentions: { users: winners } })).catch(() => {});
      }
      return winners;
    });

    ending.set(id, operation);
    try {
      return await operation;
    } finally {
      ending.delete(id);
    }
  }

  async function checkDue() {
    for (const g of db.getDueGiveaways(Date.now())) {
      await end(g, false).catch(error => console.error('Giveaway end failed:', error.message));
    }
  }

  return { post, end, checkDue };
}

async function handleGiveawayEnter(interaction, db) {
  const id = Number(interaction.customId.split(':')[1]);
  const g = db.getGiveaway(id);
  if (!g || g.status !== 'active' || Date.now() >= Number(g.ends_at)) {
    return interaction.reply({ content: 'This giveaway has ended.', ephemeral: true });
  }

  if (db.hasGiveawayEntry(id, interaction.user.id)) {
    db.removeGiveawayEntry(id, interaction.user.id);
  } else {
    if (g.min_level && db.getUserLevel(g.guild_id, interaction.user.id) < g.min_level) {
      return interaction.reply({ content: 'You need to be level ' + g.min_level + ' or higher to enter.', ephemeral: true });
    }
    if (g.required_role_id && !(interaction.member && interaction.member.roles.cache.has(g.required_role_id))) {
      return interaction.reply({ content: 'You need the required role to enter this giveaway.', ephemeral: true });
    }
    db.addGiveawayEntry(id, interaction.user.id);
  }

  const count = db.countGiveawayEntries(id);
  return interaction.update({ embeds: [buildEmbed(withAccent(g, db), count, [])], components: [buildRow(g, false)] });
}

module.exports = { createGiveawayService, handleGiveawayEnter, buildEmbed, buildRow };
