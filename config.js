'use strict';

/*
 * config.js - reads giteabot.yml. Edit the YAML, not this file.
 *
 * The file is the whole configuration: two credentials and the url > channel
 * map. ${VAR} pulls a value in from the environment, for deployments that
 * inject secrets rather than mounting a file.
 *
 * Because it holds both tokens, a group- or world-readable file is warned about
 * at boot - `cp` inherits your umask, which on most distributions is 0644.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const log = require('./src/log');

class ConfigError extends Error {}

const INTERP = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}/g;

/** ${VAR} and ${VAR:fallback}, applied to every string in the tree */
function interpolate(node) {
  if (typeof node === 'string') {
    return node.replace(INTERP, (_, name, dflt) => process.env[name] || dflt || '');
  }
  if (Array.isArray(node)) return node.map(interpolate);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, interpolate(v)]));
  }
  return node;
}

/** GITEABOT_CONFIG is explicit and must exist; otherwise look next to the process */
function resolvePath() {
  const explicit = process.env.GITEABOT_CONFIG;
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new ConfigError(`GITEABOT_CONFIG points at ${explicit}, which does not exist`);
    }
    return explicit;
  }

  for (const p of ['./giteabot.yml', './giteabot.yaml']) {
    const full = path.resolve(process.cwd(), p);
    if (fs.existsSync(full)) return full;
  }
  throw new ConfigError('no giteabot.yml found - start from `cp giteabot.example.yml giteabot.yml`');
}

/**
 * Operators paste whatever URL they were looking at, so accept the plain page
 * and add the suffix ourselves. `new URL` throwing on a typo is the point.
 */
function feedUrl(raw) {
  const url = new URL(String(raw).trim());
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!/\.(atom|rss)$/.test(url.pathname)) url.pathname += '.atom';
  return url.toString();
}

const file = resolvePath();

let parsed;
try {
  parsed = yaml.load(fs.readFileSync(file, 'utf8')) || {};
} catch (err) {
  // js-yaml's message already carries line and column
  throw new ConfigError(`${file} is not valid YAML.\n${err.message}`);
}
if (typeof parsed !== 'object' || Array.isArray(parsed)) {
  throw new ConfigError(`${file} must contain a mapping at the top level`);
}

const raw = interpolate(parsed);

// Windows has no meaningful POSIX mode
if (process.platform !== 'win32') {
  const mode = fs.statSync(file).mode & 0o777;
  if (mode & 0o044) {
    log.warn('config file is readable by other accounts and holds both tokens', {
      file,
      mode: mode.toString(8),
      remedy: `chmod 600 ${file}`,
    });
  }
}

// Report everything that's wrong, not just the first thing
const errors = [];

const feeds = Object.entries(raw.feeds || {})
  .map(([url, channel]) => {
    if (!channel) {
      errors.push(`feeds: "${url}" has no channel`);
      return null;
    }
    try {
      return { url: feedUrl(url), channel: String(channel) };
    } catch {
      errors.push(`feeds: "${url}" is not a valid URL`);
      return null;
    }
  })
  .filter(Boolean);

if (!feeds.length) errors.push('feeds: at least one "gitea-url: slack-channel" pair is required');
if (!raw.slack || !raw.slack.bot_token) errors.push('slack.bot_token is required (xoxb-...)');

if (errors.length) throw new ConfigError(`${file}:\n  - ${errors.join('\n  - ')}`);

// Not an error: public feeds need no credential, and saying so beats failing
if (!raw.gitea || !raw.gitea.token) {
  log.warn('gitea.token is not set - private feeds will return the login page', {
    remedy: 'set gitea.token, or check that every feed is public',
  });
}

const pollSeconds = Number(raw.poll_seconds ?? 60);
if (!Number.isFinite(pollSeconds) || pollSeconds < 15) {
  throw new ConfigError(`poll_seconds must be a number >= 15, got ${JSON.stringify(raw.poll_seconds)}`);
}

module.exports = {
  file,
  feeds, // [{ url, channel }]
  pollMs: pollSeconds * 1000,
  statePath: path.resolve(process.cwd(), raw.state_file || './data/state.json'),

  gitea: {
    token: (raw.gitea && raw.gitea.token) || '',
    // Not exposed in the YAML: a feed that takes longer than this is broken,
    // not slow, and the poll loop needs to get on with the next one
    timeoutMs: 15000,
  },

  slack: {
    botToken: raw.slack.bot_token,
  },
};