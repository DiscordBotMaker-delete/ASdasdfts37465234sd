const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} = require('discord.js');

const fs = require('fs');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== LOAD DATA =====
let data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));

function saveData() {
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName('set')
    .setDescription('Set a unit on a call')
    .addUserOption(opt => opt.setName('user').setRequired(true))
    .addStringOption(opt => opt.setName('status').setRequired(true))
    .addStringOption(opt => opt.setName('calltype').setRequired(true))
    .addStringOption(opt => opt.setName('location').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear/update a unit')
    .addUserOption(opt => opt.setName('user').setRequired(true))
    .addStringOption(opt => opt.setName('status').setRequired(true))
    .addStringOption(opt => opt.setName('location').setRequired(true)),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset CAD system')
    .addStringOption(opt =>
      opt.setName('confirm')
        .setDescription('Type YES')
        .setRequired(true))
].map(cmd => cmd.toJSON());

// ===== REGISTER =====
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log('Commands registered');
})();

// ===== PERMISSION CHECK =====
function isDispatcher(member) {
  return member.roles.cache.has(process.env.DISPATCHER_ROLE_ID);
}

// ===== BUILD EMBED =====
function buildEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🚔 CAD System')
    .setColor(0x00AEFF)
    .setFooter({ text: 'Live Dispatch System' })
    .setTimestamp();

  if (data.activeUnits.length === 0) {
    embed.setDescription('No active units.');
  } else {
    let desc = '';

    data.activeUnits.forEach((u, i) => {
      desc += `**${i + 1}. ${u.user}**\n`;
      desc += `> Status: ${u.status}\n`;
      desc += `> Call: ${u.callType || 'N/A'}\n`;
      desc += `> Location: ${u.location}\n\n`;
    });

    embed.setDescription(desc);
  }

  return embed;
}

// ===== UPDATE CAD MESSAGE =====
async function updateCAD(client) {
  const channel = await client.channels.fetch(process.env.CAD_CHANNEL_ID);

  if (!data.cadMessageId) {
    const msg = await channel.send({ embeds: [buildEmbed()] });
    data.cadMessageId = msg.id;
    saveData();
  } else {
    try {
      const msg = await channel.messages.fetch(data.cadMessageId);
      await msg.edit({ embeds: [buildEmbed()] });
    } catch {
      const msg = await channel.send({ embeds: [buildEmbed()] });
      data.cadMessageId = msg.id;
      saveData();
    }
  }
}

// ===== READY =====
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await updateCAD(client); // auto-load CAD on startup
});

// ===== COMMAND HANDLER =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!isDispatcher(interaction.member)) {
    return interaction.reply({
      content: '❌ You do not have permission.',
      ephemeral: true
    });
  }

  const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);

  // ===== SET =====
  if (interaction.commandName === 'set') {
    const user = interaction.options.getUser('user');
    const status = interaction.options.getString('status');
    const callType = interaction.options.getString('calltype');
    const location = interaction.options.getString('location');

    data.activeUnits = data.activeUnits.filter(u => u.id !== user.id);

    data.activeUnits.push({
      id: user.id,
      user: user.tag,
      status,
      callType,
      location
    });

    saveData();
    await updateCAD(client);

    await interaction.reply(`✅ ${user.tag} updated.`);
  }

  // ===== CLEAR =====
  if (interaction.commandName === 'clear') {
    const user = interaction.options.getUser('user');
    const status = interaction.options.getString('status');
    const location = interaction.options.getString('location');

    data.activeUnits = data.activeUnits.map(u => {
      if (u.id === user.id) {
        return { ...u, status, location, callType: null };
      }
      return u;
    });

    saveData();
    await updateCAD(client);

    await interaction.reply(`🧹 ${user.tag} cleared.`);
  }

  // ===== RESET =====
  if (interaction.commandName === 'reset') {
    const confirm = interaction.options.getString('confirm');

    if (confirm !== 'YES') {
      return interaction.reply({
        content: '❌ Type YES to confirm.',
        ephemeral: true
      });
    }

    data.activeUnits = [];
    data.cadMessageId = null;

    saveData();
    await updateCAD(client);

    if (logChannel) {
      logChannel.send(`⚠️ CAD reset by ${interaction.user.tag}`);
    }

    await interaction.reply('🚨 CAD reset.');
  }
});

client.login(process.env.TOKEN);
