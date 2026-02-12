import { ChatInputCommandInteraction, REST, Routes } from "discord.js";

import * as status from "./status.js";
import * as stop from "./stop.js";
import * as newCmd from "./new.js";
import { logger } from "../../logger.js";

export interface Command {
  data: { name: string; toJSON(): unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands: Command[] = [
  { data: status.data, execute: status.execute },
  { data: stop.data, execute: stop.execute },
  { data: newCmd.data, execute: newCmd.execute },
];

export async function registerCommands(
  token: string,
  appId: string,
  guildId: string
): Promise<void> {
  const rest = new REST().setToken(token);

  const body = commands.map((cmd) => cmd.data.toJSON());

  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });

  logger.info(
    { count: commands.length, guildId },
    "Registered slash commands"
  );
}
