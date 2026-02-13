import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

/**
 * Create an embed displaying tool permission request details.
 * Content is formatted based on the tool type for clarity.
 */
export function createPermissionEmbed(
  toolName: string,
  input: Record<string, unknown>
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Permission Request: ${toolName}`)
    .setColor(0xffa500)
    .setFooter({ text: "Respond within 5 minutes or this will be auto-denied" });

  switch (toolName) {
    case "Bash": {
      const command = String(input.command ?? "");
      embed.setDescription(`\`\`\`\n${command}\n\`\`\``);
      if (input.description) {
        embed.addFields({
          name: "Description",
          value: String(input.description),
        });
      }
      break;
    }

    case "Write": {
      embed.setDescription(`Writing to \`${String(input.file_path ?? "unknown")}\``);
      if (input.content) {
        const preview = String(input.content).slice(0, 500);
        embed.addFields({
          name: "Content Preview",
          value: `\`\`\`\n${preview}\n\`\`\``,
        });
      }
      break;
    }

    case "Edit": {
      embed.setDescription(`Editing \`${String(input.file_path ?? "unknown")}\``);
      if (input.old_string && input.new_string) {
        embed.addFields(
          {
            name: "Old",
            value: `\`\`\`\n${String(input.old_string).slice(0, 500)}\n\`\`\``,
          },
          {
            name: "New",
            value: `\`\`\`\n${String(input.new_string).slice(0, 500)}\n\`\`\``,
          }
        );
      }
      break;
    }

    default: {
      const json = JSON.stringify(input, null, 2).slice(0, 1000);
      embed.setDescription(`\`\`\`json\n${json}\n\`\`\``);
      break;
    }
  }

  return embed;
}

/**
 * Create an action row with Allow and Deny buttons for a permission request.
 * Custom IDs encode the tool_use_id for identification on interaction.
 */
export function createPermissionButtons(
  toolUseId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`perm_allow_${toolUseId}`)
      .setLabel("Allow")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`perm_deny_${toolUseId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
  );
}
