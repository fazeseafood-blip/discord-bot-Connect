const fs = require('fs').promises;
const path = require('path');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');

const STATS_FILE = path.join(__dirname, 'staffStats.json');

// Load staff stats from file
async function loadStats() {
  try {
    const data = await fs.readFile(STATS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    console.error('Error loading staff stats:', error);
    return {};
  }
}

// Save staff stats to file
async function saveStats(stats) {
  try {
    await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (error) {
    console.error('Error saving staff stats:', error);
  }
}

// Increment claim count for a staff member
async function incrementClaim(userId) {
  const stats = await loadStats();
  if (!stats[userId]) {
    stats[userId] = { claimed: 0, closed: 0 };
  }
  stats[userId].claimed++;
  await saveStats(stats);
}

// Increment close count for a staff member
async function incrementClose(userId) {
  const stats = await loadStats();
  if (!stats[userId]) {
    stats[userId] = { claimed: 0, closed: 0 };
  }
  stats[userId].closed++;
  await saveStats(stats);
}

// Get leaderboard data filtered by time period
async function getLeaderboard(duration = 'all') {
  const stats = await loadStats();
  
  // For now, we'll implement "all time" - you can add date filtering later
  const leaderboardData = [];
  
  for (const [userId, data] of Object.entries(stats)) {
    leaderboardData.push({
      userId,
      claimed: data.claimed || 0,
      closed: data.closed || 0,
      total: (data.claimed || 0) + (data.closed || 0)
    });
  }
  
  // Sort by total (claimed + closed) descending
  leaderboardData.sort((a, b) => b.total - a.total);
  
  return leaderboardData;
}

// Generate leaderboard embed
async function generateLeaderboardEmbed(client, guild, page = 1, duration = 'all') {
  const leaderboardData = await getLeaderboard(duration);
  const itemsPerPage = 10;
  const totalPages = Math.ceil(leaderboardData.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pageData = leaderboardData.slice(startIndex, endIndex);
  
  let durationLabel = 'All Time';
  if (duration === 'today') durationLabel = 'Today';
  else if (duration === 'month') durationLabel = 'This Month';
  else if (duration === 'lastmonth') durationLabel = 'Last Month';
  
  const embed = new MessageEmbed()
    .setColor('#5865f2')
    .setTitle(`📊 General Ticket Leaderboard - ${durationLabel}`)
    .setTimestamp();
  
  let description = '';
  const medals = ['🥇', '🥈', '🥉'];
  
  for (let i = 0; i < pageData.length; i++) {
    const rank = startIndex + i + 1;
    const data = pageData[i];
    
    const medal = rank <= 3 ? medals[rank - 1] : `${rank}.`;
    
    description += `${medal} <@${data.userId}>\n`;
    description += `Claimed: ${data.claimed} | Closed: ${data.closed}\n\n`;
  }
  
  embed.setDescription(description || 'No data available.');
  embed.setFooter({ text: `Page ${page}/${totalPages} • Total Users: ${leaderboardData.length}` });
  
  return { embed, totalPages };
}

// Register leaderboard command
async function registerLeaderboardCommand(client) {
  const guildId = process.env.GUILD_ID || "1453758727479099511";
  
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error('Guild not found for leaderboard command.');
      return;
    }

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

    await guild.commands.set(commands);
    console.log('Leaderboard command registered successfully.');
  } catch (error) {
    console.error('Failed to register leaderboard command:', error);
  }
}

// Handle leaderboard command interaction
async function handleLeaderboardCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  
  if (subcommand === 'general') {
    const duration = interaction.options.getString('duration') || 'all';
    const page = 1;
    
    const { embed, totalPages } = await generateLeaderboardEmbed(
      interaction.client,
      interaction.guild,
      page,
      duration
    );
    
    const buttons = new MessageActionRow();
    
    buttons.addComponents(
      new MessageButton()
        .setCustomId(`leaderboard_prev_${page}_${duration}`)
        .setLabel('◀ Previous')
        .setStyle('PRIMARY')
        .setDisabled(page === 1),
      new MessageButton()
        .setCustomId(`leaderboard_next_${page}_${duration}`)
        .setLabel('Next ▶')
        .setStyle('PRIMARY')
        .setDisabled(page >= totalPages)
    );
    
    await interaction.editReply({ embeds: [embed], components: [buttons] });
  }
}

// Handle leaderboard button interactions
async function handleLeaderboardButton(interaction) {
  const [action, direction, currentPage, duration] = interaction.customId.split('_').slice(1);
  
  let page = parseInt(currentPage);
  if (direction === 'next') page++;
  else if (direction === 'prev') page--;
  
  const { embed, totalPages } = await generateLeaderboardEmbed(
    interaction.client,
    interaction.guild,
    page,
    duration
  );
  
  const buttons = new MessageActionRow();
  
  buttons.addComponents(
    new MessageButton()
      .setCustomId(`leaderboard_prev_${page}_${duration}`)
      .setLabel('◀ Previous')
      .setStyle('PRIMARY')
      .setDisabled(page === 1),
    new MessageButton()
      .setCustomId(`leaderboard_next_${page}_${duration}`)
      .setLabel('Next ▶')
      .setStyle('PRIMARY')
      .setDisabled(page >= totalPages)
  );
  
  await interaction.update({ embeds: [embed], components: [buttons] });
}

module.exports = {
  incrementClaim,
  incrementClose,
  registerLeaderboardCommand,
  handleLeaderboardCommand,
  handleLeaderboardButton
};
