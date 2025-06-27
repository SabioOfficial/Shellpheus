require('dotenv').config();
const {App} = require('@slack/bolt');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const {Low, JSONFile} = require('lowdb');
const path = require('path');

const file = path.json(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter);

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});

async function initDB() {
    await db.read();
    db.data ||= {subscriptions: {}, lastDevlogs: {}};
    await db.write();
}

app.command('/shellpheus-subscribe', async ({command, ack, respond}) => {
    await ack();
    const pid = command.text.trim();
    if (!pid) return respond(`Please provide a project ID, e.g. \`/shellpheus-subscribe 2054\`.`);
    await initDB();
    const subs = db.data.subscriptions[pid] || [];
    if (!subs.includes(command.channel_id)) {
        subs.push(command.channel_id);
        db.data.subscriptions[pid] = subs;
        await db.write();
        respond(`✅ Subscribed to project ${pid}. I'll let you know when there's a new devlog!`);
    } else {
        respond(`You're already subscribed to project ${pid}.`);
    }
});

app.command('/shellpheus-unsubscribe', async ({command, ack, respond}) => {
    await ack();
    const pid = command.text.trim();
    await initDB();
    const subs = db.data.subscriptions[pid] || [];
    const idx = subs.indexOf(command.channel_id);
    if (idx > -1) {
        subs.splice(idx, 1);
        db.data.subscriptions[pid] = subs;
        await db.write();
        respond(`🗑️ Unsubscribed from project ${pid}.`)
    } else {
        respond(`You weren't subscribed to project ${pid}.`);
    }
});

async function fetchDevlogs(pid) {
    const res = await fetch(`https://summer.hackclub.com/projects/${pid}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    return $('.devlog-card').map((i, el) => {
        const slug = $(el).find('a.devlog-link').attr('href');
        const title = $(el).find('h3').text().trim();
        const date = $(el).find('time').attr('datetime');
        return {slug, title, date};
    }).get();
}

setInterval(async () => {
    await initDB();
    const subs = db.data.subscriptions;
    for (const pid of Object.keys(subs)) {
        const devlogs = await fetchDevlogs(pid);
        if (devlogs.length === 0) continue;
        const latest = devlogs[0];
        const lastSeen = db.data.lastDevlogs[pid];
        if (latest.slug !== lastSeen) {
            db.data.lastDevlogs[pid] = latest.slug;
            await db.write();
            const msg = `📢 New devlog on project *${pid}*: <https://summer.hackclub.com${latest.slug}|${latest.title}> (${latest.date})`;
            for (const channel of subs[pid]) {
                await app.client.chat.postMessage({channel, text: msg});
            }
        }
    }
}, parseInt(process.env.CHECK_INTERVAL_MINUTES, 10) * 60 * 1000);

(async () => {
    await initDB();
    await app.start(process.env.PORT || 3000);
    console.log(`⚡ Shellpheus is running on port ${process.env.PORT}`);
})();