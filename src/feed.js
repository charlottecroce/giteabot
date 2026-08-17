'use strict';

const https = require('https');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const config = require('../config');

/*
 * Gitea serves Atom at <user|org|repo>.atom and RSS at .rss. Both are handled
 * because the two URLs are one click apart in the web UI and an operator will
 * paste whichever they landed on.
 *
 * Every entry already carries a link to the thing that happened, so there is nothing to reconstruct
 */

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/*
 * One agent for the process so polls reuse the connection instead of
 * re-handshaking. Only built when verification is off - otherwise axios uses
 * its own default and the system trust store
 */
const agent = config.gitea.insecure
  ? new https.Agent({ rejectUnauthorized: false, keepAlive: true })
  : undefined;

/*
 * Gitea takes the token from whichever field is not the password, so the token
 * goes in the username slot behind GitHub's x-oauth-basic sentinel
 */
const basic = (token) =>
  `Basic ${Buffer.from(`${token}:x-oauth-basic`).toString('base64')}`;

/** XML gives a lone child as a bare object, so callers can't just map */
const many = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/*
 * Gitea puts markup in the title - an <a> around the repo, sometimes <code>
 * around a branch. Slack can't nest a link inside a link and the whole message
 * already is one, so the markup has to come out.
 */
const TAG = /<\/?(?:a|b|i|em|strong|code|span|div|p|br|img)\b[^>]*>/gi;

const text = (v) => {
  const s = String(typeof v === 'object' && v !== null ? (v['#text'] ?? '') : (v ?? ''));
  return s.replace(TAG, ' ').replace(/\s+/g, ' ').trim();
};

/*
 * Gitea builds every link in the feed from ROOT_URL, which is often the address
 * the server binds to rather than the one people reach it by. Rewrite the origin
 * to the feed's own, so a link posted into Slack is clickable from a laptop and
 * matches the TLS cert
 */
const rebase = (href, base) => {
  if (!href) return '';
  try {
    const url = new URL(href, base); // a relative href resolves against the feed
    const feed = new URL(base);
    url.protocol = feed.protocol;
    url.host = feed.host; // host, not hostname - carries the port
    return url.toString();
  } catch {
    return href;
  }
};

function atomEntry(e, base) {
  // rel="self" points back at the feed, not at the activity
  const href = many(e.link).find((l) => l && l['@_rel'] !== 'self')?.['@_href'] || '';
  return {
    // The id stays on the RAW href. Rebasing it would change every id at once
    // and repost the whole feed on the upgrade
    id: text(e.id) || href || text(e.updated),
    title: text(e.title),
    link: rebase(href, base),
  };
}

function rssItem(i, base) {
  const link = text(i.link);
  return {
    id: text(i.guid) || link || text(i.pubDate),
    title: text(i.title),
    link: rebase(link, base),
  };
}

/**
 * @param {string} url feed URL from the config
 * @returns {Promise<Array<{id: string, title: string, link: string}>>} newest first
 */
async function fetchFeed(url) {
  const res = await axios.get(url, {
    timeout: config.gitea.timeoutMs,
    httpsAgent: agent,
    responseType: 'text',
    // The response is XML we parse ourselves; don't let axios guess the type
    transformResponse: [(d) => d],
    // A 3xx is Gitea bouncing us to the login page. Following it turns an auth
    // failure into a confusing parse failure on the login HTML
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      Accept: 'application/atom+xml, application/rss+xml',
      ...(config.gitea.token ? { Authorization: basic(config.gitea.token) } : {}),
    },
  });

  if (res.status >= 300) {
    throw new Error(`${url} redirected to login - gitea.token was not accepted`);
  }

  const body = String(res.data || '');
  const doc = body.includes('<feed') || body.includes('<rss') ? parser.parse(body) : null;

  if (doc?.feed) return many(doc.feed.entry).map((e) => atomEntry(e, url));
  if (doc?.rss) return many(doc.rss.channel?.item).map((i) => rssItem(i, url));

  throw new Error(`${url} did not return a feed - check the URL`);
}

module.exports = { fetchFeed };