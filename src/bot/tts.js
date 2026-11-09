const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus
} = require('@discordjs/voice');
const googleTTS = require('google-tts-api');
const { PermissionFlagsBits } = require('discord.js');

// Uses the ffmpeg installed on the host system (check with: ffmpeg -version).

const MAX_CHARS = 200;
const COOLDOWN_MS = 3000;
const LEAVE_DELAY_MS = 5000;

function cleanForSpeech(text) {
  return String(text)
    .replace(/https?:\/\/\S+/gi, ' link ')
    .replace(/<a?:(\w+):\d+>/g, ' $1 ')
    .replace(/<@!?\d+>/g, 'someone')
    .replace(/<@&\d+>/g, 'a role')
    .replace(/<#\d+>/g, 'a channel')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
}

function createTtsService(client) {
  // guildId -> { voiceChannelId, connection, player, queue, speaking, leaveTimer }
  const sessions = new Map();
  const cooldowns = new Map();

  async function speakNext(session) {
    if (session.speaking) return;
    const text = session.queue.shift();
    if (!text) return;
    session.speaking = true;
    try {
      const url = googleTTS.getAudioUrl(text, { lang: 'en', slow: false, host: 'https://translate.google.com' });
      session.player.play(createAudioResource(url, { inlineVolume: true }));
      await entersState(session.player, AudioPlayerStatus.Playing, 5000).catch(() => {});
      await entersState(session.player, AudioPlayerStatus.Idle, 60000).catch(() => {});
    } catch (error) {
      console.error('TTS playback failed:', error.message);
    } finally {
      session.speaking = false;
      if (session.queue.length) speakNext(session);
    }
  }

  function endSession(guildId) {
    const session = sessions.get(guildId);
    if (!session) return;
    if (session.leaveTimer) clearTimeout(session.leaveTimer);
    sessions.delete(guildId);
    session.connection.destroy();
  }

  async function start(interaction) {
    const guild = interaction.guild;
    const voiceChannel = interaction.member && interaction.member.voice ? interaction.member.voice.channel : null;
    if (!guild) return interaction.reply({ content: 'Use this inside a server.', ephemeral: true });
    if (!voiceChannel) {
      return interaction.reply({ content: 'Join a voice channel first, then run `/tts` from that voice channel.', ephemeral: true });
    }

    const me = guild.members.me;
    if (!me || !me.permissions.has(PermissionFlagsBits.Connect) || !me.permissions.has(PermissionFlagsBits.Speak)) {
      return interaction.reply({ content: 'NEXORA needs Connect and Speak permission to use TTS.', ephemeral: true });
    }

    const existing = sessions.get(guild.id);
    if (existing) {
      return interaction.reply({ content: 'TTS is already on in <#' + existing.voiceChannelId + '>.', ephemeral: true });
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    } catch (error) {
      connection.destroy();
      return interaction.reply({ content: 'I could not join the voice channel. Please try again.', ephemeral: true });
    }

    const player = createAudioPlayer();
    connection.subscribe(player);
    const session = { voiceChannelId: voiceChannel.id, connection, player, queue: [], speaking: false, leaveTimer: null };
    sessions.set(guild.id, session);
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (sessions.get(guild.id) === session) sessions.delete(guild.id);
    });

    return interaction.reply({
      content: '🔊 TTS is on. Type in the chat of <#' + voiceChannel.id + '> and I will say it out loud. I leave 5 seconds after the voice channel is empty.'
    });
  }

  async function handleMessage(message) {
    if (!message.guild || message.author.bot) return;
    const session = sessions.get(message.guild.id);
    if (!session || message.channel.id !== session.voiceChannelId) return;

    const raw = message.content || '';
    if (!raw || raw.startsWith('/') || raw.startsWith('!')) return;

    const last = cooldowns.get(message.author.id) || 0;
    if (Date.now() - last < COOLDOWN_MS) return;
    cooldowns.set(message.author.id, Date.now());

    const text = cleanForSpeech(raw);
    if (!text) return;
    session.queue.push(text);
    speakNext(session);
  }

  async function handleVoiceUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const session = sessions.get(guild.id);
    if (!session) return;

    const humansIn = (channel) => (channel ? channel.members.filter(member => !member.user.bot).size : 0);
    const channel = client.channels.cache.get(session.voiceChannelId);
    if (humansIn(channel) > 0) {
      if (session.leaveTimer) {
        clearTimeout(session.leaveTimer);
        session.leaveTimer = null;
      }
      return;
    }
    if (session.leaveTimer) return;

    session.leaveTimer = setTimeout(() => {
      const current = sessions.get(guild.id);
      if (current !== session) return;
      const still = client.channels.cache.get(session.voiceChannelId);
      if (humansIn(still) === 0) {
        endSession(guild.id);
      } else {
        session.leaveTimer = null;
      }
    }, LEAVE_DELAY_MS);
  }

  return { start, handleMessage, handleVoiceUpdate };
}

module.exports = { createTtsService, cleanForSpeech };
