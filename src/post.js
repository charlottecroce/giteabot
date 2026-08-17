'use strict';

const { WebClient } = require('@slack/web-api');
const config = require('../config');

const slack = new WebClient(config.slack.botToken);

/** The three characters Slack reserves in mrkdwn. Branch names contain them */
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * One message per entry. A Gitea title already reads as a sentence
 * ("charlotte opened issue infra/dns#12"), so it is both the link text and the
 * whole message.
 *
 * @param {string} channel channel ID or #name
 * @param {{title: string, link: string}} entry
 */
async function postEntry(channel, entry) {
  const title = escape(entry.title || 'activity in Gitea');
  await slack.chat.postMessage({
    channel,
    text: entry.link ? `<${entry.link}|${title}>` : title,
    // The link is the message; an unfurl card under each one makes a busy
    // channel unreadable, and private Gitea instances won't unfurl anyway
    unfurl_links: false,
  });
}

module.exports = { postEntry };