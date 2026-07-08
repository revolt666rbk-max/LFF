const { Client } = require('discord.js-selfbot-v13');

const cfg = {
  token: process.env.TOKEN,
  logChannelId: '1524483171889053928',
};

const client = new Client();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fmt = (unixSecs) => `<t:${unixSecs}:F> (<t:${unixSecs}:R>)`;

function displayTag(user) {
  if (user.tag) return user.tag;
  if (user.discriminator && user.discriminator !== '0') {
    return `${user.username}#${user.discriminator}`;
  }
  return user.username || `${user.id}`;
}

async function enrichUser(user) {
  let flagsArr = [];
  let bannerUrl = null;

  try {
    const flags = (typeof user.fetchFlags === 'function')
      ? await user.fetchFlags()
      : user.flags;
    if (flags && typeof flags.toArray === 'function') {
      flagsArr = flags.toArray();
    }
  } catch { }

  try {
    const fetched = (typeof user.fetch === 'function') ? await user.fetch(true) : null;
    if (fetched && typeof fetched.bannerURL === 'function') {
      bannerUrl = fetched.bannerURL({ size: 1024 }) || null;
    } else if (typeof user.bannerURL === 'function') {
      bannerUrl = user.bannerURL({ size: 1024 }) || null;
    }
  } catch { }

  return { flagsArr, bannerUrl };
}

async function warmGuildCache(guild) {
  try {
    await guild.fetch().catch(() => null);
    await guild.channels.fetch().catch(() => null);

    try {
      await guild.members.fetch({ withPresences: false });
    } catch {
      await sleep(1500);
      try {
        await guild.members.fetch({ withPresences: false });
      } catch { }
    }

    try { await guild.roles.fetch().catch(() => null); } catch { }
  } catch (err) {
    console.error(`[warmGuildCache] ${guild?.name || guild?.id}:`, err?.message || err);
  }
}

async function warmAllGuilds() {
  const guilds = [...client.guilds.cache.values()];
  console.log(`Warming caches for ${guilds.length} guild(s)…`);

  await Promise.all(
    guilds.map(async (g) => {
      console.log(`Warming: ${g.name} [${g.id}]`);
      await warmGuildCache(g);
    })
  );

  console.log('Cache warm-up complete.');
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag || client.user.username}`);
  await warmAllGuilds();
  console.log('✅ Bot is now monitoring for new members...');
});

client.on('guildCreate', async (guild) => {
  console.log(`Joined new guild: ${guild.name} [${guild.id}]`);
  await warmGuildCache(guild);
  console.log(`Warmed: ${guild.name}`);
});

client.on('guildMemberAdd', async (member) => {
  try {
    const guild = member.guild;

    if (!guild.members.cache.has(member.id)) {
      await guild.members.fetch(member.id).catch(() => null);
    }

    const channel =
      client.channels.cache.get(cfg.logChannelId) ||
      (await client.channels.fetch(cfg.logChannelId).catch(() => null));
    if (!channel) return;

    const user = member.user;

    const createdDate = new Date(user.createdTimestamp || Date.now()).toLocaleString();
    const joinedDate = member.joinedTimestamp ? new Date(member.joinedTimestamp).toLocaleString() : 'Unknown';

    const avatarUrl = (typeof user.displayAvatarURL === 'function')
      ? (user.displayAvatarURL({ size: 512 }) || null)
      : null;

    const { flagsArr, bannerUrl } = await enrichUser(user);

    const nickname = member.nickname || 'None';
    const pending = typeof member.pending === 'boolean' ? (member.pending ? 'Yes' : 'No') : 'Unknown';
    const boostingSince = member.premiumSinceTimestamp
      ? fmt(Math.floor(member.premiumSinceTimestamp / 1000))
      : (member.premiumSince ? fmt(Math.floor(new Date(member.premiumSince).getTime() / 1000)) : 'No');
    const timedOutUntil = member.communicationDisabledUntilTimestamp
      ? fmt(Math.floor(member.communicationDisabledUntilTimestamp / 1000))
      : 'None';

    const rolesCollection = member.roles?.cache?.filter(r => r.name !== '@everyone') || null;
    const rolesCount = rolesCollection ? rolesCollection.size : 0;
    const highestRole = member.roles?.highest || null;
    const roleNames = rolesCollection
      ? [...rolesCollection.values()].sort((a, b) => b.position - a.position).slice(0, 10).map(r => r.name)
      : [];

    const lines = [
      `📥 **Member Joined**`,
      `\`\`\`ini`,
      `[User]`,
      `Username = ${displayTag(user)}`,
      `Mention = <@${user.id}>`,
      `ID = ${user.id}`,
      `Bot = ${user.bot ? 'Yes' : 'No'}`,
      `System = ${user.system ? 'Yes' : 'No'}`,
      ``,
      `[Account Info]`,
      `Created = ${createdDate}`,
      `Joined Server = ${joinedDate}`,
      ``,
      `[Server Details]`,
      `Guild = ${guild.name} (${guild.id})`,
      `Nickname = ${nickname}`,
      `Pending Screening = ${pending}`,
      `Boosting Since = ${boostingSince}`,
      `Timeout Until = ${timedOutUntil}`,
      ``,
      `[Roles]`,
      `Total Count = ${rolesCount}`,
      rolesCount ? `Top Role = ${highestRole.name} (${highestRole.id})` : null,
      roleNames.length ? `Role List = ${roleNames.join(', ')}` : null,
      ``,
      `[Media]`,
      avatarUrl ? `Avatar = Available` : `Avatar = None`,
      bannerUrl ? `Banner = Available` : `Banner = None`,
      `Badges/Flags = ${flagsArr.length ? flagsArr.join(', ') : 'None'}`,
      `\`\`\``,
      ``,
      `**Username:** \`\`\`${displayTag(user)}\`\`\``,
      avatarUrl ? `**Avatar:** ${avatarUrl}` : null,
      bannerUrl ? `**Banner:** ${bannerUrl}` : null,
    ].filter(Boolean);

    await channel.send(lines.join('\n'));
  } catch (err) {
    console.error('Failed to log member join:', err?.message || err);
  }
});

client.login(cfg.token);
