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
let data;
try {
  data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
} catch {
  data = { activeUnits: [], cadMessageId: null };
}

function saveData() {
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName('set')
    .setDescription('Set a unit on a call')
    .addUserOption(opt =>
      opt.setName('user')
         .setDescription('The user to set')
         .setRequired(true))
    .addStringOption(opt =>
      opt.setName('status')
         .setDescription('Status of the unit')
         .setRequired(true))
    .addStringOption(opt =>
      opt.setName('calltype')
         .setDescription('Type of call')
         .setRequired(true))
    .addStringOption(opt =>
      opt.setName('location')
         .setDescription('Location of the unit')
         .setRequired(true)),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear/update a unit')
    .addUserOption(opt =>
      opt.setName('user')
         .setDescription('The user to clear')
         .setRequired(true))
    .addStringOption(opt =>
      opt.setName('status')
         .setDescription('New status')
         .setRequired(true))
    .addStringOption(opt =>
      opt.setName('location')
         .setDescription('New location')
         .setRequired(true)),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset CAD system')
    .addStringOption(opt =>
      opt.setName('confirm')
         .setDescription('Type YES to confirm')
         .setRequired(true)),

  new SlashCommandBuilder()
    .setName('addunit')
    .setDescription('Add a person/unit to the CAD embed')
    .addUserOption(opt =>
      opt.setName('user')
         .setDescription('The user to add')
         .setRequired(true))
    .addStringOption(opt =>
      opt.setName('status')
         .setDescription('Status of the unit')
         .setRequired(true))
    .addStringOption(opt =>
      opt.setName('calltype')
         .setDescription('Call type')
         .setRequired(false))
    .addStringOption(opt =>
      opt.setName('location')
         .setDescription('Location of the unit')
         .setRequired(true))
].map(cmd => cmd.toJSON());

// ===== REGISTER =====
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Commands registered successfully');
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
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

  if (!data.activeUnits || data.activeUnits.length === 0) {
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
  if (!channel) return;

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
  await updateCAD(client);
});

// ===== COMMAND HANDLER =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!isDispatcher(interaction.member)) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }

  const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);

  const user = interaction.options.getUser('user');
  const status = interaction.options.getString('status');
  const callType = interaction.options.getString('calltype');
  const location = interaction.options.getString('location');

  switch (interaction.commandName) {
    case 'set':
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
      return interaction.reply(`✅ ${user.tag} updated.`);

    case 'clear':
      data.activeUnits = data.activeUnits.map(u => {
        if (u.id === user.id) {
          return { ...u, status, location, callType: null };
        }
        return u;
      });
      saveData();
      await updateCAD(client);
      return interaction.reply(`🧹 ${user.tag} cleared.`);

    case 'reset':
      const confirm = interaction.options.getString('confirm');
      if (confirm !== 'YES') {
        return interaction.reply({ content: '❌ Type YES to confirm.', ephemeral: true });
      }
      data.activeUnits = [];
      data.cadMessageId = null;
      saveData();
      await updateCAD(client);
      if (logChannel) logChannel.send(`⚠️ CAD reset by ${interaction.user.tag}`);
      return interaction.reply('🚨 CAD reset.');

    case 'addunit':
      if (data.activeUnits.find(u => u.id === user.id)) {
        return interaction.reply({ content: '❌ Unit already exists.', ephemeral: true });
      }
      data.activeUnits.push({
        id: user.id,
        user: user.tag,
        status,
        callType: callType || 'N/A',
        location
      });
      saveData();
      await updateCAD(client);
      return interaction.reply(`✅ ${user.tag} added to CAD.`);
  }
});

client.login(process.env.TOKEN);
