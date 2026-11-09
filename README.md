# ZERON

ZERON is a Discord bot with a web dashboard. It helps you run your server: moderation, member verification, welcome messages, levels, games, birthdays, announcements, and giveaways. You set it all up from the dashboard, so no coding is needed.

## Features

- **Moderation:** kick, ban, unban, timeout, untimeout, and bulk message purge, with logs in a channel you choose.
- **Auto moderation:** blocks bad words, links, and mention spam, and gives strikes that lead to timeouts.
- **Verification:** new members get an Unverified role, fill in an application form, and staff approve or reject it. Approval swaps in the Verified role.
- **Welcome and roles:** welcome messages, auto-role, reaction roles, and invite tracking.
- **Levels:** XP from chatting, a rank card, a leaderboard, and level rewards.
- **Economy and games:** coins, `/pay`, a profile, an inventory, fishing with rods, bait, quests, and a shop, and slots.
- **Community:** birthdays, giveaways, custom commands, an embed builder, tickets, and scheduled announcements in each server's own time zone.
- **Dashboard:** sign in with Discord, pick a server you manage, and change channels, welcome text, moderation, leveling, roles, logs, and settings.

## Commands

**Moderation and server:** `/serverinfo`, `/userinfo`, `/kick`, `/ban`, `/unban`, `/timeout`, `/untimeout`, `/purge`

**Setup (admins):** `/welcome`, `/channel`, `/message`, `/enabled`, `/track-invite`, `/enable-level-up`, `/role-reward`

**Members:** `/rank`, `/leaderboard`, `/profile`, `/inventory`, `/pay`, `/transactions`, `/birthday`, `/fish`, `/play`

**Developer and owner:** `/devbank`, `/devgive`, `/ownergive`, `/help`

Run `/help` in your server to see the full list with usage.

## Setup

1. **Create an application** in the [Discord Developer Portal](https://discord.com/developers/applications).
2. **Bot page:** create or reset the bot token, and turn on **Server Members Intent** and **Message Content Intent** under Privileged Gateway Intents.
3. **OAuth2 → General:** copy the Client ID and Client Secret, and add your redirect URL (`https://your-domain/auth/discord/callback`) under Redirects. It must match `DISCORD_REDIRECT_URI` exactly.
4. **Set environment variables** (in a `.env` file or your host's variables panel):

   | Variable | What it is |
   |---|---|
   | `DISCORD_TOKEN` | Bot token |
   | `DISCORD_CLIENT_ID` | Application ID |
   | `DISCORD_CLIENT_SECRET` | OAuth2 client secret |
   | `DISCORD_REDIRECT_URI` | Redirect URL from step 3 |
   | `SESSION_SECRET` | Any long random text |
   | `PORT` | Port for the dashboard (optional) |
   | `BASE_URL` | Public address of the dashboard (optional) |
   | `DATABASE_PATH` | Where the SQLite file is stored (optional) |

5. **Install and start:**
   ```
   npm install
   npm run register
   npm start
   ```
   `npm run register` updates the slash commands. Run it again whenever commands change.
6. **Invite the bot** to your server with the Administrator permission, then open the dashboard and sign in.

## Requirements

- Node.js 20.11 or newer (22 LTS recommended)
- A host that keeps a Node process running and allows outgoing HTTPS

## Privacy

ZERON uses Discord account and server data only to run the features you turn on. The full privacy policy is at `/privacy-zeron.html` on the dashboard.

## License

Private project. All rights reserved by the author.
