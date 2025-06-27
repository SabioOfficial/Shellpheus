import 'dotenv/config';
import App from '@slack/bolt';
import fetch from 'node-fetch';
import mongoose from 'mongoose';
import { Subscription, LastDevlog } from './models.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

async function initDB() {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI, {
            // nothing LMFAO 💤
        });
        console.log('✅ MongoDB connected');
    }
}

App.command('/shellpheus-subscribe', async ({command, ack, respond}) => {
    await ack();
    const pid = command.text.trim();
    if (!pid) return respond(`Please provide a project ID, e.g. \`/shellpheus-subscribe 2054\`.`);

    await initDB();
    const exists = await Subscription.findOne({projectId: pid, channelId: command.channel_id});
    if (exists) {
        return respond(`You're already subscribed to project ${pid}.`);
    }
    await Subscription.create({projectId: pid, channelId: command.channel_id});
    respond(`✅ Subscribed to project ${pid}!`);
});

App.command('/shellpheus-unsubscribe', async ({command, ack, respond}) => {
    await ack();
    const pid = command.text.trim();

    await initDB();
    const result = await Subscription.deleteOne({projectId: pid, channelId: command.channel_id});
    if (result.deletedCount) {
        respond(`🗑️ Unsubscribed from project ${pid}.`);
    } else {
        respond(`You weren't subscribed to project ${pid}.`);
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
    return $('.devlog-card').map((i, el) => {
        const slug = $(el).find('a.devlog-link').attr('href');
        const title = $(el).find('h3').text().trim();
        const date = $(el).find('time').attr('datetime');
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
                await App.client.chat.postMessage({channel: sub.channelId, text: msg});
            }
        }
    }
}, process.env.CHECK_INTERVAL_MINUTES * 60 * 1000);

(async () => {
    await initDB();
    await App.start(process.env.PORT || 3000);
    console.log(`⚡ Shellpheus is running on port ${process.env.PORT}`);
})();