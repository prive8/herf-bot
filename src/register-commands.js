import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, ChannelType } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID in .env');
  process.exit(1);
}

const meetupVote = new SlashCommandBuilder()
  .setName('meetup_vote')
  .setDescription('Create a time-vote poll for a cigar meetup')
  .addStringOption(o => o.setName('title').setDescription('Poll title').setRequired(true))
  .addStringOption(o => o.setName('option1').setDescription('Time option 1').setRequired(true))
  .addStringOption(o => o.setName('option2').setDescription('Time option 2').setRequired(true))
  .addStringOption(o => o.setName('cigar').setDescription('Cigar for this meetup').setRequired(false))
  .addStringOption(o => o.setName('option3').setDescription('Time option 3').setRequired(false))
  .addStringOption(o => o.setName('option4').setDescription('Time option 4').setRequired(false))
  .addStringOption(o => o.setName('option5').setDescription('Time option 5').setRequired(false))
  .addChannelOption(o =>
    o
      .setName('lounge_channel')
      .setDescription('Text channel for thread/event (defaults to current channel)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  )
  .addBooleanOption(o =>
    o
      .setName('create_event')
      .setDescription('Create a Discord scheduled event when poll closes')
      .setRequired(false)
  );

const bookmarkSubmit = new SlashCommandBuilder()
  .setName('bookmark_submit')
  .setDescription('Submit a cigar site bookmark for review')
  .addStringOption(o => o.setName('url').setDescription('Bookmark URL').setRequired(true))
  .addStringOption(o => o.setName('title').setDescription('Short title/label').setRequired(false))
  .addStringOption(o => o.setName('category').setDescription('Category (Top Sites / Small Batches / Sub Boxes)').setRequired(false))
  .addStringOption(o => o.setName('note').setDescription('Optional context').setRequired(false));

const bookmarkApprove = new SlashCommandBuilder()
  .setName('bookmark_approve')
  .setDescription('Approve a pending bookmark and publish to a channel')
  .addStringOption(o => o.setName('submission_id').setDescription('Submission ID from queue message').setRequired(true))
  .addChannelOption(o =>
    o
      .setName('publish_channel')
      .setDescription('Channel to publish approved bookmark (optional)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  );

const bookmarkSeedPublish = new SlashCommandBuilder()
  .setName('bookmark_seed_publish')
  .setDescription('Publish seed bookmarks from data/bookmarks-seed.json into a channel')
  .addIntegerOption(o =>
    o
      .setName('limit')
      .setDescription('How many seed bookmarks to publish this run (default 10)')
      .setRequired(false)
  )
  .addChannelOption(o =>
    o
      .setName('publish_channel')
      .setDescription('Channel to publish seed bookmarks (optional)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  );

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: [
      meetupVote.toJSON(),
      bookmarkSubmit.toJSON(),
      bookmarkApprove.toJSON(),
      bookmarkSeedPublish.toJSON(),
    ],
  });
  console.log('Registered /meetup_vote, /bookmark_submit, /bookmark_approve, /bookmark_seed_publish commands.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
