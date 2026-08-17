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

/** XML gives a lone child as a bare object, so callers can't just map */
const many = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/*
 * Tags are only stripped when the node declares type="html". Entities are
 * already decoded by the time we see them, so blanket-stripping would eat the
 * angle brackets out of a plain-text title like `charlotte pushed <tag>`
 */
const text = (v) => {
  if (v === undefined || v === null) return '';
  const html = typeof v === 'object' && v['@_type'] === 'html';
  let s = String(typeof v === 'object' ? (v['#text'] ?? '') : v);
  if (html) s = s.replace(/<[^>]+>/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
};

function atomEntry(e) {
  // rel="self" points back at the feed, not at the activity
  const href = many(e.link).find((l) => l && l['@_rel'] !== 'self')?.['@_href'] || '';
  return {
    id: text(e.id) || href || text(e.updated),
    title: text(e.title),
    link: href,
  };
}

function rssItem(i) {
  const link = text(i.link);
  return {
    id: text(i.guid) || link || text(i.pubDate),
    title: text(i.title),
    link,
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
    // Gitea answers an unauthenticated private feed with 200 and the login
    // page, so don't let axios guess the type - the shape is checked below
    transformResponse: [(d) => d],
    headers: {
      Accept: 'application/atom+xml, application/rss+xml',
      // Gitea honours an API token on the web routes, which is where feeds live
      ...(config.gitea.token ? { Authorization: `token ${config.gitea.token}` } : {}),
    },
  });

  const body = String(res.data || '');
  const doc = body.includes('<feed') || body.includes('<rss') ? parser.parse(body) : null;

  if (doc?.feed) return many(doc.feed.entry).map(atomEntry);
  if (doc?.rss) return many(doc.rss.channel?.item).map(rssItem);

  // Almost always the login page, i.e. a missing or unprivileged gitea.token
  throw new Error(`${url} did not return a feed - check the URL and gitea.token`);
}

module.exports = { fetchFeed };