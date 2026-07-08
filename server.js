// ============================================================
// SELFBOT MONITOR – النسخة الكاملة (كات لـ بتر)
// تجمع بين لوحة التحكم وسكريبت المراقبة
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client } = require('discord.js-selfbot-v13');

// ========== إعدادات الخادم ==========
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// ========== إعدادات النظام ==========
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');
const LOGS_FILE = path.join(__dirname, 'data', 'logs.json');

// التأكد من وجود مجلد data
if (!fs.existsSync('data')) fs.mkdirSync('data');

// قراءة الإعدادات
let config = {};
if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE));
} else {
    config = {
        token: '',
        logChannelId: '',
        status: 'stopped',
        keywords: ['ticket', 'support', 'purchase', 'buy', 'طلب', 'شراء']
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// قراءة السجلات
let logs = [];
if (fs.existsSync(LOGS_FILE)) {
    logs = JSON.parse(fs.readFileSync(LOGS_FILE));
}

// ========== عميل ديسكورد ==========
let client = null;
let botStatus = 'stopped';
let startTime = null;

// دالة لإضافة سجل جديد
function addLog(entry) {
    entry.timestamp = new Date().toISOString();
    logs.unshift(entry);
    if (logs.length > 500) logs.pop();
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
}

// دالة لعرض اسم المستخدم
function displayTag(user) {
    if (user.tag) return user.tag;
    if (user.discriminator && user.discriminator !== '0') {
        return `${user.username}#${user.discriminator}`;
    }
    return user.username || `${user.id}`;
}

// ========== دالة تسخين الكاش (من سكريبتك الأصلي) ==========
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

// ========== دالة جلب تفاصيل المستخدم ==========
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

// ========== تشغيل البوت ==========
function startBot() {
    if (botStatus === 'running') return;
    if (!config.token) {
        addLog({ type: 'error', message: '❌ لا يوجد توكن في الإعدادات' });
        return;
    }

    client = new Client();
    startTime = Date.now();

    // ===== حدث جاهزية العميل =====
    client.once('ready', async () => {
        botStatus = 'running';
        config.status = 'running';
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        const tag = client.user.tag || client.user.username;
        console.log(`✅ Logged in as ${tag}`);
        addLog({ type: 'system', message: `✅ البوت شغال باسم ${tag}` });
        await warmAllGuilds();
    });

    // ===== حدث انضمام عضو جديد (من سكريبتك الأصلي) =====
    client.on('guildMemberAdd', async (member) => {
        try {
            const guild = member.guild;
            if (!guild.members.cache.has(member.id)) {
                await guild.members.fetch(member.id).catch(() => null);
            }

            // جلب قناة اللوج
            const channel = client.channels.cache.get(config.logChannelId) ||
                (await client.channels.fetch(config.logChannelId).catch(() => null));
            if (!channel) {
                console.log('❌ قناة اللوج غير موجودة');
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

            // بناء التقرير
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

            // إرسال إلى قناة اللوج
            await channel.send(lines.join('\n'));

            // تسجيل في قاعدة بيانات اللوحة
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

            console.log(`✅ تم إرسال تقرير عن ${displayTag(user)} إلى ديسكورد واللوحة`);

        } catch (err) {
            console.error('❌ فشل إرسال التقرير:', err?.message || err);
        }
    });

    // ===== حدث إنشاء سيرفر جديد =====
    client.on('guildCreate', async (guild) => {
        console.log(`Joined new guild: ${guild.name} [${guild.id}]`);
        await warmGuildCache(guild);
    });

    // ===== حدث الرسائل (لرصد التذاكر) =====
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

            // إرسال إلى قناة اللوج
            const logChannel = client.channels.cache.get(config.logChannelId);
            if (logChannel) {
                logChannel.send(`🎫 **تذكرة من ${displayTag(message.author)}**\n📨 ${message.content}\n📍 ${message.guild?.name || 'DM'}`);
            }
        }

        // إرسال جميع الرسائل إلى قناة اللوج (اختياري)
        if (config.logChannelId) {
            const logChannel = client.channels.cache.get(config.logChannelId);
            if (logChannel) {
                logChannel.send(`[${displayTag(message.author)}]: ${message.content}`);
            }
        }
    });

    // ===== تسجيل الدخول =====
    client.login(config.token).catch(err => {
        botStatus = 'error';
        addLog({ type: 'error', message: `❌ فشل تسجيل الدخول: ${err.message}` });
    });
}

// ========== إيقاف البوت ==========
function stopBot() {
    if (client) {
        client.destroy();
        client = null;
    }
    botStatus = 'stopped';
    config.status = 'stopped';
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    addLog({ type: 'system', message: '⏹️ تم إيقاف البوت يدويًا' });
}

// ========== واجهات API للوحة التحكم ==========

// جلب الحالة
app.get('/api/status', (req, res) => {
    const uptime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    res.json({
        status: botStatus,
        uptime: uptime,
        config: config,
        logsCount: logs.length
    });
});

// حفظ الإعدادات
app.post('/api/config', (req, res) => {
    const { token, logChannelId, keywords } = req.body;
    if (token !== undefined) config.token = token;
    if (logChannelId !== undefined) config.logChannelId = logChannelId;
    if (keywords !== undefined) config.keywords = keywords.split(',').map(k => k.trim());
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// تشغيل البوت
app.post('/api/start', (req, res) => {
    if (botStatus === 'running') return res.json({ success: false, error: 'البوت شغال بالفعل' });
    if (!config.token) return res.json({ success: false, error: 'الرجاء إدخال التوكن أولاً' });
    startBot();
    res.json({ success: true });
});

// إيقاف البوت
app.post('/api/stop', (req, res) => {
    stopBot();
    res.json({ success: true });
});

// جلب السجلات
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(logs.slice(0, limit));
});

// جلب الإحصائيات
app.get('/api/stats', (req, res) => {
    const tickets = logs.filter(l => l.type === 'ticket').length;
    const members = logs.filter(l => l.type === 'member').length;
    res.json({ tickets, members, total: logs.length });
});

// ========== تشغيل الخادم ==========
app.listen(PORT, () => {
    console.log(`🚀 Dashboard running at http://localhost:${PORT}`);
    console.log(`📁 Config: ${CONFIG_FILE}`);
    console.log(`📁 Logs: ${LOGS_FILE}`);
    
    // إذا كان البوت مضبوطاً على التشغيل التلقائي
    if (config.status === 'running' && config.token) {
        startBot();
    }
});
