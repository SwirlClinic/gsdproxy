import "dotenv/config";

const required = [
  "DISCORD_TOKEN",
  "DISCORD_APP_ID",
  "DISCORD_GUILD_ID",
  "DISCORD_CHANNEL_ID",
  "DISCORD_OWNER_ID",
] as const;

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      `See .env.example for required values.`
  );
}

export const config = {
  token: process.env.DISCORD_TOKEN!,
  appId: process.env.DISCORD_APP_ID!,
  guildId: process.env.DISCORD_GUILD_ID!,
  channelId: process.env.DISCORD_CHANNEL_ID!,
  ownerId: process.env.DISCORD_OWNER_ID!,
  ipcPort: parseInt(process.env.GSD_IPC_PORT || "9824", 10),
} as const;

export const cwd = process.cwd();
