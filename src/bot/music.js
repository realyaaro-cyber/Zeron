'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const bundledFfmpegPath = require('ffmpeg-static');
const ffmpegPath = process.env.FFMPEG_PATH || (bundledFfmpegPath && fs.existsSync(bundledFfmpegPath) ? bundledFfmpegPath : 'ffmpeg');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel
} = require('@discordjs/voice');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_QUEUE_SIZE = 25;
const sessions = new Map();

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const p = address.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || p[0] >= 224;
  }
  const value = address.toLowerCase();
  return value === '::1' || value === '::' || value.startsWith('fc') ||
    value.startsWith('fd') || value.startsWith('fe80:') ||
    value.startsWith('::ffff:');
}

async function getAudioStream(urlText) {
  let url;
  try {
    url = new URL(urlText);
  } catch {
    throw new Error('Provide a valid direct audio URL.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only direct HTTP or HTTPS audio URLs are supported.');
  }
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('That audio URL host could not be verified as public.');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) {
    throw new Error('ZERON could not open that audio URL.');
  }
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('audio/') && !type.includes('ogg') && !type.includes('octet-stream')) {
    await response.body.cancel().catch(() => {});
    throw new Error('The URL must point directly to an audio file or audio stream.');
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_AUDIO_BYTES) {
    await response.body.cancel().catch(() => {});
    throw new Error('Audio sources with a declared size above 25 MB are not supported.');
  }
  return Readable.fromWeb(response.body);
}

function createMusicService(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_playlists (
      guild_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS music_playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_music_playlist_tracks
      ON music_playlist_tracks (guild_id, id);
  `);
  function getSession(guildId) {
    return sessions.get(guildId) || null;
  }

  function updateEmptyChannelTimer(session) {
    const channel = client.channels.cache.get(session.channelId);
    if (!channel || !channel.members) return;

    const hasHumanMembers = channel.members.some(member => !member.user.bot);
    if (hasHumanMembers) {
      if (session.emptyChannelTimer) clearTimeout(session.emptyChannelTimer);
      session.emptyChannelTimer = null;
      return;
    }

    if (session.emptyChannelTimer) return;
    session.emptyChannelTimer = setTimeout(() => {
      session.emptyChannelTimer = null;
      if (getSession(session.guildId) !== session) return;

      const latestChannel = client.channels.cache.get(session.channelId);
      const stillEmpty = latestChannel && latestChannel.members &&
        !latestChannel.members.some(member => !member.user.bot);
      if (stillEmpty) {
        console.log('Music: leaving empty voice channel in guild ' + session.guildId + ' after 2 minutes.');
        destroySession(session.guildId);
      } else {
        updateEmptyChannelTimer(session);
      }
    }, 2 * 60 * 1000);
    session.emptyChannelTimer.unref?.();
  }

  client.on('voiceStateUpdate', (oldState, newState) => {
    const session = getSession(newState.guild.id);
    if (!session) return;
    if (oldState.channelId === session.channelId || newState.channelId === session.channelId) {
      updateEmptyChannelTimer(session);
    }
  });

  async function startNext(session) {
    if (session.starting || session.current) return;
    session.starting = true;
    try {
      while (session.queue.length && !session.current) {
        const track = session.queue.shift();
        session.current = track;
        try {
          const stream = await getAudioStream(track.url);
          const ffmpeg = spawn(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error',
            '-i', 'pipe:0',
            '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2',
            'pipe:1'
          ], { stdio: ['pipe', 'pipe', 'pipe'] });
          let ffmpegError = '';
          ffmpeg.stderr.setEncoding('utf8');
          ffmpeg.stderr.on('data', chunk => { ffmpegError = (ffmpegError + chunk).slice(-2000); });
          const ffmpegStarted = new Promise((resolve, reject) => {
            ffmpeg.once('spawn', resolve);
            ffmpeg.once('error', error => reject(new Error('FFmpeg executable was not found. Install FFmpeg on the host or set FFMPEG_PATH. (' + error.message + ')')));
          });
          stream.on('error', error => ffmpeg.stdin.destroy(error));
          ffmpeg.stdin.on('error', () => {});
          stream.pipe(ffmpeg.stdin);
          await ffmpegStarted;
          const resource = createAudioResource(ffmpeg.stdout, {
            inputType: StreamType.Raw,
            metadata: track
          });
          ffmpeg.on('close', code => {
            if (code && session.current === track) {
              session.lastError = ffmpegError.trim() || 'Audio decoder exited with code ' + code + '.';
            }
          });
          session.ffmpeg = ffmpeg;
          session.player.play(resource);
          return true;
        } catch (error) {
          session.current = null;
          session.lastError = error.message;
        }
      }
      return false;
    } finally {
      session.starting = false;
    }
  }

  function destroySession(guildId) {
    const session = sessions.get(guildId);
    if (!session) return false;
    if (session.emptyChannelTimer) clearTimeout(session.emptyChannelTimer);
    session.emptyChannelTimer = null;
    session.queue.length = 0;
    session.player.stop(true);
    if (session.ffmpeg && !session.ffmpeg.killed) session.ffmpeg.kill('SIGKILL');
    session.connection.destroy();
    sessions.delete(guildId);
    return true;
  }

  async function handleConfig(interaction) {
    const reply = payload => interaction.reply({ ...payload, ephemeral: true });
    if (!interaction.guildId) return reply({ content: 'Playlist configuration only works inside a server.' });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return reply({ content: 'You need Manage Server permission to configure the music playlist.' });
    }
    const guildId = interaction.guildId;
    const action = interaction.options.getString('action', true);
    const exists = db.prepare('SELECT guild_id FROM music_playlists WHERE guild_id = ?').get(guildId);

    if (action === 'create') {
      if (exists) return reply({ content: 'This server already has a music playlist. Use **add** to add tracks.' });
      db.prepare('INSERT INTO music_playlists (guild_id, created_at) VALUES (?, ?)').run(guildId, Date.now());
      return reply({ content: '🎶 The server music playlist has been created.' });
    }
    if (action === 'delete') {
      if (!exists) return reply({ content: 'This server does not have a playlist yet. Use **create** first.' });
      db.prepare('DELETE FROM music_playlist_tracks WHERE guild_id = ?').run(guildId);
      db.prepare('DELETE FROM music_playlists WHERE guild_id = ?').run(guildId);
      return reply({ content: '🗑️ The server music playlist has been deleted.' });
    }
    if (!exists) return reply({ content: 'No playlist exists yet. Run **/music-config action:create** first.' });

    if (action === 'add') {
      const url = interaction.options.getString('url');
      const file = interaction.options.getAttachment('file');
      if (Boolean(url) === Boolean(file)) {
        return reply({ content: 'Provide exactly one source: a direct audio URL or an audio file attachment.' });
      }
      let title;
      let sourceUrl;
      if (file) {
        if (!file.contentType?.toLowerCase().startsWith('audio/') || file.size > MAX_AUDIO_BYTES) {
          return reply({ content: 'Attach an audio file no larger than 25 MB.' });
        }
        title = file.name;
        sourceUrl = file.url;
      } else {
        let parsed;
        try { parsed = new URL(url); } catch { return reply({ content: 'Provide a valid direct audio URL.' }); }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
          return reply({ content: 'Only direct HTTP or HTTPS audio URLs are supported.' });
        }
        title = parsed.hostname;
        sourceUrl = url;
      }
      const count = db.prepare('SELECT COUNT(*) AS count FROM music_playlist_tracks WHERE guild_id = ?').get(guildId).count;
      if (count >= MAX_QUEUE_SIZE) return reply({ content: 'The playlist is full (25 tracks maximum).' });
      db.prepare('INSERT INTO music_playlist_tracks (guild_id, title, url, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
        .run(guildId, title, sourceUrl, interaction.user.id, Date.now());
      return reply({ content: '➕ Added **' + title + '** to the server playlist.' });
    }
    if (action === 'list') {
      const tracks = db.prepare('SELECT id, title FROM music_playlist_tracks WHERE guild_id = ? ORDER BY id').all(guildId);
      if (!tracks.length) return reply({ content: 'The playlist is empty. Use **add** to add audio.' });
      return reply({ content: '🎶 **Server playlist (' + tracks.length + '/25)**\\n' +
        tracks.map((track, index) => (index + 1) + '. **' + track.title + '**').join('\\n') });
    }
    if (action === 'remove') {
      const index = interaction.options.getInteger('song', true);
      const tracks = db.prepare('SELECT id, title FROM music_playlist_tracks WHERE guild_id = ? ORDER BY id').all(guildId);
      const track = tracks[index - 1];
      if (!track) return reply({ content: 'That song number is not in the playlist. Use **list** to see song numbers.' });
      db.prepare('DELETE FROM music_playlist_tracks WHERE id = ? AND guild_id = ?').run(track.id, guildId);
      return reply({ content: '➖ Removed **' + track.title + '** from the playlist.' });
    }
  }

  client.on('interactionCreate', interaction => {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'music-config') {
      void handleConfig(interaction).catch(error => {
        console.error('Music playlist configuration failed:', error);
        const payload = { content: 'ZERON could not update the playlist. Please try again.', ephemeral: true };
        if (interaction.deferred || interaction.replied) void interaction.followUp(payload).catch(() => {});
        else void interaction.reply(payload).catch(() => {});
      });
    }
  });

  async function handle(interaction) {
    const action = interaction.options.getString('action', true);
    if (action === 'play') await interaction.deferReply();
    const reply = payload => interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload);
    const guild = interaction.guild;
    const guildId = interaction.guildId;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    const voiceChannel = member && member.voice ? member.voice.channel : null;
    let session = getSession(guildId);

    if (action === 'play') {
      const url = interaction.options.getString('url');
      const file = interaction.options.getAttachment('file');
      if (url && file) return reply({ content: 'Choose either a direct audio URL or an audio file, not both.', ephemeral: true });
      let tracksToAdd = [];
      if (url || file) {
        let urlHost = 'audio stream';
        if (url) {
          try {
            const parsedUrl = new URL(url);
            if (!['https:', 'http:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) throw new Error('invalid protocol');
            urlHost = parsedUrl.hostname;
          } catch {
            return reply({ content: 'Provide a valid direct HTTP or HTTPS audio URL.', ephemeral: true });
          }
        }
        if (file && (!file.contentType?.toLowerCase().startsWith('audio/') || file.size > MAX_AUDIO_BYTES)) {
          return reply({ content: 'Attach an audio file no larger than 25 MB.', ephemeral: true });
        }
        tracksToAdd = [{ title: file ? file.name : urlHost, url: file ? file.url : url, requestedBy: interaction.user.id }];
      } else {
        const playlist = db.prepare('SELECT guild_id FROM music_playlists WHERE guild_id = ?').get(guildId);
        if (!playlist) return reply({ content: 'No server playlist exists. Create one with **/music-config action:create**.' , ephemeral: true });
        tracksToAdd = db.prepare('SELECT title, url FROM music_playlist_tracks WHERE guild_id = ? ORDER BY id').all(guildId)
          .map(track => ({ ...track, requestedBy: interaction.user.id }));
        if (!tracksToAdd.length) return reply({ content: 'The server playlist is empty. Add tracks with **/music-config action:add**.', ephemeral: true });
      }
      if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        return reply({ content: 'Join a regular Voice Channel first. Stage Channels are not supported.', ephemeral: true });
      }
      if (session && session.channelId !== voiceChannel.id) {
        return reply({ content: 'ZERON is already playing in another voice channel in this server. Use /music action:leave there first.', ephemeral: true });
      }

      if (!session) {
        const botMember = guild.members.me;
        const permissions = voiceChannel.permissionsFor(botMember);
        const required = [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
        if (!permissions || !permissions.has(required)) {
          return reply({ content: 'ZERON needs Connect and Speak permissions in that voice channel.', ephemeral: true });
        }
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 20000);
        } catch {
          connection.destroy();
          return reply({ content: 'ZERON could not connect. Check its voice permissions and try again.', ephemeral: true });
        }

        const player = createAudioPlayer({
          behaviors: { noSubscriber: NoSubscriberBehavior.Stop }
        });
        session = {
          guildId,
          channelId: voiceChannel.id,
          channelType: voiceChannel.type,
          connection,
          player,
          queue: [],
          current: null,
          starting: false,
          lastError: null
        };
        connection.subscribe(player);
        player.on(AudioPlayerStatus.Idle, () => {
          session.current = null;
          if (session.ffmpeg && !session.ffmpeg.killed) session.ffmpeg.kill('SIGKILL');
          session.ffmpeg = null;
          void startNext(session);
        });
        player.on('error', error => {
          session.lastError = error.message;
          session.current = null;
          if (session.ffmpeg && !session.ffmpeg.killed) session.ffmpeg.kill('SIGKILL');
          session.ffmpeg = null;
          void startNext(session);
        });
        connection.on('stateChange', (_oldState, newState) => {
          if (newState.status === VoiceConnectionStatus.Destroyed) {
            if (session.emptyChannelTimer) clearTimeout(session.emptyChannelTimer);
            session.emptyChannelTimer = null;
            if (sessions.get(guildId) === session) sessions.delete(guildId);
          }
        });
        sessions.set(guildId, session);
        updateEmptyChannelTimer(session);
      }

      if (session.queue.length + tracksToAdd.length > MAX_QUEUE_SIZE) {
        return reply({ content: 'The music queue can hold up to 25 queued tracks. There is not enough room for this selection.', ephemeral: true });
      }
      const wasIdle = !session.current && !session.starting;
      session.queue.push(...tracksToAdd);
      if (wasIdle) {
        const started = await startNext(session);
        if (!started) {
          const reason = session.lastError || 'The audio stream could not be decoded.';
          return reply({
            content: 'Could not start playlist playback. ' + reason,
            ephemeral: true
          });
        }
      }
      return reply({
        content: tracksToAdd.length > 1
          ? '🎶 Added ' + tracksToAdd.length + ' playlist tracks to playback.'
          : (wasIdle ? '🎵 Added to playback: ' : '➕ Added to queue: ') + '**' + tracksToAdd[0].title + '**.'
      });
    }

    if (!session) {
      return interaction.reply({ content: 'ZERON is not connected to a voice channel right now.', ephemeral: true });
    }
    if (!voiceChannel || voiceChannel.id !== session.channelId) {
      return interaction.reply({ content: 'Join ZERON’s voice channel to control its music.', ephemeral: true });
    }

    if (action === 'pause') {
      if (!session.player.pause()) return interaction.reply({ content: 'Music is not currently playing.', ephemeral: true });
      return interaction.reply({ content: '⏸️ Music paused.' });
    }
    if (action === 'resume') {
      if (!session.player.unpause()) return interaction.reply({ content: 'Music is not paused.', ephemeral: true });
      return interaction.reply({ content: '▶️ Music resumed.' });
    }
    if (action === 'skip') {
      if (!session.current) return interaction.reply({ content: 'There is no track to skip.', ephemeral: true });
      session.player.stop();
      return interaction.reply({ content: '⏭️ Skipped the current track.' });
    }
    if (action === 'stop') {
      session.queue.length = 0;
      session.current = null;
      session.player.stop(true);
      if (session.ffmpeg && !session.ffmpeg.killed) session.ffmpeg.kill('SIGKILL');
      session.ffmpeg = null;
      return interaction.reply({ content: '⏹️ Playback stopped and the queue was cleared.' });
    }
    if (action === 'queue') {
      const lines = [];
      if (session.current) lines.push('Now playing: **' + session.current.title + '**');
      session.queue.slice(0, 15).forEach((track, index) => lines.push((index + 1) + '. ' + track.title));
      return interaction.reply({ content: lines.length ? '🎶 **Music queue**\n' + lines.join('\n') : 'The music queue is empty.' });
    }
    if (action === 'leave') {
      destroySession(guildId);
      return interaction.reply({ content: '👋 ZERON left the voice channel and cleared the queue.' });
    }
  }

  return { handle, getSession, destroySession };
}

module.exports = { createMusicService };
