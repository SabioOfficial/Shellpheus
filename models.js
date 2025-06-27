import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
    projectId: { type: String, required: true, index: true },
    channelId: { type: String, required: true }
});

const devlogSchema = new mongoose.Schema({
    projectId: { type: String, required: true, unique: true },
    lastSlug: { type: String, required: true }
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);
const LastDevlog = mongoose.model('LastDevlog', devlogSchema);

export { Subscription, LastDevlog };