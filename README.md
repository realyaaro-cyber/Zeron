# ZERON

ZERON is a feature-rich Discord server bot with a web dashboard. It brings moderation, member onboarding, community management, leveling, economy tools, games, music, and server analytics together in one place.

## Features

### Moderation and safety
- Member moderation: kick, ban, unban, timeout, and remove timeouts.
- Bulk message cleanup with `/purge`.
- Auto moderation for configured words, links, and mention spam, with strikes and timeout actions.
- Jail and unjail tools for server owners.
- Moderation logs and per-server command controls.

### Member onboarding and roles
- Verification panels with application forms and staff approval or rejection.
- Welcome messages and onboarding configuration.
- Automatic roles and reaction-role panels.
- Invite tracking and join logs.
- Starboard for highlighting popular messages.

### Leveling and community
- Chat XP, rank cards, leaderboards, and configurable level-up announcements.
- Role rewards for reaching configured levels.
- Polls and trivia.
- Birthday management and birthday announcements.
- Giveaways, tickets, custom commands, and embed creation.
- Scheduled announcements with a configurable server time zone.
- Server events with registration, staff roles, brackets, match results, and event announcements.

### Economy and activities
- Server coin balances, member-to-member transfers, transaction history, and personal bank tools.
- Profiles, inventories, collectibles, and a shop.
- Fishing activities with equipment, quests, progression, and stats.
- The `/play` slots mini-game.
- Guild features.

### Extra tools
- Music playback and music configuration.
- Roblox account linking and Discord/Roblox user information.
- Vault alerts that can notify configured roles in selected channels.
- Optional AI chat in configured channels, with a primary provider and up to ten fallback providers.

### Web dashboard
- Sign in with Discord and manage servers where you have the required permissions.
- Configure welcome messages, moderation, verification, onboarding, auto roles, reaction roles, leveling, and level rewards.
- Manage tickets, custom commands, embeds, birthdays, giveaways, announcements, and server events.
- View server analytics, logs, overview statistics, and configure statistics channels.
- Customize your rank-card background.

## Slash commands

ZERON currently registers these commands:

| Category | Commands |
|---|---|
| Server information | `/serverinfo`, `/userinfo` |
| Moderation | `/kick`, `/ban`, `/unban`, `/timeout`, `/untimeout`, `/purge`, `/jail`, `/unjail` |
| Server configuration | `/welcome`, `/starboard`, `/track-invite`, `/enable-level-up`, `/role-reward`, `/manage-cmnds` |
| Community | `/poll`, `/trivia`, `/birthday`, `/vaultalert`, `/vaultpost`, `/aichat`, `/afk`, `/ping` |
| Leveling | `/rank`, `/leaderboard` |
| Economy and activities | `/pay`, `/bank`, `/collectibles`, `/profile`, `/inventory`, `/guild`, `/fish`, `/play`, `/transactions` |
| Music | `/music`, `/music-config` |
| Roblox | `/roblox` |
| Developer and owner | `/devgive`, `/ownergive` |
| Help | `/help` |

Use `/help` in Discord for command usage and options. Dashboard features are configured from the web dashboard rather than through separate slash commands.

## Setup

1. **Create a Discord application** in the [Discord Developer Portal](https://discord.com/developers/applications).
2. **Configure the bot:** create or reset the bot token and enable **Server Members Intent** and **Message Content Intent** under Privileged Gateway Intents.
3. **Configure OAuth2:** copy the Client ID and Client Secret, then add your dashboard callback URL (for example, `https://your-domain/auth/discord/callback`) to the OAuth2 redirect URLs. It must match `DISCORD_REDIRECT_URI` exactly.
4. **Set environment variables** in a `.env` file or your hosting provider's environment panel:

   | Variable | Purpose |
   |---|---|
   | `DISCORD_TOKEN` | Discord bot token |
   | `DISCORD_CLIENT_ID` | Discord application ID |
   | `DISCORD_CLIENT_SECRET` | OAuth2 client secret |
   | `DISCORD_REDIRECT_URI` | Exact OAuth2 callback URL |
   | `SESSION_SECRET` | Long random session secret |
   | `PORT` | Dashboard port (optional) |
   | `BASE_URL` | Public dashboard URL (optional) |
   | `DATABASE_PATH` | SQLite database path (optional) |
   | `AI_PROVIDER` | Primary AI provider label |
   | `AI_BASE_URL` | Primary OpenAI-compatible API base URL, usually ending in `/v1` |
   | `AI_MODEL` | Primary provider model ID |
   | `AI_API_KEY` | Primary provider API key |
   | `AI_BACKUP_1_PROVIDER` through `AI_BACKUP_10_PROVIDER` | Optional fallback provider labels |
   | `AI_BACKUP_1_BASE_URL` through `AI_BACKUP_10_BASE_URL` | Fallback OpenAI-compatible API base URLs |
   | `AI_BACKUP_1_MODEL` through `AI_BACKUP_10_MODEL` | Fallback provider model IDs |
   | `AI_BACKUP_1_API_KEY` through `AI_BACKUP_10_API_KEY` | Fallback provider API keys |

   Example configuration with a primary provider and one fallback:

   ```env
   AI_PROVIDER=Groq
   AI_BASE_URL=https://api.groq.com/openai/v1
   AI_MODEL=your_model_id
   AI_API_KEY=your_groq_key

   AI_BACKUP_1_PROVIDER=OpenRouter
   AI_BACKUP_1_BASE_URL=https://openrouter.ai/api/v1
   AI_BACKUP_1_MODEL=your_openrouter_model_id
   AI_BACKUP_1_API_KEY=your_openrouter_key
   ```

   ZERON tries the primary AI provider first, then configured fallbacks in numerical order. Fallbacks are used for rate limits, unavailable models, quota or payment errors, and temporary network or server errors. Invalid or unauthorized credentials are logged and skipped. Up to ten fallback providers are supported. Providers must expose an OpenAI-compatible `/chat/completions` endpoint. The legacy `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` variables remain supported.

5. **Install dependencies, register commands, and start the bot:**

   ```bash
   npm install
   npm run register
   npm start
   ```

   Run `npm run register` again whenever slash-command definitions change.

6. **Invite the bot** to your Discord server with the permissions required by the features you plan to use. Then open the dashboard and sign in with Discord.

## Development

- Node.js 20.11 or newer (Node.js 22 LTS recommended).
- A host that can keep a Node.js process running and make outbound HTTPS requests.
- Run `npm run check` to perform JavaScript syntax checks on the project files.

## Privacy

ZERON uses Discord account and server data to provide the features enabled in each server. The full privacy policy is available at `/privacy-zeron.html` on the dashboard.

## License

Private project. All rights reserved by the author.
