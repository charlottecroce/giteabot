'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./log');

/*
 * Which entry IDs have already been posted, per feed URL.
 *
 * A bounded id list rather than a timestamp cursor: Gitea stamps a whole push
 * with one time, so a cursor either reposts the ties or drops them. "Have I
 * seen this id" has neither failure mode.
 *
 * Write-through and atomic. A truncated file reads back as "seen nothing",
 * which reposts an entire feed into the channel.
 */

const KEEP = 500; // per feed - several polls' worth of activity on a busy repo

function read(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    // A missing file is normal (first boot). Anything else is not
    if (err.code !== 'ENOENT') {
      log.error('state file unreadable - every feed will be re-baselined', { filePath, err });
    }
    return {};
  }
}

class State {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = read(filePath);
  }

  /** null means this feed has never been polled, so the caller baselines it */
  seen(url) {
    return this.data[url] || null;
  }

  remember(url, ids) {
    this.data[url] = [...(this.data[url] || []), ...ids].slice(-KEEP);
    this._write();
  }

  /*
   * Temp file, then rename. A plain writeFileSync truncates before it writes,
   * so a crash or a full disk in between leaves an empty file - see above for
   * what that costs. rename(2) is atomic within a filesystem
   */
  _write() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.state.${process.pid}.tmp`);
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      // Losing a write is bad; crashing the poll loop over it is worse
      log.error('failed to persist state', { filePath: this.filePath, err });
      fs.rmSync(tmp, { force: true });
    }
  }
}

module.exports = State;