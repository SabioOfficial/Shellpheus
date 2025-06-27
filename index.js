import 'dotenv/config';
import pkg from '@slack/bolt';
const { App, ExpressReceiver } = pkg;
import fetch from 'node-fetch';
import mongoose from 'mongoose';
import { Subscription, LastDevlog } from './models.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

const receiver = new ExpressReceiver({ 
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    endpoints: '/slack/commands'
});

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
});

async function initDB() {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI, {});
        console.log('✅ MongoDB connected');
    }
}

app.command('/shellpheus-subscribe', async ({ command, ack, respond }) => {
    await ack();

    const pid = command.text.trim();
    if (!pid) {
        await respond('Please provide a project ID, e.g. `/shellpheus-subscribe 2054`.');
        return;
    }

    try {
        await initDB();
        const exists = await Subscription.findOne({ projectId: pid, channelId: command.channel_id });
        if (exists) {
            await respond(`You're already subscribed to project ${pid}.`);
            return;
        }
        await Subscription.create({ projectId: pid, channelId: command.channel_id });
        await respond(`✅ Subscribed to project ${pid}!`);

        const devlogs = await fetchDevlogs(pid);
        if (devlogs.length) {
            const latest = devlogs[0];
            await app.client.chat.postMessage({
                channel: command.channel_id,
                text: `📢 Latest devlog for project *${pid}*: <https://summer.hackclub.com${latest.slug}|${latest.title}> (${latest.date})`
            });
        }
    } catch (err) {
        await respond("❌ An error occurred while subscribing.");
        console.error(err);
    }
});

app.command('/shellpheus-unsubscribe', async ({command, ack, respond}) => {
    await ack();

    const pid = command.text.trim();

    try {
        await initDB();
        const result = await Subscription.deleteOne({projectId: pid, channelId: command.channel_id});
        if (result.deletedCount) {
            await respond(`🗑️ Unsubscribed from project ${pid}.`);
        } else {
            await respond(`You weren't subscribed to project ${pid}.`);
        }
    } catch (e) {
        await respond("❌ Something went wrong while unsubscribing.");
        console.error(e);
    }
});

async function fetchDevlogs(pid) {
    const res = await fetch(`https://summer.hackclub.com/projects/${pid}`, {
        headers: {
            'Cookie': process.env.SOM_COOKIE,
            'User-Agent': 'ShellpheusBot/1.0'
        }
    });

    if (!res.ok) {
        console.error(`❌ Failed to fetch project ${pid}: ${res.status}`);
        return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    return $('[data-controller~="devlog-card"]').map((i, el) => {
        const slug = $(el).attr('id')?.replace('devlog_', '') || '';
        const title = $(el).find('span.text-base, span.text-lg, span.text-xl').first().text().trim();
        const date = $(el).find('time').attr('datetime') || '';
        return { slug, title, date };
    }).get();
}

setInterval(async () => {
    await initDB();
    
    const projects = await Subscription.distinct('projectId');

    for (const pid of projects) {
        const devlogs = await fetchDevlogs(pid);
        if (!devlogs.length) continue;
        const latest = devlogs[0];

        let record = await LastDevlog.findOne({projectId: pid});
        if (!record) {
            record = await LastDevlog.create({projectId: pid, lastSlug: latest.slug});
            continue;
        }

        if (record.lastSlug !== latest.slug) {
            record.lastSlug = latest.slug;
            await record.save();

            const msg = `📢 New devlog on project *${pid}*: <https://summer.hackclub.com${latest.slug}|${latest.title}> (${latest.date})`;
            const subs = await Subscription.find({projectId: pid});
            for (const sub of subs) {
                await app.client.chat.postMessage({channel: sub.channelId, text: msg});
            }
        }
    }
}, process.env.CHECK_INTERVAL_MINUTES * 60 * 1000);

(async () => {
    await initDB();
    await app.start(process.env.PORT || 3000);
    console.log(`⚡ Shellpheus is running on port ${process.env.PORT}`);
})();