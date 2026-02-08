const { MessageEmbed } = require("discord.js");

module.exports = (client, activeTickets) => {
  const handleIncognitoReply = async (
    interaction,
    messageContent,
    targetChannel,
  ) => {
    try {
      const ticketInfo = Array.from(activeTickets.values()).find(
        (ticket) => ticket.channel === targetChannel.id,
      );

      if (!ticketInfo) {
        await interaction.editReply({
          content: "This is not an active Mod Mail ticket channel.",
          ephemeral: true,
        });
        return;
      }

      const user = await client.users.fetch(ticketInfo.user);

      const embed = new MessageEmbed()
        .setColor("#ff0000")
        .setTitle("Staff Reply")
        .setDescription(messageContent)
        .setFooter({
          text: `${interaction.guild.name}`,
          iconURL: interaction.guild.iconURL({ dynamic: true }),
        })
        .setTimestamp();

      if (interaction.options.getAttachment("image")) {
        const attachment = interaction.options.getAttachment("image");
        embed.setImage(attachment.url);
      }

      await user.send({ embeds: [embed] }).catch(console.error);
      await targetChannel.send({ embeds: [embed] }).catch(console.error);

      await interaction.editReply({
        content: "Incognito reply sent successfully.",
        ephemeral: true,
      });
    } catch (error) {
      console.error("Error handling incognito reply:", error);
      await interaction.editReply({
        content: "An error occurred while processing your request.",
        ephemeral: true,
      });
    }
  };

  return { handleIncognitoReply };
};
