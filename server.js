// ============================================================
// SELFBOT MONITOR – Full Version with Ticket System (CAT for Butter)
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

// Create data folder if it doesn't exist
if (!fs.existsSync('data')) fs.mkdirSync('data');

// Read config with error handling
let config = {};
if (fs.existsSync(CONFIG_FILE)) {
    try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        config = JSON.parse(raw);
    } catch (err) {
        console.log('[!] Config file is corrupted or empty. Creating new one...');
        config = {
            token: '',
            logChannelId: '',
            status: 'stopped',
            keywords: ['ticket', 'support', 'purchase', 'buy', 'help', 'open', 'new']
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
} else {
    console.log('[!] Config file not found. Creating new one...');
    config = {
        token: '',
        logChannelId: '',
        status: 'stopped',
        keywords: ['ticket', 'support', 'purchase', 'buy', 'help', 'open', 'new']
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Read logs with error handling
let logs = [];
if (fs.existsSync(LOGS_FILE)) {
    try {
        const raw = fs.readFileSync(LOGS_FILE, 'utf8');
        logs = JSON.parse(raw);
    } catch (err) {
        console.log('[!] Logs file is corrupted or empty. Creating new one...');
        logs = [];
        fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
    }
} else {
    console.log('[!] Logs file not found. Creating new one...');
    logs = [];
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
}

console.log('[+] Config loaded successfully.');
console.log('[+] Logs loaded successfully.');

// ========== Discord Client ==========
let client = null;
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

async function warmAllGuilds() {
    const guilds = [...client.guilds.cache.values()];
    console.log(`Warming caches for ${guilds.length} guild(s)…`);
    await Promise.all(guilds.map(async (g) => {
        console.log(`Warming: ${g.name} [${g.id}]`);
        await warmGuildCache(g);
    }));
    console.log('Cache warm-up complete.');
}

// ========== Start Bot ==========
function startBot() {
    if (botStatus === 'running') return;
    if (!config.token) {
        addLog({ type: 'error', message: '❌ No token provided' });
        return;
    }

    client = new Client();
    startTime = Date.now();

    client.once('ready', async () => {
        botStatus = 'running';
        config.status = 'running';
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        const tag = client.user.tag || client.user.username;
        console.log(`✅ Logged in as ${tag}`);
        addLog({ type: 'system', message: `✅ Bot logged in as ${tag}` });
        await warmAllGuilds();
    });

    // ===== Member Join Event =====
    client.on('guildMemberAdd', async (member) => {
        try {
            const guild = member.guild;
            if (!guild.members.cache.has(member.id)) {
                await guild.members.fetch(member.id).catch(() => null);
            }

            const channel = client.channels.cache.get(config.logChannelId) ||
                (await client.channels.fetch(config.logChannelId).catch(() => null));
            if (!channel) return;

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

            console.log(`✅ Reported ${displayTag(user)}`);

        } catch (err) {
            console.error('❌ Failed:', err?.message || err);
        }
    });

    // ===== Ticket System (Message Create) =====
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (message.channel.id === config.logChannelId) return;

        const isTicket = config.keywords.some(kw => 
            message.content.toLowerCase().includes(kw)
        );

        if (isTicket) {
            addLog({
                type: 'ticket',
                user: displayTag(message.author),
                content: message.content,
                channel: message.channel.name || 'DM',
                server: message.guild?.name || 'DM'
            });

            const logChannel = client.channels.cache.get(config.logChannelId);
            if (logChannel) {
                logChannel.send(`🎫 **Ticket from ${displayTag(message.author)}**\n📨 ${message.content}\n📍 ${message.guild?.name || 'DM'}`);
            }
        }

        // Optional: log all messages
        if (config.logChannelId) {
            const logChannel = client.channels.cache.get(config.logChannelId);
            if (logChannel) {
                logChannel.send(`[${displayTag(message.author)}]: ${message.content}`);
            }
        }
    });

    client.on('guildCreate', async (guild) => {
        console.log(`Joined new guild: ${guild.name} [${guild.id}]`);
        await warmGuildCache(guild);
    });

    client.login(config.token).catch(err => {
        botStatus = 'error';
        addLog({ type: 'error', message: `❌ Login failed: ${err.message}` });
    });
}

// ========== Stop Bot ==========
function stopBot() {
    if (client) {
        client.destroy();
        client = null;
    }
    botStatus = 'stopped';
    config.status = 'stopped';
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    addLog({ type: 'system', message: '⏹️ Bot stopped' });
}

// ========== API Routes ==========

app.get('/api/status', (req, res) => {
    const uptime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    res.json({
        status: botStatus,
        uptime: uptime,
        config: config,
        logsCount: logs.length
    });
});

app.post('/api/config', (req, res) => {
    const { token, logChannelId, keywords } = req.body;
    if (token !== undefined) config.token = token;
    if (logChannelId !== undefined) config.logChannelId = logChannelId;
    if (keywords !== undefined) config.keywords = keywords.split(',').map(k => k.trim());
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

app.post('/api/start', (req, res) => {
    if (botStatus === 'running') return res.json({ success: false, error: 'Bot already running' });
    if (!config.token) return res.json({ success: false, error: 'Please enter a token first' });
    startBot();
    res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
    stopBot();
    res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(logs.slice(0, limit));
});

app.get('/api/stats', (req, res) => {
    const tickets = logs.filter(l => l.type === 'ticket').length;
    const members = logs.filter(l => l.type === 'member').length;
    res.json({ tickets, members, total: logs.length });
});

// ========== Start Server ==========
app.listen(PORT, () => {
    console.log(`🚀 Dashboard running at http://localhost:${PORT}`);
    console.log(`📁 Config: ${CONFIG_FILE}`);
    console.log(`📁 Logs: ${LOGS_FILE}`);
    
    if (config.status === 'running' && config.token) {
        startBot();
    }
});
