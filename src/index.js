const fs = require('fs').promises;
const path = require('path');
const { Client, Intents, MessageEmbed, MessageActionRow, MessageButton, Modal, TextInputComponent, MessageSelectMenu } = require('discord.js');
require('dotenv').config();
const reportCommand = require('./reportCommand');
const leaderboard = require('./leaderboard');
require('./keep_alive');

console.log('Starting Discord bot...');
console.log('TOKEN exists:', !!process.env.TOKEN);
console.log('GUILD_IDS:', process.env.GUILD_IDS);

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.DIRECT_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.DIRECT_MESSAGE_REACTIONS
  ],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION'],
  allowedMentions: { parse: ["roles", "users", "everyone"], repliedUser: true }
});

const activeTickets = new Map();
const messageCooldowns = new Map();
const TICKETS_FILE = path.join(__dirname, 'tickets.json');

// Load tickets from file
async function loadTickets() {
  try {
    const data = await fs.readFile(TICKETS_FILE, 'utf8');
    const tickets = JSON.parse(data);
    for (const [userId, ticketInfo] of Object.entries(tickets)) {
      activeTickets.set(userId, ticketInfo);
    }
    console.log(`Loaded ${activeTickets.size} active tickets from file.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing tickets file found. Starting fresh.');
    } else {
      console.error('Error loading tickets:', error);
    }
  }
}

// Save tickets to file
async function saveTickets() {
  try {
    const tickets = Object.fromEntries(activeTickets);
    await fs.writeFile(TICKETS_FILE, JSON.stringify(tickets, null, 2));
  } catch (error) {
    console.error('Error saving tickets:', error);
  }
}

// Support multiple guild IDs (comma-separated in .env)
const guildIds = process.env.GUILD_IDS ? process.env.GUILD_IDS.split(',').map(id => id.trim()) : ["1453758727479099511"];
const guildId = guildIds[0]; // Primary guild for backwards compatibility
const categoryID = "1453760847867543809";
const staffRoleID = "1469803259764932735";
const staffChannelID = "1453767170726301766";
const closedCategoryID = "1453761989972066469";
const additionalRoleID = "1453763625935441990";
const transcriptChannelID = "1453786693722439824";

const staffRoles = {
  "1469803367923712052": "Server Owner",
  "1469803259764932735": "Moderator"
};

// Category-specific channel IDs for ticket threads
const categoryChannels = {
  'support': '1460834069863727313'
};

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity('DM to Contact Staff | /Connect ❤️', { type: 'PLAYING' });
  await loadTickets();
  await registerSlashCommands();
  const { registerReportCommand } = reportCommand(client);
  await registerReportCommand();
});

async function registerSlashCommands() {
  try {
    const commands = [
      {
        name: 'leaderboard',
        description: 'View the ticket leaderboard',
        type: 'CHAT_INPUT',
        options: [
          {
            name: 'general',
            description: 'View general ticket leaderboard',
            type: 'SUB_COMMAND',
            options: [
              {
                name: 'duration',
                description: 'Time period to view',
                type: 'STRING',
                required: false,
                choices: [
                  { name: 'Today', value: 'today' },
                  { name: 'This Month', value: 'month' },
                  { name: 'Last Month', value: 'lastmonth' },
                  { name: 'All Time', value: 'all' }
                ]
              }
            ]
          }
        ]
      }
    ];

    // Register commands in all guilds
    for (const gId of guildIds) {
      const guild = client.guilds.cache.get(gId);
      if (!guild) {
        console.error(`Guild ${gId} not found.`);
        continue;
      }

      const commandList = await guild.commands.set(commands);
      console.log(`Registered ${commandList.size} slash commands in guild ${guild.name}.`);
    }
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const { commandName } = interaction;
  
  try {
    if (commandName === 'leaderboard') {
      await interaction.deferReply({ ephemeral: false });
      await leaderboard.handleLeaderboardCommand(interaction);
    }
  } catch (error) {
    console.error(`Error handling ${commandName} command:`, error);
    const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
    await interaction[replyMethod]({ content: 'An error occurred while processing your request.', ephemeral: true }).catch(console.error);
  }
});

async function generateTranscript(channel, ticketUser, guild, closedBy, reason) {
  // Fetch all messages from the channel
  let allMessages = [];
  let lastMessageId = null;
  
  while (true) {
    const options = { limit: 100 };
    if (lastMessageId) options.before = lastMessageId;
    
    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;
    
    allMessages = allMessages.concat(Array.from(messages.values()));
    lastMessageId = messages.last().id;
    
    if (messages.size < 100) break;
  }
  
  // Sort messages oldest first
  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  
  const guildIcon = guild.iconURL({ dynamic: true, size: 128 }) || '';
  const ticketName = channel.name;
  const createdAt = new Date(channel.createdTimestamp).toLocaleString();
  const closedAt = new Date().toLocaleString();
  
  // Build messages HTML
  let messagesHtml = '';
  for (const msg of allMessages) {
    const avatar = msg.author.displayAvatarURL({ dynamic: true, size: 64 });
    const timestamp = new Date(msg.createdTimestamp).toLocaleString();
    const isBot = msg.author.bot;
    const content = escapeHtml(msg.content);
    
    // Handle embeds
    let embedsHtml = '';
    if (msg.embeds.length > 0) {
      for (const embed of msg.embeds) {
        let embedContent = '';
        if (embed.title) embedContent += '<div class="embed-title">' + escapeHtml(embed.title) + '</div>';
        if (embed.description) embedContent += '<div class="embed-description">' + escapeHtml(embed.description) + '</div>';
        if (embed.fields && embed.fields.length > 0) {
          for (const field of embed.fields) {
            embedContent += '<div class="embed-field"><div class="embed-field-name">' + escapeHtml(field.name) + '</div><div class="embed-field-value">' + escapeHtml(field.value) + '</div></div>';
          }
        }
        embedsHtml += '<div class="embed">' + embedContent + '</div>';
      }
    }
    
    // Handle attachments
    let attachmentsHtml = '';
    if (msg.attachments.size > 0) {
      for (const att of msg.attachments.values()) {
        if (att.contentType && att.contentType.startsWith('image/')) {
          attachmentsHtml += '<div class="attachment"><img src="' + att.url + '" alt="attachment"></div>';
        } else {
          attachmentsHtml += '<div class="attachment"><a href="' + att.url + '" target="_blank">' + escapeHtml(att.name) + '</a></div>';
        }
      }
    }
    
    messagesHtml += '<div class="message">';
    messagesHtml += '<img class="avatar" src="' + avatar + '" alt="avatar">';
    messagesHtml += '<div class="message-content">';
    messagesHtml += '<div class="message-header">';
    messagesHtml += '<span class="username">' + escapeHtml(msg.author.username) + '</span>';
    if (isBot) messagesHtml += '<span class="bot-tag">BOT</span>';
    messagesHtml += '<span class="timestamp">' + timestamp + '</span>';
    messagesHtml += '</div>';
    if (content) messagesHtml += '<div class="text">' + content + '</div>';
    messagesHtml += embedsHtml;
    messagesHtml += attachmentsHtml;
    messagesHtml += '</div></div>';
  }

  // Generate HTML transcript
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transcript - ${ticketName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #36393f; color: #dcddde; }
    .header { background: #2f3136; padding: 20px; display: flex; align-items: center; gap: 15px; border-bottom: 1px solid #202225; }
    .header img { width: 64px; height: 64px; border-radius: 50%; }
    .header-info h1 { color: #fff; font-size: 1.5em; }
    .header-info p { color: #b9bbbe; font-size: 0.9em; }
    .info-bar { background: #2f3136; padding: 15px 20px; display: flex; flex-wrap: wrap; gap: 20px; border-bottom: 1px solid #202225; }
    .info-item { display: flex; flex-direction: column; }
    .info-item label { color: #72767d; font-size: 0.75em; text-transform: uppercase; font-weight: 600; }
    .info-item span { color: #fff; }
    .messages { padding: 20px; }
    .message { display: flex; gap: 15px; padding: 10px 0; }
    .message:hover { background: #32353b; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }
    .message-content { flex: 1; }
    .message-header { display: flex; align-items: baseline; gap: 8px; }
    .username { color: #fff; font-weight: 500; }
    .bot-tag { background: #5865f2; color: #fff; font-size: 0.65em; padding: 2px 5px; border-radius: 3px; font-weight: 500; }
    .timestamp { color: #72767d; font-size: 0.75em; }
    .text { color: #dcddde; line-height: 1.4; margin-top: 4px; word-wrap: break-word; }
    .embed { background: #2f3136; border-left: 4px solid #5865f2; border-radius: 4px; padding: 12px; margin-top: 8px; max-width: 520px; }
    .embed-title { color: #fff; font-weight: 600; margin-bottom: 8px; }
    .embed-description { color: #dcddde; font-size: 0.9em; }
    .embed-field { margin-top: 8px; }
    .embed-field-name { color: #fff; font-weight: 600; font-size: 0.9em; }
    .embed-field-value { color: #dcddde; font-size: 0.9em; }
    .attachment { margin-top: 8px; }
    .attachment img { max-width: 400px; max-height: 300px; border-radius: 4px; }
    .attachment a { color: #00aff4; text-decoration: none; }
    .attachment a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="header">
    ${guildIcon ? '<img src="' + guildIcon + '" alt="Server Icon">' : ''}
    <div class="header-info">
      <h1>${escapeHtml(guild.name)}</h1>
      <p>Ticket Transcript - ${ticketName}</p>
    </div>
  </div>
  <div class="info-bar">
    <div class="info-item">
      <label>Ticket User</label>
      <span>${escapeHtml(ticketUser.tag)}</span>
    </div>
    <div class="info-item">
      <label>Closed By</label>
      <span>${escapeHtml(closedBy.tag)}</span>
    </div>
    <div class="info-item">
      <label>Created</label>
      <span>${createdAt}</span>
    </div>
    <div class="info-item">
      <label>Closed</label>
      <span>${closedAt}</span>
    </div>
    <div class="info-item">
      <label>Messages</label>
      <span>${allMessages.length}</span>
    </div>
    <div class="info-item">
      <label>Close Reason</label>
      <span>${escapeHtml(reason)}</span>
    </div>
  </div>
  <div class="messages">
    ${messagesHtml}
  </div>
</body>
</html>`;

  // Generate TXT transcript
  let txtContent = 'TICKET TRANSCRIPT\n\n';
  txtContent += 'Server: ' + guild.name + '\n';
  txtContent += 'Ticket: ' + ticketName + '\n';
  txtContent += 'Ticket User: ' + ticketUser.tag + ' (' + ticketUser.id + ')\n';
  txtContent += 'Closed By: ' + closedBy.tag + ' (' + closedBy.id + ')\n';
  txtContent += 'Created: ' + createdAt + '\n';
  txtContent += 'Closed: ' + closedAt + '\n';
  txtContent += 'Total Messages: ' + allMessages.length + '\n';
  txtContent += 'Close Reason: ' + reason + '\n\n';
  txtContent += 'MESSAGES\n\n';

  for (const msg of allMessages) {
    const timestamp = new Date(msg.createdTimestamp).toLocaleString();
    const author = msg.author.bot ? '[BOT] ' + msg.author.username : msg.author.username;
    
    txtContent += '[' + timestamp + '] ' + author + ':\n';
    
    if (msg.content) {
      txtContent += msg.content + '\n';
    }
    
    // Handle embeds in text format
    if (msg.embeds.length > 0) {
      for (const embed of msg.embeds) {
        if (embed.title) txtContent += '  [Embed Title] ' + embed.title + '\n';
        if (embed.description) txtContent += '  [Embed] ' + embed.description + '\n';
        if (embed.fields) {
          for (const field of embed.fields) {
            txtContent += '  [' + field.name + '] ' + field.value + '\n';
          }
        }
      }
    }
    
    // Handle attachments
    if (msg.attachments.size > 0) {
      for (const att of msg.attachments.values()) {
        txtContent += '  [Attachment] ' + att.name + ': ' + att.url + '\n';
      }
    }
    
    txtContent += '\n';
  }

  txtContent += 'END OF TRANSCRIPT';

  // Create file buffers
  const htmlBuffer = Buffer.from(htmlContent, 'utf-8');
  const txtBuffer = Buffer.from(txtContent, 'utf-8');

  return {
    html: { attachment: htmlBuffer, name: 'transcript-' + ticketName + '.html' },
    txt: { attachment: txtBuffer, name: 'transcript-' + ticketName + '.txt' }
  };
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function handleCloseTicket(interaction, channel) {
  try {
    const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.channel === channel.id);
    if (!ticketInfo) {
      await interaction.editReply({ content: 'This is not an active Mod Mail ticket channel.', ephemeral: true });
      return;
    }

    // Delete the reply immediately so no message shows
    await interaction.deleteReply().catch(console.error);
    
    // Track close stat
    await leaderboard.incrementClose(interaction.user.id);

    const user = await client.users.fetch(ticketInfo.user);
    const randomNumber = Math.floor(1000 + Math.random() * 9000);
    
    let staffTitle = "Staff";
    for (const [roleId, title] of Object.entries(staffRoles)) {
      if (interaction.member.roles.cache.has(roleId)) {
        staffTitle = title;
        break;
      }
    }

    // Send close embed in the ticket channel
    const closeEmbed = new MessageEmbed()
      .setColor('#e74c3c')
      .setTitle('Ticket Closed')
      .setDescription(`This ticket has been closed by <@${interaction.user.id}> • ${staffTitle}`)
      .setTimestamp();

    await channel.send({ embeds: [closeEmbed] }).catch(console.error);
    
    // Generate transcript before closing
    const transcript = await generateTranscript(channel, user, interaction.guild, interaction.user, 'Ticket closed by staff');
    
    // Send transcript and logs before closing
    let transcriptMessageLink = '';
    const transcriptChannel = await client.channels.fetch(transcriptChannelID).catch(() => null);
    if (transcriptChannel && transcriptChannel.isText()) {
      const transcriptEmbed = new MessageEmbed()
        .setColor('#FFFFFF')
        .setTitle('Ticket Transcript')
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
        .addFields(
          { name: 'User', value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setFooter({ text: `Ticket ID: closed-${randomNumber}`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setTimestamp();
      
      const transcriptMessage = await transcriptChannel.send({ 
        embeds: [transcriptEmbed], 
        files: [transcript.html, transcript.txt] 
      }).catch(console.error);
      
      if (transcriptMessage) {
        transcriptMessageLink = `https://discord.com/channels/${interaction.guild.id}/${transcriptChannelID}/${transcriptMessage.id}`;
      }
    }
    
    // Create the log embed with link to transcript
    const modmailLogEmbed = new MessageEmbed()
      .setColor('#e74c3c')
      .setTitle('Ticket Closed')
      .setDescription(`Closed by <@${interaction.user.id}> • ${staffTitle}\n\nTranscript: ${transcriptMessageLink ? `[View Transcript](${transcriptMessageLink})` : 'Not available'}`)
      .setAuthor({ name: `${interaction.user.tag} • ${staffTitle}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
      .setFooter({ text: `${interaction.guild.name}`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
      .setTimestamp();
    
    // Determine which channel to send the log to based on ticket category
    const ticketCategory = ticketInfo.category || 'support';
    const logChannelID = categoryChannels[ticketCategory] || staffChannelID;
    
    const logChannel = await client.channels.fetch(logChannelID).catch(() => null);
    if (logChannel && logChannel.isText()) {
      await logChannel.send({ embeds: [modmailLogEmbed] }).catch(console.error);
    }

    const closingMessageEmbed = new MessageEmbed()
      .setColor('#e74c3c')
      .setTitle('Ticket Closed')
      .setDescription('Your ticket has been closed. If you require further assistance, please reach out to <@1453758099977539706> again and open up a new ticket.')
      .setAuthor({ name: `${interaction.user.tag} • ${staffTitle}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
      .setFooter({ text: `${interaction.guild.name}`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
      .setTimestamp();

    await user.send({ embeds: [closingMessageEmbed] }).catch(console.error);
    
    // NOW close the ticket (archive, lock, etc.) - do this LAST
    if (channel.isThread()) {
      // Check if parent is a forum channel
      const parentChannel = channel.parent;
      if (parentChannel && parentChannel.type === 'GUILD_FORUM') {
        // Apply the closed tag to the forum post
        const closedTagId = '1469809524427985122';
        try {
          await channel.setAppliedTags([closedTagId]);
        } catch (error) {
          console.error('Error applying closed tag:', error);
        }
      }
      
      // Remove the user from the thread
      try {
        await channel.members.remove(user.id);
      } catch (error) {
        console.error('Error removing user from thread:', error);
      }
      
      // Remove the staff member who claimed the ticket from the thread
      if (ticketInfo.claimedBy) {
        try {
          await channel.members.remove(ticketInfo.claimedBy);
        } catch (error) {
          console.error('Error removing staff member from thread:', error);
        }
      }
      
      // Lock first, then archive (can't lock an archived thread)
      await channel.setLocked(true);
      await channel.setArchived(true);
    } else {
      // Fallback for regular channels
      const closedCategory = interaction.guild.channels.cache.get(closedCategoryID);
      await channel.setParent(closedCategory.id, { lockPermissions: false });
      await channel.permissionOverwrites.set([
        {
          id: interaction.guild.roles.everyone.id,
          deny: ['VIEW_CHANNEL']
        },
        {
          id: staffRoleID,
          allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_CHANNELS']
        }
      ]);
    }
    activeTickets.delete(ticketInfo.user);
    await saveTickets();

  } catch (error) {
    console.error('Error handling close ticket command:', error);
    try {
      await interaction.editReply({ content: 'An error occurred while processing your request.', ephemeral: true });
    } catch (e) {
      console.error('Could not send error message:', e);
    }
  }
}

async function handleCloseTicketByUser(channel, user, guild, ticketInfo) {
  try {
    const randomNumber = Math.floor(1000 + Math.random() * 9000);

    // Send close embed in the ticket channel
    const closeEmbed = new MessageEmbed()
      .setColor('#e74c3c')
      .setTitle('Ticket Closed')
      .setDescription(`This ticket has been closed by the user <@${user.id}>`)
      .setTimestamp();

    await channel.send({ embeds: [closeEmbed] }).catch(console.error);
    
    // Generate transcript before closing
    const transcript = await generateTranscript(channel, user, guild, user, 'Ticket closed by user');
    
    // For threads (including forum posts), apply closed tag and lock
    if (channel.isThread()) {
      // Check if parent is a forum channel
      const parentChannel = channel.parent;
      if (parentChannel && parentChannel.type === 'GUILD_FORUM') {
        // Apply the closed tag to the forum post
        const closedTagId = '1469809524427985122';
        try {
          await channel.setAppliedTags([closedTagId]);
        } catch (error) {
          console.error('Error applying closed tag:', error);
        }
      }
      
      // Remove the user from the thread
      try {
        await channel.members.remove(user.id);
      } catch (error) {
        console.error('Error removing user from thread:', error);
      }
      
      // Remove the staff member who claimed the ticket from the thread
      if (ticketInfo?.claimedBy) {
        try {
          await channel.members.remove(ticketInfo.claimedBy);
        } catch (error) {
          console.error('Error removing staff member from thread:', error);
        }
      }
      
      // Lock first, then archive (can't lock an archived thread)
      await channel.setLocked(true);
      await channel.setArchived(true);
    }
    
    activeTickets.delete(user.id);
    await saveTickets();

    const closingMessageEmbed = new MessageEmbed()
      .setColor('#e74c3c')
      .setTitle('Ticket Closed')
      .setDescription('Your ticket has been closed successfully. If you require further assistance, please reach out to <@1255271678519283814> again and open up a new ticket.')
      .setFooter({ text: `${guild.name}`, iconURL: guild.iconURL({ dynamic: true }) })
      .setTimestamp();

    await user.send({ embeds: [closingMessageEmbed] }).catch(console.error);
    
    // Send transcript to transcript channel
    let transcriptMessageLink = '';
    const transcriptChannel = await client.channels.fetch(transcriptChannelID).catch(() => null);
    if (transcriptChannel && transcriptChannel.isText()) {
      const transcriptEmbed = new MessageEmbed()
        .setColor('#FFFFFF')
        .setTitle('Ticket Transcript')
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
        .addFields(
          { name: 'User', value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: 'Closed By', value: `User (${user.tag})`, inline: true }
        )
        .setFooter({ text: `Ticket ID: closed-${randomNumber}`, iconURL: guild.iconURL({ dynamic: true }) })
        .setTimestamp();
      
      const transcriptMessage = await transcriptChannel.send({ 
        embeds: [transcriptEmbed], 
        files: [transcript.html, transcript.txt] 
      }).catch(console.error);
      
      if (transcriptMessage) {
        transcriptMessageLink = `https://discord.com/channels/${guild.id}/${transcriptChannelID}/${transcriptMessage.id}`;
      }
    }
    
    // Create the log embed with link to transcript
    const modmailLogEmbed = new MessageEmbed()
      .setColor('#e74c3c')
      .setTitle('Ticket Closed')
      .setDescription(`Closed by user <@${user.id}>\n\nTranscript: ${transcriptMessageLink ? `[View Transcript](${transcriptMessageLink})` : 'Not available'}`)
      .setFooter({ text: `${guild.name}`, iconURL: guild.iconURL({ dynamic: true }) })
      .setTimestamp();
    
    // Determine which channel to send the log to based on ticket category
    const ticketCategory = ticketInfo?.category || 'support';
    const logChannelID = categoryChannels[ticketCategory] || staffChannelID;
    
    const logChannel = await client.channels.fetch(logChannelID).catch(() => null);
    if (logChannel && logChannel.isText()) {
      await logChannel.send({ embeds: [modmailLogEmbed] }).catch(console.error);
    }
  } catch (error) {
    console.error('Error handling user close ticket:', error);
  }
}

client.on('interactionCreate', async (interaction) => {
  // Handle leaderboard pagination buttons
  if (interaction.isButton() && interaction.customId.startsWith('leaderboard_')) {
    await leaderboard.handleLeaderboardButton(interaction);
    return;
  }
  
  // Handle claim ticket button
  if (interaction.isButton() && interaction.customId === 'claim_ticket_button') {
    if (!interaction.member.roles.cache.has(staffRoleID) && !interaction.member.roles.cache.has(additionalRoleID)) {
      await interaction.reply({ content: 'You do not have permission to claim this ticket.', ephemeral: true });
      return;
    }

    try {
      const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.channel === interaction.channel.id);
      if (!ticketInfo) {
        await interaction.reply({ content: 'This is not an active ticket.', ephemeral: true });
        return;
      }

      // Check if ticket is already claimed
      if (ticketInfo.claimedBy) {
        await interaction.reply({ content: `This ticket has already been claimed by <@${ticketInfo.claimedBy}>.`, ephemeral: true });
        return;
      }

      // Claim the ticket
      ticketInfo.claimedBy = interaction.user.id;
      
      // Track claim stat only if this is the first time the ticket is being claimed
      if (!ticketInfo.everClaimed) {
        await leaderboard.incrementClaim(interaction.user.id);
        ticketInfo.everClaimed = true;
      }

      let staffTitle = "Staff";
      for (const [roleId, title] of Object.entries(staffRoles)) {
        if (interaction.member.roles.cache.has(roleId)) {
          staffTitle = title;
          break;
        }
      }

      const claimEmbed = new MessageEmbed()
        .setColor('#00ff00')
        .setTitle('Ticket Claimed')
        .setDescription(`This ticket has been claimed by <@${interaction.user.id}> • ${staffTitle}`)
        .setTimestamp();

      await interaction.reply({ embeds: [claimEmbed] });

      // Add the staff member to the thread AFTER sending the claim message
      if (interaction.channel.isThread()) {
        try {
          await interaction.channel.members.add(interaction.user.id);
        } catch (error) {
          console.error('Error adding staff member to thread:', error);
        }
        
        // Apply the claimed tag to the forum post
        const parentChannel = interaction.channel.parent;
        if (parentChannel && parentChannel.type === 'GUILD_FORUM') {
          const unclaimedTagId = '1469809498762907810';
          const claimedTagId = '1469830046364471529';
          const waitingForStaffTagId = '1469833317686841355';
          try {
            // Remove unclaimed tag, add claimed + waiting for staff tags (claimed first)
            const currentTags = interaction.channel.appliedTags || [];
            const newTags = currentTags.filter(tag => tag !== unclaimedTagId);
            // Add claimed first, then waiting for staff
            if (!newTags.includes(claimedTagId)) newTags.push(claimedTagId);
            if (!newTags.includes(waitingForStaffTagId)) newTags.push(waitingForStaffTagId);
            await interaction.channel.setAppliedTags(newTags);
          } catch (error) {
            console.error('Error applying claimed tag:', error);
          }
        }
      }

      // Update the buttons to show unclaim option
      const updatedButtons = new MessageActionRow()
        .addComponents(
          new MessageButton()
            .setCustomId('unclaim_ticket_button')
            .setLabel('Unclaim')
            .setStyle('SECONDARY')
            .setEmoji('🔓'),
          new MessageButton()
            .setCustomId('close_ticket_button')
            .setLabel('Close')
            .setStyle('DANGER')
            .setEmoji('🔒')
        );

      // Find and update the starter message with new buttons
      if (interaction.channel.isThread()) {
        const parentChannel = interaction.channel.parent;
        if (parentChannel && parentChannel.type === 'GUILD_FORUM') {
          // For forum posts, get the starter message
          try {
            const starterMessage = await interaction.channel.fetchStarterMessage();
            if (starterMessage) {
              await starterMessage.edit({ 
                embeds: starterMessage.embeds,
                components: [updatedButtons] 
              });
            }
          } catch (error) {
            console.error('Error updating forum starter message buttons:', error);
          }
        } else {
          // For regular threads, find the message in the channel
          const messages = await interaction.channel.messages.fetch({ limit: 10 });
          const starterMessage = messages.find(msg => msg.author.id === client.user.id && msg.embeds.length > 0 && msg.embeds[0].footer?.text?.includes('User ID:'));
          if (starterMessage) {
            await starterMessage.edit({ components: [updatedButtons] }).catch(console.error);
          }
        }
      }
    } catch (error) {
      console.error('Error claiming ticket:', error);
      await interaction.reply({ content: 'An error occurred while claiming the ticket.', ephemeral: true });
    }
    return;
  }

  // Handle unclaim ticket button
  if (interaction.isButton() && interaction.customId === 'unclaim_ticket_button') {
    if (!interaction.member.roles.cache.has(staffRoleID) && !interaction.member.roles.cache.has(additionalRoleID)) {
      await interaction.reply({ content: 'You do not have permission to unclaim this ticket.', ephemeral: true });
      return;
    }

    try {
      const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.channel === interaction.channel.id);
      if (!ticketInfo) {
        await interaction.reply({ content: 'This is not an active ticket.', ephemeral: true });
        return;
      }

      // Check if ticket is claimed
      if (!ticketInfo.claimedBy) {
        await interaction.reply({ content: 'This ticket is not claimed.', ephemeral: true });
        return;
      }

      // Check if the user is the one who claimed it or has staff permissions
      if (ticketInfo.claimedBy !== interaction.user.id && !interaction.member.roles.cache.has(staffRoleID)) {
        await interaction.reply({ content: 'Only the staff member who claimed this ticket or admins can unclaim it.', ephemeral: true });
        return;
      }

      // Unclaim the ticket
      delete ticketInfo.claimedBy;

      const unclaimEmbed = new MessageEmbed()
        .setColor('#ff9900')
        .setTitle('Ticket Unclaimed')
        .setDescription(`This ticket has been unclaimed by <@${interaction.user.id}>`)
        .setTimestamp();

      await interaction.reply({ embeds: [unclaimEmbed] });

      // Remove the claimed tag from the forum post
      if (interaction.channel.isThread()) {
        const parentChannel = interaction.channel.parent;
        if (parentChannel && parentChannel.type === 'GUILD_FORUM') {
          const unclaimedTagId = '1469809498762907810';
          const claimedTagId = '1469830046364471529';
          const waitingForStaffTagId = '1469833317686841355';
          const waitingForUserTagId = '1469809601464504332';
          try {
            // Remove claimed and waiting tags, add unclaimed tag
            const currentTags = interaction.channel.appliedTags || [];
            const newTags = currentTags.filter(tag => tag !== claimedTagId && tag !== waitingForStaffTagId && tag !== waitingForUserTagId);
            if (!newTags.includes(unclaimedTagId)) {
              newTags.push(unclaimedTagId);
            }
            await interaction.channel.setAppliedTags(newTags);
          } catch (error) {
            console.error('Error updating tags on unclaim:', error);
          }
        }
      }

      // Update the buttons back to claim option
      const updatedButtons = new MessageActionRow()
        .addComponents(
          new MessageButton()
            .setCustomId('claim_ticket_button')
            .setLabel('Claim Ticket')
            .setStyle('PRIMARY')
            .setEmoji('👤'),
          new MessageButton()
            .setCustomId('close_ticket_button')
            .setLabel('Close')
            .setStyle('DANGER')
            .setEmoji('🔒')
        );

      // Find and update the starter message with new buttons
      if (interaction.channel.isThread()) {
        const parentChannel = interaction.channel.parent;
        if (parentChannel && parentChannel.type === 'GUILD_FORUM') {
          // For forum posts, get the starter message
          try {
            const starterMessage = await interaction.channel.fetchStarterMessage();
            if (starterMessage) {
              await starterMessage.edit({ 
                embeds: starterMessage.embeds,
                components: [updatedButtons] 
              });
            }
          } catch (error) {
            console.error('Error updating forum starter message buttons:', error);
          }
        } else {
          // For regular threads, find the message in the channel
          const messages = await interaction.channel.messages.fetch({ limit: 10 });
          const starterMessage = messages.find(msg => msg.author.id === client.user.id && msg.embeds.length > 0 && msg.embeds[0].footer?.text?.includes('User ID:'));
          if (starterMessage) {
            await starterMessage.edit({ components: [updatedButtons] }).catch(console.error);
          }
        }
      }
    } catch (error) {
      console.error('Error unclaiming ticket:', error);
      await interaction.reply({ content: 'An error occurred while unclaiming the ticket.', ephemeral: true });
    }
    return;
  }

  // Handle close ticket button - close directly without modal
  if (interaction.isButton() && interaction.customId === 'close_ticket_button') {
    if (!interaction.member.roles.cache.has(staffRoleID) && !interaction.member.roles.cache.has(additionalRoleID)) {
      await interaction.reply({ content: 'You do not have permission to close this ticket.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await handleCloseTicket(interaction, interaction.channel);
    return;
  }

  if (!interaction.isButton()) return;
  if (interaction.customId === 'delete_ticket') {
    await handleDeleteTicket(interaction);
  }
});

async function handleDeleteTicket(interaction) {
  try {
    if (!interaction.member.roles.cache.has(staffRoleID)) {
      await interaction.reply({ content: 'You do not have permission to delete this ticket.', ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    const channel = interaction.channel;
    const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.channel === channel.id);
    const countdownEmbed = new MessageEmbed()
      .setColor('#e74c3c')
      .setTitle('Ticket Deletion Countdown')
      .setDescription('This ticket will be deleted in:');

    const countdownMessage = await channel.send({ embeds: [countdownEmbed] });
    for (let seconds = 5; seconds > 0; seconds--) {
      await countdownMessage.edit({ embeds: [countdownEmbed.setDescription(`This ticket will be deleted in: ${seconds} seconds`)] });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await channel.delete();
    if (ticketInfo) {
      activeTickets.delete(ticketInfo.user);
      await saveTickets();
    }
  } catch (error) {
    console.error('Error handling delete ticket:', error);
    await interaction.followUp({ content: 'An error occurred while deleting the ticket.', ephemeral: true });
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Prevent duplicate processing with cooldown
  const cooldownKey = `${message.author.id}-${message.id}`;
  if (messageCooldowns.has(cooldownKey)) return;
  messageCooldowns.set(cooldownKey, true);
  setTimeout(() => messageCooldowns.delete(cooldownKey), 5000);
  
  // Handle DM messages from users
  if (message.channel.type === 'DM') {
    // Find which guild the user is in
    let guild = null;
    for (const gId of guildIds) {
      const g = client.guilds.cache.get(gId);
      if (g) {
        try {
          const member = await g.members.fetch(message.author.id);
          if (member) {
            guild = g;
            break;
          }
        } catch (error) {
          // User not in this guild, continue checking
          continue;
        }
      }
    }
    
    if (!guild) {
      console.error('User is not in any configured guild.');
      return;
    }

    const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.user === message.author.id);
    
    if (ticketInfo) {
      // Use the guild stored in the ticket info
      const ticketGuild = client.guilds.cache.get(ticketInfo.guildId || guild.id);
      if (!ticketGuild) {
        console.error('Ticket guild not found.');
        return;
      }
      
      // Try to fetch the channel from Discord API to verify it still exists
      let ticketChannel;
      try {
        ticketChannel = await ticketGuild.channels.fetch(ticketInfo.channel, { force: true });
      } catch (error) {
        // Channel doesn't exist anymore
        ticketChannel = null;
      }
      
      // Check if ticket channel still exists
      if (!ticketChannel) {
        activeTickets.delete(message.author.id);
        await saveTickets();
        
        // Send notification about deleted ticket
        const deletedTicketEmbed = new MessageEmbed()
          .setColor('#e74c3c')
          .setTitle('Ticket Deleted')
          .setDescription('Apologies we detected your ticket may have gotten manually deleted somehow, if you got this error just type again to officially open a ticket.');
        
        await message.author.send({ embeds: [deletedTicketEmbed] }).catch(console.error);
        return;
      }
      
      if (ticketChannel) {
        if (ticketInfo.closed) {
          await promptNewTicket(message, guild);
        } else {
          // Increment the message count
          ticketInfo.messageCount = (ticketInfo.messageCount || 0) + 1;
          // Determine the title for user's DM and ticket channel
          let userDMTitle = ticketInfo.messageCount === 1 ? 'Message Sent' : 'Message Sent';
          let ticketChannelTitle = ticketInfo.messageCount === 0 ? 'Message Received' : 'Message Received';
          // Create embed for user's DM
          const userEmbed = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle(userDMTitle)
            .setDescription(message.content)
            .setFooter({
              text: `User: ${message.author.tag}`,
              iconURL: message.author.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp(message.createdAt);
          // Create embed for ticket channel
          const ticketEmbed = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle(ticketChannelTitle)
            .setDescription(message.content)
            .setFooter({
              text: `User: ${message.author.tag}`,
              iconURL: message.author.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp(message.createdAt);

          if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            userEmbed.setImage(attachment.url);
            ticketEmbed.setImage(attachment.url);
          } else if (message.embeds.length > 0 && message.embeds[0].type === 'gifv') {
            userEmbed.setImage(message.embeds[0].thumbnail.url);
            ticketEmbed.setImage(message.embeds[0].thumbnail.url);
          } else if (message.content.match(/\.(gif|jpe?g|png|mp4|webm)$/i)) {
            userEmbed.setImage(message.content);
            ticketEmbed.setImage(message.content);
          }

          await ticketChannel.send({ embeds: [ticketEmbed] }).catch(console.error);
          await message.author.send({ embeds: [userEmbed] }).catch(console.error);

          // Update tags: Only change tags if ticket is claimed
          if (ticketChannel.isThread() && ticketInfo.claimedBy) {
            const parentChannel = ticketChannel.parent;
            if (parentChannel && parentChannel.type === 'GUILD_FORUM') {
              const waitingForUserTagId = '1469809601464504332';
              const waitingForStaffTagId = '1469833317686841355';
              try {
                const currentTags = ticketChannel.appliedTags || [];
                const newTags = currentTags.filter(tag => tag !== waitingForUserTagId);
                if (!newTags.includes(waitingForStaffTagId)) {
                  newTags.push(waitingForStaffTagId);
                }
                await ticketChannel.setAppliedTags(newTags);
              } catch (error) {
                console.error('Error updating tags after user message:', error);
              }
            }
          }

          // Check if user wants to close the ticket
          const closeKeywords = ['close', 'close ticket', 'close this', 'resolved', 'done', 'finished'];
          const messageContentLower = message.content.toLowerCase().trim();
          
          if (closeKeywords.some(keyword => messageContentLower === keyword || messageContentLower === keyword + '!')) {
            // User wants to close the ticket
            try {
              await handleCloseTicketByUser(ticketChannel, message.author, guild, ticketInfo);
            } catch (error) {
              console.error('Error closing ticket by user:', error);
            }
          }
        }
      } else {
        console.error('Ticket channel not found.');
      }
    } else {
      await promptNewTicket(message, guild);
    }
  }
  
  // Handle staff messages in ticket channels
  else if (message.guild && guildIds.includes(message.guild.id)) {
    const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.channel === message.channel.id);
    
    if (ticketInfo && !ticketInfo.closed) {
      // Check if the message author is a staff member
      const member = message.member;
      if (member && (member.roles.cache.has(staffRoleID) || member.roles.cache.has(additionalRoleID))) {
        try {
          const user = await client.users.fetch(ticketInfo.user);
          
          let staffTitle = "Staff";
          let staffColor = '#ff0000';
          for (const [roleId, title] of Object.entries(staffRoles)) {
            if (member.roles.cache.has(roleId)) {
              staffTitle = title;
              staffColor = member.displayHexColor;
              break;
            }
          }

          // Create embed for user's DM
          const userEmbed = new MessageEmbed()
            .setColor(staffColor !== '#000000' ? staffColor : '#ff0000')
            .setTitle('Message Received')
            .setDescription(message.content)
            .setAuthor({ name: `${message.author.tag} • ${staffTitle}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
            .setFooter({ text: `${message.guild.name}`, iconURL: message.guild.iconURL({ dynamic: true }) })
            .setTimestamp();

          // Create embed for ticket channel
          const staffEmbed = new MessageEmbed()
            .setColor(staffColor !== '#000000' ? staffColor : '#ff0000')
            .setTitle('Message Sent')
            .setDescription(message.content)
            .setAuthor({ name: `${message.author.tag} • ${staffTitle}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
            .setFooter({ text: `${message.guild.name}`, iconURL: message.guild.iconURL({ dynamic: true }) })
            .setTimestamp();

          if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            userEmbed.setImage(attachment.url);
            staffEmbed.setImage(attachment.url);
          }

          await user.send({ embeds: [userEmbed] }).catch(console.error);
          await message.channel.send({ embeds: [staffEmbed] }).catch(console.error);
          await message.delete().catch(console.error);
          
          // Update tags: Keep Claimed, Remove "Waiting for Staff", Add "Waiting for User"
          if (message.channel.isThread()) {
            const parentChannel = message.channel.parent;
            if (parentChannel && parentChannel.type === 'GUILD_FORUM') {
              const waitingForStaffTagId = '1469833317686841355';
              const waitingForUserTagId = '1469809601464504332';
              try {
                const currentTags = message.channel.appliedTags || [];
                const newTags = currentTags.filter(tag => tag !== waitingForStaffTagId);
                if (!newTags.includes(waitingForUserTagId)) {
                  newTags.push(waitingForUserTagId);
                }
                await message.channel.setAppliedTags(newTags);
              } catch (error) {
                console.error('Error updating tags after staff message:', error);
              }
            }
          }
        } catch (error) {
          console.error('Error handling staff message:', error);
        }
      }
    }
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  // Ignore bot messages
  if (newMessage.author.bot) return;
  
  // Ignore if content didn't change
  if (oldMessage.content === newMessage.content) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.error('Guild not found.');
    return;
  }

  // Handle user DM message edits
  if (newMessage.channel.type === 'DM') {
    const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.user === newMessage.author.id);
    if (!ticketInfo || ticketInfo.closed) return;

    const ticketChannel = guild.channels.cache.get(ticketInfo.channel);
    if (!ticketChannel) return;

    try {
      // Fetch recent messages from the ticket channel to find the corresponding message
      const ticketMessages = await ticketChannel.messages.fetch({ limit: 50 });
      
      // Find the message that matches the old content
      const ticketMessageToEdit = ticketMessages.find(msg => {
        if (!msg.embeds || msg.embeds.length === 0) return false;
        const embed = msg.embeds[0];
        
        // Check if it's a user message (green color) and matches the old content
        return embed.color === 65280 && // #00ff00 in decimal
               embed.description === oldMessage.content &&
               embed.footer?.text === `User: ${newMessage.author.tag}`;
      });

      if (ticketMessageToEdit) {
        // Update the embed in the ticket channel
        const updatedTicketEmbed = new MessageEmbed()
          .setColor('#00ff00')
          .setTitle('Message Received')
          .setDescription(newMessage.content)
          .setFooter({
            text: `User: ${newMessage.author.tag}`,
            iconURL: newMessage.author.displayAvatarURL({ dynamic: true })
          })
          .setTimestamp(newMessage.createdAt);

        // Preserve image if it exists
        if (ticketMessageToEdit.embeds[0].image) {
          updatedTicketEmbed.setImage(ticketMessageToEdit.embeds[0].image.url);
        }

        await ticketMessageToEdit.edit({ embeds: [updatedTicketEmbed] });
      }

      // Also update the user's DM message
      const dmMessages = await newMessage.channel.messages.fetch({ limit: 50 });
      
      // Find the bot's response message that matches the old content
      const dmMessageToEdit = dmMessages.find(msg => {
        if (msg.author.id !== client.user.id) return false;
        if (!msg.embeds || msg.embeds.length === 0) return false;
        const embed = msg.embeds[0];
        
        // Check if it's the "Message Sent" embed with matching content
        return embed.color === 65280 && // #00ff00 in decimal
               embed.title === 'Message Sent' &&
               embed.description === oldMessage.content &&
               embed.footer?.text === `User: ${newMessage.author.tag}`;
      });

      if (dmMessageToEdit) {
        // Update the embed in the user's DM
        const updatedDMEmbed = new MessageEmbed()
          .setColor('#00ff00')
          .setTitle('Message Sent')
          .setDescription(newMessage.content)
          .setFooter({
            text: `User: ${newMessage.author.tag}`,
            iconURL: newMessage.author.displayAvatarURL({ dynamic: true })
          })
          .setTimestamp(newMessage.createdAt);

        // Preserve image if it exists
        if (dmMessageToEdit.embeds[0].image) {
          updatedDMEmbed.setImage(dmMessageToEdit.embeds[0].image.url);
        }

        await dmMessageToEdit.edit({ embeds: [updatedDMEmbed] });
      }
    } catch (error) {
      console.error('Error handling user message edit:', error);
    }
  }
  
  // Handle staff message edits in ticket channels
  else if (newMessage.guild && newMessage.guild.id === guildId) {
    const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.channel === newMessage.channel.id);
    
    if (ticketInfo && !ticketInfo.closed) {
      const member = newMessage.member;
      if (member && (member.roles.cache.has(staffRoleID) || member.roles.cache.has(additionalRoleID))) {
        try {
          const user = await client.users.fetch(ticketInfo.user);
          
          let staffTitle = "Staff";
          let staffColor = '#ff0000';
          for (const [roleId, title] of Object.entries(staffRoles)) {
            if (member.roles.cache.has(roleId)) {
              staffTitle = title;
              staffColor = member.displayHexColor;
              break;
            }
          }

          // Find the staff message embed in the ticket channel
          const ticketMessages = await newMessage.channel.messages.fetch({ limit: 50 });
          const ticketMessageToEdit = ticketMessages.find(msg => {
            if (!msg.embeds || msg.embeds.length === 0) return false;
            const embed = msg.embeds[0];
            
            return embed.title === 'Message Sent' &&
                   embed.description === oldMessage.content &&
                   embed.author?.name?.includes(newMessage.author.tag);
          });

          if (ticketMessageToEdit) {
            // Update the embed in the ticket channel
            const updatedStaffEmbed = new MessageEmbed()
              .setColor(staffColor !== '#000000' ? staffColor : '#ff0000')
              .setTitle('Message Sent')
              .setDescription(newMessage.content)
              .setAuthor({ name: `${newMessage.author.tag} • ${staffTitle}`, iconURL: newMessage.author.displayAvatarURL({ dynamic: true }) })
              .setFooter({ text: `${newMessage.guild.name}`, iconURL: newMessage.guild.iconURL({ dynamic: true }) })
              .setTimestamp();

            if (ticketMessageToEdit.embeds[0].image) {
              updatedStaffEmbed.setImage(ticketMessageToEdit.embeds[0].image.url);
            }

            await ticketMessageToEdit.edit({ embeds: [updatedStaffEmbed] });
          }

          // Find and update the user's DM message
          const dmChannel = await user.createDM();
          const dmMessages = await dmChannel.messages.fetch({ limit: 50 });
          
          const dmMessageToEdit = dmMessages.find(msg => {
            if (msg.author.id !== client.user.id) return false;
            if (!msg.embeds || msg.embeds.length === 0) return false;
            const embed = msg.embeds[0];
            
            return embed.title === 'Message Received' &&
                   embed.description === oldMessage.content &&
                   embed.author?.name?.includes(newMessage.author.tag);
          });

          if (dmMessageToEdit) {
            // Update the embed in the user's DM
            const updatedUserEmbed = new MessageEmbed()
              .setColor(staffColor !== '#000000' ? staffColor : '#ff0000')
              .setTitle('Message Received')
              .setDescription(newMessage.content)
              .setAuthor({ name: `${newMessage.author.tag} • ${staffTitle}`, iconURL: newMessage.author.displayAvatarURL({ dynamic: true }) })
              .setFooter({ text: `${newMessage.guild.name}`, iconURL: newMessage.guild.iconURL({ dynamic: true }) })
              .setTimestamp();

            if (dmMessageToEdit.embeds[0].image) {
              updatedUserEmbed.setImage(dmMessageToEdit.embeds[0].image.url);
            }

            await dmMessageToEdit.edit({ embeds: [updatedUserEmbed] });
          }
        } catch (error) {
          console.error('Error handling staff message edit:', error);
        }
      }
    }
  }
});

client.on('channelDelete', async (channel) => {
  console.log(`Channel deleted: ${channel.id} (${channel.name})`);
  
  // Check if the deleted channel was a ticket
  const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.channel === channel.id);
  
  if (ticketInfo) {
    console.log(`Ticket channel ${channel.id} was manually deleted. Removing from active tickets.`);
    activeTickets.delete(ticketInfo.user);
    await saveTickets();
    console.log(`Ticket removed and saved. Remaining tickets: ${activeTickets.size}`);
    
    // Optionally notify the user
    try {
      const user = await client.users.fetch(ticketInfo.user);
      const closedEmbed = new MessageEmbed()
        .setColor('#e74c3c')
        .setTitle('Ticket Closed')
        .setDescription('Your ticket has been closed. If you require further assistance, please reach out to <@1453758099977539706> again and open up a new ticket.')
        .setTimestamp();
      
      await user.send({ embeds: [closedEmbed] }).catch(console.error);
      console.log(`Notification sent to user ${ticketInfo.user}`);
    } catch (error) {
      console.error('Error notifying user of manual ticket deletion:', error);
    }
  } else {
    console.log(`Deleted channel ${channel.id} was not a ticket.`);
  }
});

client.on('messageDelete', async (message) => {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  // Handle staff EMBED message deletions in ticket channels
  if (message.guild && message.guild.id === guildId) {
    const ticketInfo = Array.from(activeTickets.values()).find(ticket => ticket.channel === message.channel.id);
    
    if (ticketInfo && !ticketInfo.closed) {
      // Check if the deleted message was a bot's embed message
      if (message.author && message.author.id === client.user.id && message.embeds && message.embeds.length > 0) {
        const embed = message.embeds[0];
        
        // Check if it's a staff "Message Sent" embed
        if (embed.title === 'Message Sent' && embed.author?.name) {
          try {
            const user = await client.users.fetch(ticketInfo.user);
            
            // Find and delete the corresponding message in the user's DM
            const dmChannel = await user.createDM();
            const dmMessages = await dmChannel.messages.fetch({ limit: 50 });
            
            const dmMessageToDelete = dmMessages.find(msg => {
              if (msg.author.id !== client.user.id) return false;
              if (!msg.embeds || msg.embeds.length === 0) return false;
              const dmEmbed = msg.embeds[0];
              
              return dmEmbed.title === 'Message Received' &&
                     dmEmbed.description === embed.description &&
                     dmEmbed.author?.name === embed.author.name;
            });

            if (dmMessageToDelete) {
              await dmMessageToDelete.delete().catch(console.error);
            }
          } catch (error) {
            console.error('Error handling staff embed deletion:', error);
          }
        }
      }
    }
  }
});

async function promptNewTicket(message, guild) {
  try {
    // First, show category selection dropdown with a unique ID to avoid conflicts
    const uniqueId = `ticket_category_select_${Date.now()}`;
    
    const categorySelectEmbed = new MessageEmbed()
      .setColor('#3498db')
      .setTitle('Select Ticket Category')
      .setDescription('Please select the category that best describes your inquiry.');

    const categorySelect = new MessageActionRow()
      .addComponents(
        new MessageSelectMenu()
          .setCustomId(uniqueId)
          .setPlaceholder('Select Ticket Category')
          .addOptions([
            {
              label: 'Support',
              value: 'support',
              description: "General support - we're here to help you!",
              emoji: '❓'
            }
          ])
      );

    const categoryMessage = await message.author.send({ embeds: [categorySelectEmbed], components: [categorySelect] });

    // Wait for category selection
    const categoryFilter = (i) => i.customId === uniqueId && i.user.id === message.author.id;
    const categoryCollected = await categoryMessage.awaitMessageComponent({ filter: categoryFilter, time: 60000 }).catch(() => null);

    if (!categoryCollected) {
      const timeoutEmbed = new MessageEmbed()
        .setColor('#FF0000')
        .setTitle('Request Timeout')
        .setDescription('You did not select a category in time. Please try again if you need assistance.');
      await categoryMessage.edit({ embeds: [timeoutEmbed], components: [] });
      return;
    }

    const selectedCategory = categoryCollected.values[0];
    const categoryLabels = {
      'support': 'Support'
    };

    await categoryCollected.deferUpdate();
    await categoryMessage.delete();

    // Show informational message with reactions
    const infoEmbed = new MessageEmbed()
      .setColor('#ed4245')
      .setTitle('⚠️ Make sure to read below carefully first! ⚠️')
      .setDescription(
        '**__Please describe your reason for contacting staff:__**\n' +
        '> Let us know what you need help with, and provide any relevant details or evidence.\n\n' +
        '*If you understood the instructions and want to proceed, react with* ✅ *below.*\n' +
        '*If you want to cancel, react with* ❌ *below.*\n\n' +
        '*The staff will reply to you as soon as they can.*'
      );

    const confirmButtons = new MessageActionRow()
      .addComponents(
        new MessageButton()
          .setCustomId('confirm_ticket')
          .setStyle('SECONDARY')
          .setEmoji('✅'),
        new MessageButton()
          .setCustomId('cancel_ticket')
          .setStyle('SECONDARY')
          .setEmoji('❌')
      );

    const confirmationMessage = await message.author.send({ embeds: [infoEmbed], components: [confirmButtons] });

    const filter = (i) => ['confirm_ticket', 'cancel_ticket'].includes(i.customId) && i.user.id === message.author.id;
    const collected = await confirmationMessage.awaitMessageComponent({ filter, time: 60000 }).catch(() => null);

    if (collected) {
      if (collected.customId === 'confirm_ticket') {
        await collected.deferUpdate();
        await confirmationMessage.delete();
        try {
          const username = message.author.username.replace(/[^a-zA-Z0-9]/g, '');
          
          // Get the category-specific forum channel to create post in
          const targetChannelID = categoryChannels[selectedCategory];
          const parentChannel = await client.channels.fetch(targetChannelID).catch(err => {
            console.error('Failed to fetch category channel:', err);
            return null;
          });
          
          if (!parentChannel) {
            throw new Error(`Category channel not found. Make sure the channel ID "${targetChannelID}" is correct and the bot has access to it.`);
          }
          
          const member = await guild.members.fetch(message.author.id);
          const roleCount = member.roles.cache.size - 1;
          
          // Show role count instead of role mentions to avoid unknown-role issues across servers
          const roleDisplay = roleCount > 0 ? `${roleCount} role${roleCount !== 1 ? 's' : ''}` : 'No roles';

          const ticketEmbed = new MessageEmbed()
            .setColor('#3498db')
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
            .setDescription(`<@${message.author.id}>`)
            .addFields(
              { name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: true },
              { name: 'Registered', value: `<t:${Math.floor(message.author.createdTimestamp / 1000)}:F>`, inline: true },
              { name: 'Roles', value: roleDisplay, inline: false }
            )
            .setFooter({ text: `User ID: ${message.author.id}` })
            .setTimestamp();

          const ticketButtons = new MessageActionRow()
            .addComponents(
              new MessageButton()
                .setCustomId('claim_ticket_button')
                .setLabel('Claim Ticket')
                .setStyle('PRIMARY')
                .setEmoji('👤'),
              new MessageButton()
                .setCustomId('close_ticket_button')
                .setLabel('Close')
                .setStyle('DANGER')
                .setEmoji('🔒')
            );

          let ticketChannel;
          
          // Generate a random ticket number
          const ticketNumber = Math.floor(1000 + Math.random() * 9000);
          
          // Handle forum channels differently
          if (parentChannel.type === 'GUILD_FORUM') {
            // Create a forum post with the ticket embed as the starter message
            ticketChannel = await parentChannel.threads.create({
              name: `ticket-${username}-${ticketNumber}`,
              autoArchiveDuration: 10080, // 7 days
              message: {
                embeds: [ticketEmbed],
                components: [ticketButtons]
              },
              reason: `ModMail ticket (${categoryLabels[selectedCategory]}) for ${message.author.tag}`
            });
            
            // Apply the unclaimed tag and waiting for staff tag to the new forum post
            const unclaimedTagId = '1469809498762907810';
            const waitingForStaffTagId = '1469833317686841355';
            try {
              await ticketChannel.setAppliedTags([unclaimedTagId, waitingForStaffTagId]);
            } catch (error) {
              console.error('Error applying tags to new ticket:', error);
            }
          } else if (parentChannel.isText()) {
            // Create a private thread for regular text channels
            ticketChannel = await parentChannel.threads.create({
              name: `ticket-${username}-${ticketNumber}`,
              autoArchiveDuration: 10080, // 7 days
              type: 'GUILD_PRIVATE_THREAD',
              reason: `ModMail ticket (${categoryLabels[selectedCategory]}) for ${message.author.tag}`
            });
            
            // Send embed with buttons for non-forum channels
            await ticketChannel.send({ embeds: [ticketEmbed], components: [ticketButtons] }).catch(console.error);
          } else {
            throw new Error(`Channel found but it's not a text or forum channel (type: ${parentChannel.type})`);
          }

          const greetingEmbed = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle('✅ Ticket Created Successfully')
            .setDescription(
              `Your ticket has been created. A staff member will respond as soon as possible.`
            );

          const userDMEmbed = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle('Message Sent')
            .setDescription(message.content || 'No initial message content.')
            .setFooter({ 
              text: `User: ${message.author.tag}`, 
              iconURL: message.author.displayAvatarURL({ dynamic: true }) 
            })
            .setTimestamp(message.createdAt);

          // Send both embeds to user
          await message.author.send({ embeds: [greetingEmbed] }).catch(console.error);
          await message.author.send({ embeds: [userDMEmbed] }).catch(console.error);

          activeTickets.set(message.author.id, { 
            channel: ticketChannel.id, 
            user: message.author.id, 
            closed: false, 
            messageCount: 0, 
            category: selectedCategory,
            everClaimed: false,
            guildId: guild.id
          });
          await saveTickets();

          const ticketChannelEmbed = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle('Message Received')
            .setDescription(message.content || 'No initial message content.')
            .setFooter({ 
              text: `User: ${message.author.tag}`, 
              iconURL: message.author.displayAvatarURL({ dynamic: true }) 
            })
            .setTimestamp(message.createdAt);

          if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            ticketChannelEmbed.setImage(attachment.url);
            userDMEmbed.setImage(attachment.url);
          } else if (message.embeds.length > 0 && message.embeds[0].type === 'gifv') {
            ticketChannelEmbed.setImage(message.embeds[0].thumbnail.url);
            userDMEmbed.setImage(message.embeds[0].thumbnail.url);
          } else if (message.content && message.content.match(/\.(gif|jpe?g|png|mp4|webm)$/i)) {
            ticketChannelEmbed.setImage(message.content);
            userDMEmbed.setImage(message.content);
          }

          await ticketChannel.send({ embeds: [ticketChannelEmbed] }).catch(console.error);

          // Thread is already in staff channel, no need for separate notification
        } catch (error) {
          console.error('Error creating ticket thread:', error);
          const errorEmbed = new MessageEmbed()
            .setColor('#ff0000')
            .setDescription('There was an error creating your Mod Mail Ticket. Please contact support.');
          await message.author.send({ embeds: [errorEmbed] }).catch(console.error);
        }
      } else if (collected.customId === 'cancel_ticket') {
        await collected.deferUpdate();
        
        const cancelEmbed = new MessageEmbed()
          .setColor('#FF0000')
          .setDescription('Request cancelled successfully. Please resubmit per the instructions.');
        
        await confirmationMessage.edit({ embeds: [cancelEmbed], components: [] });
        
        setTimeout(() => confirmationMessage.delete(), 10000);
      }
    } else {
      const timeoutEmbed = new MessageEmbed()
        .setColor('#FF0000')
        .setTitle('Request Timeout')
        .setDescription('You did not respond in time. Please try again if you need assistance.');
      await confirmationMessage.edit({ embeds: [timeoutEmbed], components: [] });
    }
  } catch (error) {
    console.error('Error in promptNewTicket:', error);
    await message.author.send('An error occurred while processing your request. Please try again later or contact the server administrators.').catch(console.error);
  }
}

client.login(process.env.TOKEN);
