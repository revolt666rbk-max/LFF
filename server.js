// ============================================================
// SELFBOT MONITOR – Multi-Account Version (CAT for Butter)
// No Ticket System – Only Member Join Monitoring
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client } = require('discord.js-selfbot-v13');

// ========== Server Setup ==========
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// ========== System Config ==========
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');
const LOGS_FILE = path.join(__dirname, 'data', 'logs.json');

if (!fs.existsSync('data')) fs.mkdirSync('data');

let config = {};
if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE));
} else {
    config = {
        accounts: [
            { token: '', logChannelId: '' }
        ],
        status: 'stopped'
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let logs = [];
if (fs.existsSync(LOGS_FILE)) {
    logs = JSON.parse(fs.readFileSync(LOGS_FILE));
}

// ========== Discord Client ==========
let clients = [];
let botStatus = 'stopped';
let startTime = null;

function addLog(entry) {
    entry.timestamp = new Date().toISOString();
    logs.unshift(entry);
    if (logs.length > 500) logs.pop();
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
}

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
        const flags = (typeof user.fetchFlags === 'function') ? await user.fetchFlags() : user.flags;
        if (flags && typeof flags.toArray === 'function') {
            flagsArr = flags.toArray();
        }
    } catch {}
    try {
        const fetched = (typeof user.fetch === 'function') ? await user.fetch(true) : null;
        if (fetched && typeof fetched.bannerURL === 'function') {
            bannerUrl = fetched.bannerURL({ size: 1024 }) || null;
        } else if (typeof user.bannerURL === 'function') {
            bannerUrl = user.bannerURL({ size: 1024 }) || null;
        }
    } catch {}
    return { flagsArr, bannerUrl };
}

async function warmGuildCache(guild) {
    try {
        await guild.fetch().catch(() => null);
        await guild.channels.fetch().catch(() => null);
        try { await guild.members.fetch({ withPresences: false }); } catch {}
        try { await guild.roles.fetch().catch(() => null); } catch {}
    } catch (err) {
        console.error(`[warmGuildCache] ${guild?.name || guild?.id}:`, err?.message || err);
    }
}

async function warmAllGuilds(client) {
    const guilds = [...client.guilds.cache.values()];
    console.log(`Warming caches for ${guilds.length} guild(s)…`);
    await Promise.all(guilds.map(async (g) => {
        console.log(`Warming: ${g.name} [${g.id}]`);
        await warmGuildCache(g);
    }));
    console.log('Cache warm-up complete.');
}

// ========== Start All Bots ==========
function startAllBots() {
    if (botStatus === 'running') return;
    if (!config.accounts || config.accounts.length === 0) {
        addLog({ type: 'error', message: '❌ No accounts configured' });
        return;
    }

    botStatus = 'running';
    startTime = Date.now();
    config.status = 'running';
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    config.accounts.forEach((account, index) => {
        if (!account.token || account.token === '') {
            console.log(`⚠️ Account ${index + 1} has no token, skipping...`);
            return;
        }

        const client = new Client();
        const botName = `Bot ${index + 1}`;

        client.once('ready', async () => {
            const tag = client.user.tag || client.user.username;
            console.log(`✅ ${botName} logged in as ${tag}`);
            addLog({ type: 'system', message: `✅ ${botName} logged in as ${tag}` });
            await warmAllGuilds(client);
        });

        // ===== Member Join Event =====
        client.on('guildMemberAdd', async (member) => {
            try {
                const guild = member.guild;
                if (!guild.members.cache.has(member.id)) {
                    await guild.members.fetch(member.id).catch(() => null);
                }

                const channel = client.channels.cache.get(account.logChannelId) ||
                    (await client.channels.fetch(account.logChannelId).catch(() => null));
                if (!channel) {
                    console.log(`❌ ${botName}: Log channel not found`);
                    return;
                }

                const user = member.user;
                const createdDate = new Date(user.createdTimestamp || Date.now()).toLocaleString();
                const joinedDate = member.joinedTimestamp ? new Date(member.joinedTimestamp).toLocaleString() : 'Unknown';
                const avatarUrl = (typeof user.displayAvatarURL === 'function') ? user.displayAvatarURL({ size: 512 }) : null;
                const { flagsArr, bannerUrl } = await enrichUser(user);
                const nickname = member.nickname || 'None';
                const pending = typeof member.pending === 'boolean' ? (member.pending ? 'Yes' : 'No') : 'Unknown';
                const boostingSince = member.premiumSinceTimestamp ? `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:F>` : 'No';
                const timedOutUntil = member.communicationDisabledUntilTimestamp ? `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:F>` : 'None';
                const rolesCollection = member.roles?.cache?.filter(r => r.name !== '@everyone') || null;
                const rolesCount = rolesCollection ? rolesCollection.size : 0;
                const highestRole = member.roles?.highest || null;
                const roleNames = rolesCollection ? [...rolesCollection.values()].sort((a, b) => b.position - a.position).slice(0, 10).map(r => r.name) : [];

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
                    avatarUrl ? `**Avatar:** ${avatarUrl}` : null,
                    bannerUrl ? `**Banner:** ${bannerUrl}` : null,
                ].filter(Boolean);

                await channel.send(lines.join('\n'));

                addLog({
                    type: 'member',
                    user: displayTag(user),
                    server: guild.name,
                    details: {
                        id: user.id,
                        created: createdDate,
                        joined: joinedDate,
                        roles: roleNames.join(', ') || 'None',
                        badges: flagsArr.join(', ') || 'None',
                        avatar: avatarUrl || 'None',
                        banner: bannerUrl || 'None'
                    }
                });

                console.log(`✅ ${botName} reported ${displayTag(user)}`);

            } catch (err) {
                console.error(`❌ ${botName} failed:`, err?.message || err);
            }
        });

        // ===== Guild Create Event =====
        client.on('guildCreate', async (guild) => {
            console.log(`Joined new guild: ${guild.name} [${guild.id}]`);
            await warmGuildCache(guild);
        });

        // ===== Login =====
        client.login(account.token).catch(err => {
            console.error(`❌ ${botName} login failed:`, err.message);
            addLog({ type: 'error', message: `❌ ${botName} login failed: ${err.message}` });
        });

        clients.push(client);
    });

    addLog({ type: 'system', message: `✅ ${config.accounts.length} bot(s) started` });
}

// ========== Stop All Bots ==========
function stopAllBots() {
    clients.forEach(client => {
        try { client.destroy(); } catch {}
    });
    clients = [];
    botStatus = 'stopped';
    config.status = 'stopped';
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    addLog({ type: 'system', message: '⏹️ All bots stopped' });
}

// ========== API Routes ==========

// Get status
app.get('/api/status', (req, res) => {
    const uptime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    res.json({
        status: botStatus,
        uptime: uptime,
        config: config,
        logsCount: logs.length
    });
});

// Save config
app.post('/api/config', (req, res) => {
    const { accounts } = req.body;
    if (accounts) {
        config.accounts = accounts;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
    res.json({ success: true });
});

// Start bots
app.post('/api/start', (req, res) => {
    if (botStatus === 'running') return res.json({ success: false, error: 'Bots already running' });
    if (!config.accounts || config.accounts.length === 0) {
        return res.json({ success: false, error: 'No accounts configured' });
    }
    startAllBots();
    res.json({ success: true });
});

// Stop bots
app.post('/api/stop', (req, res) => {
    stopAllBots();
    res.json({ success: true });
});

// Get logs
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(logs.slice(0, limit));
});

// Get stats
app.get('/api/stats', (req, res) => {
    const members = logs.filter(l => l.type === 'member').length;
    res.json({ members, total: logs.length });
});

// ========== Start Server ==========
app.listen(PORT, () => {
    console.log(`🚀 Dashboard running at http://localhost:${PORT}`);
    console.log(`📁 Config: ${CONFIG_FILE}`);
    console.log(`📁 Logs: ${LOGS_FILE}`);
    
    if (config.status === 'running' && config.accounts && config.accounts.length > 0) {
        startAllBots();
    }
});
