'use strict';

const config = require('./config');
const log = require('./src/log');
const State = require('./src/state');
const { fetchFeed } = require('./src/feed');
const { postEntry } = require('./src/post');

/*
 * Poll each feed, post what's new, remember what was posted.
 */

const POST_DELAY_MS = 300; // Slack rate limits a channel at roughly 1 msg/sec

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollFeed(state, { url, channel }) {
  const entries = await fetchFeed(url);
  const seen = state.seen(url);

  // First run: baseline and post nothing. Otherwise adding a feed dumps its
  // whole backlog into the channel at boot
  if (!seen) {
    state.remember(url, entries.map((e) => e.id));
    log.info('new feed baselined', { url, entries: entries.length });
    return;
  }

  // Feeds are newest-first; post oldest-first so the channel reads in order
  const fresh = entries.filter((e) => !seen.includes(e.id)).reverse();
  if (!fresh.length) return;

  for (const entry of fresh) {
    try {
      await postEntry(channel, entry);
    } catch (err) {
      // Not retried: a post that failed structurally (channel_not_found) fails
      // the same way every minute forever
      log.error('post failed - entry dropped', { url, channel, entry: entry.id, err });
    }
    state.remember(url, [entry.id]); // per entry, so a crash mid-batch can't repost
    await sleep(POST_DELAY_MS);
  }

  log.info('posted', { url, channel, count: fresh.length });
}

async function tick(state) {
  for (const feed of config.feeds) {
    try {
      await pollFeed(state, feed);
    } catch (err) {
      // Nothing was remembered, so these entries are picked up next poll
      log.error('feed poll failed', { url: feed.url, err });
    }
  }
}

function main() {
  const state = new State(config.statePath);
  let timer = null;
  let stopping = false;

  const loop = async () => {
    await tick(state);
    if (!stopping) timer = setTimeout(loop, config.pollMs);
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      // State is write-through, so there is nothing to flush on the way out
      stopping = true;
      clearTimeout(timer);
      log.info('shutting down', { signal });
      process.exit(0);
    });
  }

  // One bad promise shouldn't take the bot down mid-shift
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }));

  log.info('giteabot started', {
    config: config.file,
    feeds: config.feeds.length,
    pollSeconds: config.pollMs / 1000,
  });
  loop();
}

main();