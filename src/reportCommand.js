const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');

module.exports = (client) => {
  client.on('interactionCreate', async interaction => {
    if (!interaction.isContextMenu()) return;

    if (interaction.commandName === 'Report Message') {
      const modalCustomId = `reportModal_${interaction.targetId}_${interaction.channelId}`;

      const modal = {
        title: 'Report Message',
        custom_id: modalCustomId,
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: 'reasonInput',
                label: 'Reason for report',
                style: 2,
                min_length: 1,
                max_length: 4000,
                required: true,
                placeholder: 'Please provide details about why you are reporting this message.',
              },
            ],
          },
        ],
      };

      await interaction.showModal(modal);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;

    if (interaction.customId.startsWith('reportModal_')) {
      const [, messageId, channelId] = interaction.customId.split('_');
      const reason = interaction.fields.getTextInputValue('reasonInput');

      try {
        const channel = await client.channels.fetch(channelId);
        let reportedMessage;
        let reportedUser;

        try {
          reportedMessage = await channel.messages.fetch(messageId);
          reportedUser = reportedMessage.author;
        } catch (error) {
          // Message not found, but we'll continue with the report
          reportedMessage = null;
          reportedUser = null;
        }

        const reporterUser = interaction.user;

        const reportEmbed = new MessageEmbed()
          .setColor('#ffffff')
          .setTitle('Message Reported')
          .addFields(
            { name: 'Reported User', value: reportedUser ? `<@${reportedUser.id}> (${reportedUser.id})` : 'Unknown (Message deleted)' },
            { name: 'Reported By', value: `<@${reporterUser.id}> (${reporterUser.id})` },
            { name: 'Reported Message', value: reportedMessage ? (reportedMessage.content || '[No text content]') : 'Message no longer available' },
            { name: 'Reason', value: reason.length > 1024 ? reason.slice(0, 1021) + '...' : reason }
          )
          .setTimestamp();

        const components = [];
        if (reportedMessage) {
          const jumpButton = new MessageButton()
            .setLabel('Jump to Message')
            .setStyle('SECONDARY')
            .setCustomId(`jump_${messageId}_${channelId}`);

          const actionRow = new MessageActionRow().addComponents(jumpButton);
          components.push(actionRow);
        }

        const reportChannel = await client.channels.fetch('1259394762994221168');
        await reportChannel.send({ embeds: [reportEmbed], components });

        await interaction.reply({ content: 'Message report has been sent.', ephemeral: true });
      } catch (error) {
        console.error('Error processing report:', error);
        await interaction.reply({ content: 'An error occurred while processing your report. Please try again later.', ephemeral: true });
      }
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('jump_')) {
      const [, messageId, channelId] = interaction.customId.split('_');
      try {
        const channel = await client.channels.fetch(channelId);
        const message = await channel.messages.fetch(messageId);

        await interaction.reply({ content: `[Jump to reported message](${message.url})`, ephemeral: true });
      } catch (error) {
        // Message not found, but we won't log anything
        await interaction.reply({ content: 'The reported message no longer exist.', ephemeral: true });
      }
    }
  });

  return {
    async registerReportCommand() {
      try {
        const command = {
          name: 'Report Message',
          type: 3, // MESSAGE type
        };

        await client.application.commands.create(command);
        console.log('Report Message command registered successfully');
      } catch (error) {
        console.error('Error registering Report Message command:', error);
      }
    }
  };
};