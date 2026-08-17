'use strict';

/*
 * Values are scrubbed on the way out, so a log file can be world-readable without leaking secrets
 */

const SECRETS = [
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack bot tokens
  /token\s+[A-Za-z0-9_-]{20,}/gi, // Gitea Authorization header value
];

const scrub = (s) => SECRETS.reduce((out, re) => out.replace(re, '[redacted]'), String(s));

function write(level, msg, fields = {}) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${scrub(v instanceof Error ? v.message : JSON.stringify(v))}`);

  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${scrub(msg)} ${parts.join(' ')}`;
  const out = level === 'info' ? process.stdout : process.stderr;
  out.write(`${line.trimEnd()}\n`);
}

module.exports = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};