import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// pollId => { title, cigar, options, votes, ownerId, closed, loungeChannelId, createEvent }
const polls = new Map();
// submissionId => { id, url, title, category, note, submittedBy, submittedAt, status, sourceChannelId }
const bookmarkSubmissions = new Map();

function getCounts(poll) {
  const counts = Array.from({ length: poll.options.length }, () => 0);
  for (const idx of poll.votes.values()) counts[idx] += 1;
  return counts;
}

function getLeaders(counts) {
  const maxVotes = Math.max(...counts, 0);
  if (maxVotes === 0) return [];
  return counts.map((v, i) => ({ v, i })).filter((x) => x.v === maxVotes).map((x) => x.i);
}

function winnerSummary(poll) {
  const counts = getCounts(poll);
  const leaders = getLeaders(counts);
  if (leaders.length === 0) return { text: 'No votes were cast.', winners: [] };
  if (leaders.length === 1) {
    const i = leaders[0];
    return { text: `🏆 Winner: **${poll.options[i]}** with **${counts[i]}** vote(s).`, winners: [poll.options[i]] };
  }
  const tied = leaders.map((i) => `**${poll.options[i]}** (${counts[i]})`).join(', ');
  return { text: `🤝 Tie: ${tied}`, winners: leaders.map((i) => poll.options[i]) };
}

function buildPollText(poll, pollId) {
  const counts = getCounts(poll);
  const leaders = getLeaders(counts);

  const lines = poll.options.map((opt, i) => {
    const isLeader = leaders.includes(i);
    const marker = isLeader ? '🟨' : '⬜';
    const crown = isLeader ? ' 👑' : '';
    return `${marker} **Option ${i + 1}: ${opt}**\n   └ Votes: **${counts[i]}**${crown}`;
  });

  const cigarLine = poll.cigar ? `\n### 🚬 Cigar\n**${poll.cigar}**` : '';
  const status = poll.closed ? `\n\n✅ **POLL CLOSED**\n${winnerSummary(poll).text}` : '\n\n_One vote per person. Vote again to change your vote._';

  return [
    '# 🗳️ CIGAR MEETUP VOTE',
    '',
    '## 📌 Title',
    `**${poll.title}**`,
    cigarLine,
    '',
    '## ⏰ Time Options',
    lines.join('\n\n'),
    '',
    `Poll ID: \`${pollId}\``,
    status,
  ].join('\n');
}

function buildButtons(pollId, optionCount, closed = false) {
  const voteRow = new ActionRowBuilder();
  for (let i = 0; i < optionCount; i += 1) {
    voteRow.addComponents(
      new ButtonBuilder().setCustomId(`vote:${pollId}:${i}`).setLabel(`Vote ${i + 1}`).setStyle(ButtonStyle.Primary).setDisabled(closed)
    );
  }

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`close:${pollId}`).setLabel('Close Poll').setStyle(ButtonStyle.Danger).setDisabled(closed)
  );

  return [voteRow, controlRow];
}

function sanitizeThreadName(name) {
  return name.slice(0, 95);
}

function asValidUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function pickBookmarksChannel(guild, explicitChannel = null) {
  if (explicitChannel && explicitChannel.type === ChannelType.GuildText) return explicitChannel;

  const configured = (process.env.BOOKMARKS_CHANNEL_NAME || 'bookmarks').toLowerCase();
  const normalizedConfigured = configured.replace(/[^\p{L}\p{N}]+/gu, '');

  const byExactName = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name.toLowerCase() === configured
  );
  if (byExactName) return byExactName;

  const byNormalized = guild.channels.cache.find((c) => {
    if (c.type !== ChannelType.GuildText) return false;
    const normalizedName = c.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    return normalizedName === normalizedConfigured || normalizedName.includes('bookmarks');
  });

  return byNormalized ?? null;
}

function bookmarkCard(sub, state = 'PENDING') {
  return [
    `# 🔖 Bookmark ${state}`,
    `**ID:** \`${sub.id}\``,
    `**Title:** ${sub.title || 'Untitled'}`,
    `**URL:** ${sub.url}`,
    `**Category:** ${sub.category || 'Uncategorized'}`,
    sub.note ? `**Note:** ${sub.note}` : null,
    `**Submitted by:** <@${sub.submittedBy}>`,
    `**Submitted at:** ${new Date(sub.submittedAt).toLocaleString()}`,
  ].filter(Boolean).join('\n');
}

function categoryDescription(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('top')) return 'Trusted go-to source with consistent inventory and service.';
  if (c.includes('small')) return 'Boutique/small-lot source for limited and harder-to-find drops.';
  if (c.includes('sub')) return 'Subscription/club style source for recurring shipments or curated packs.';
  if (c.includes('access')) return 'Accessories shop for cutters, lighters, humidors, and related gear.';
  if (c.includes('pipe')) return 'Pipe and pipe-tobacco oriented source.';
  return 'Curated cigar-related source.';
}

function wikiBookmarkPost(item, meta = {}) {
  const title = item.title || 'Untitled';
  const url = item.url;
  const safeLink = `<${url}>`; // angle brackets suppress Discord embeds
  const category = item.category || 'Uncategorized';
  const description = item.note || categoryDescription(category);

  return [
    '# 🔖 Bookmark Wiki Entry',
    '',
    `## ${title}`,
    `**Description:** ${description}`,
    `**Category:** ${category}`,
    `**Link:** ${safeLink}`,
    '',
    meta.source ? `**Source:** ${meta.source}` : null,
    meta.approvedBy ? `**Approved by:** <@${meta.approvedBy}>` : null,
  ].filter(Boolean).join('\n');
}

function loadSeedBookmarks() {
  const p = path.resolve(process.cwd(), 'data', 'bookmarks-seed.json');
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function createLoungeArtifacts(interaction, pollId, poll) {
  const summary = winnerSummary(poll);
  const winnerLabel = summary.winners.length === 1 ? summary.winners[0] : summary.winners[0] ?? 'TBD';

  const channel = await interaction.guild.channels.fetch(poll.loungeChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.followUp({ content: 'Could not find the target lounge text channel for thread/event.', ephemeral: true });
    return;
  }

  const threadName = sanitizeThreadName(`🚬 ${poll.title} — ${winnerLabel}`);
  const thread = await channel.threads.create({ name: threadName, autoArchiveDuration: 1440, reason: `Meetup created from poll ${pollId}` });

  await thread.send([
    `# ${poll.title}`,
    poll.cigar ? `**Cigar:** ${poll.cigar}` : null,
    `**Selected time:** ${winnerLabel}`,
    '',
    `Source poll: ${interaction.message.url}`,
  ].filter(Boolean).join('\n'));

  if (poll.createEvent && summary.winners.length > 0) {
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    const event = await interaction.guild.scheduledEvents.create({
      name: poll.title,
      description: [poll.cigar ? `Cigar: ${poll.cigar}` : null, `Selected time option: ${winnerLabel}`, `Thread: #${thread.name}`].filter(Boolean).join('\n'),
      scheduledStartTime: start,
      scheduledEndTime: end,
      privacyLevel: 2,
      entityType: 3,
      entityMetadata: { location: `#${channel.name}` },
    });

    await thread.send(`📅 Scheduled event created: **${event.name}** (starts ${start.toLocaleString()})`);
  }

  await interaction.followUp({ content: `Created thread ${thread} in ${channel}.`, ephemeral: true });
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'meetup_vote') {
    const title = interaction.options.getString('title', true);
    const cigar = interaction.options.getString('cigar') ?? '';
    const loungeChannel = interaction.options.getChannel('lounge_channel');
    const createEvent = interaction.options.getBoolean('create_event') ?? false;

    const options = [1, 2, 3, 4, 5].map((n) => interaction.options.getString(`option${n}`)).filter(Boolean);

    if (new Set(options).size < options.length) {
      await interaction.reply({ content: 'Please provide unique time options.', ephemeral: true });
      return;
    }

    const pollId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    polls.set(pollId, {
      title,
      cigar,
      options,
      votes: new Map(),
      ownerId: interaction.user.id,
      closed: false,
      loungeChannelId: loungeChannel?.id ?? interaction.channelId,
      createEvent,
    });

    await interaction.reply({
      content: buildPollText(polls.get(pollId), pollId),
      components: buildButtons(pollId, options.length, false),
    });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'bookmark_submit') {
    const urlRaw = interaction.options.getString('url', true);
    const url = asValidUrl(urlRaw);
    if (!url) {
      await interaction.reply({ content: 'Please provide a valid URL (http/https).', ephemeral: true });
      return;
    }

    const sub = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      title: interaction.options.getString('title') ?? '',
      category: interaction.options.getString('category') ?? '',
      note: interaction.options.getString('note') ?? '',
      submittedBy: interaction.user.id,
      submittedAt: new Date().toISOString(),
      status: 'pending',
      sourceChannelId: interaction.channelId,
    };

    bookmarkSubmissions.set(sub.id, sub);

    await interaction.reply({
      content: `✅ Submitted for review.\n${bookmarkCard(sub, 'PENDING')}`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'bookmark_approve') {
    const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    if (!canManageGuild) {
      await interaction.reply({ content: 'You need Manage Server permission to approve bookmarks.', ephemeral: true });
      return;
    }

    const publishChannel = interaction.options.getChannel('publish_channel');
    const id = interaction.options.getString('submission_id', true).trim();
    const sub = bookmarkSubmissions.get(id);
    if (!sub) {
      await interaction.reply({ content: `No pending submission found for ID: ${id}`, ephemeral: true });
      return;
    }

    if (sub.status !== 'pending') {
      await interaction.reply({ content: `Submission ${id} is already ${sub.status}.`, ephemeral: true });
      return;
    }

    const bookmarksChannel = pickBookmarksChannel(interaction.guild, publishChannel);
    if (!bookmarksChannel) {
      await interaction.reply({
        content: 'Could not find a bookmarks target channel. Pass publish_channel or set BOOKMARKS_CHANNEL_NAME.',
        ephemeral: true,
      });
      return;
    }

    sub.status = 'approved';
    sub.approvedBy = interaction.user.id;
    sub.approvedAt = new Date().toISOString();

    await bookmarksChannel.send(
      wikiBookmarkPost(sub, {
        source: 'User submission',
        approvedBy: interaction.user.id,
      })
    );

    await interaction.reply({
      content: `✅ Approved and posted to ${bookmarksChannel}.\nID: \`${sub.id}\``,
      ephemeral: true,
    });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'bookmark_seed_publish') {
    const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    if (!canManageGuild) {
      await interaction.reply({ content: 'You need Manage Server permission to publish seed bookmarks.', ephemeral: true });
      return;
    }

    const publishChannel = interaction.options.getChannel('publish_channel');
    const bookmarksChannel = pickBookmarksChannel(interaction.guild, publishChannel);
    if (!bookmarksChannel) {
      await interaction.reply({
        content: 'Could not find a bookmarks target channel. Pass publish_channel or set BOOKMARKS_CHANNEL_NAME.',
        ephemeral: true,
      });
      return;
    }

    const seeds = loadSeedBookmarks();
    if (!seeds.length) {
      await interaction.reply({ content: 'No seed bookmarks found in data/bookmarks-seed.json.', ephemeral: true });
      return;
    }

    const limit = Math.max(1, Math.min(100, interaction.options.getInteger('limit') ?? 10));
    const toSend = seeds.slice(0, limit);

    const wikiLines = [
      '# 🔖 Bookmarks Wiki (Seed Import)',
      `Curated seed list published by <@${interaction.user.id}>.`,
      '',
    ];

    toSend.forEach((item, i) => {
      wikiLines.push(`## ${i + 1}) ${item.title || 'Untitled'}`);
      wikiLines.push(`**Description:** ${item.note || categoryDescription(item.category)}`);
      wikiLines.push(`**Category:** ${item.category || 'Uncategorized'}`);
      wikiLines.push(`**Link:** <${item.url}>`);
      wikiLines.push('');
    });

    const full = wikiLines.join('\n').trim();
    const maxLen = 1800;
    if (full.length <= maxLen) {
      await bookmarksChannel.send(full);
    } else {
      // split large wiki text into a few sequential chunks
      let chunk = '';
      for (const line of wikiLines) {
        if ((chunk + line + '\n').length > maxLen) {
          await bookmarksChannel.send(chunk.trim());
          chunk = '';
        }
        chunk += line + '\n';
      }
      if (chunk.trim()) await bookmarksChannel.send(chunk.trim());
    }

    await interaction.reply({
      content: `✅ Published ${toSend.length} seed bookmark(s) to ${bookmarksChannel} in wiki format.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton()) {
    const [kind, pollId, idxStr] = interaction.customId.split(':');
    const poll = polls.get(pollId);

    if (!poll) {
      await interaction.reply({ content: 'This poll has expired.', ephemeral: true });
      return;
    }

    if (kind === 'vote') {
      if (poll.closed) {
        await interaction.reply({ content: 'This poll is closed.', ephemeral: true });
        return;
      }

      const optionIndex = Number(idxStr);
      if (Number.isNaN(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
        await interaction.reply({ content: 'Invalid vote option.', ephemeral: true });
        return;
      }

      poll.votes.set(interaction.user.id, optionIndex);
      await interaction.update({
        content: buildPollText(poll, pollId),
        components: buildButtons(pollId, poll.options.length, false),
      });
      return;
    }

    if (kind === 'close') {
      const isOwner = interaction.user.id === poll.ownerId;
      const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

      if (!isOwner && !canManageGuild) {
        await interaction.reply({ content: 'Only the poll creator (or a server manager) can close this poll.', ephemeral: true });
        return;
      }

      poll.closed = true;
      await interaction.update({
        content: buildPollText(poll, pollId),
        components: buildButtons(pollId, poll.options.length, true),
      });

      await createLoungeArtifacts(interaction, pollId, poll);
    }
  }
});

client.login(token);
