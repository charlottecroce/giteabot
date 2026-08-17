# Giteabot

Polls Gitea's Atom/RSS activity feeds and posts each new entry into a Slack channel, linked to the whatever it's about.

One message per entry:

> [charlotte opened issue infra/dns#12](#)

## Setup

1. **Create the Slack app** from [manifest.yml](manifest.yml)
   (https://api.slack.com/apps > *From an app manifest*), install it, and copy the Bot User OAuth Token from **Install App**. Invite the bot to each target channel, or rely on `chat:write.public`.

2. **Create a Gitea token** under Settings > Applications > *Generate New Token*, scope `read:repository` (plus `read:organization` for an org feed). Only needed for private feeds.

3. **Configure**

   ```bash
   cp giteabot.example.yml giteabot.yml
   chmod 600 giteabot.yml
   ```

   The whole thing is two credentials and a url > channel map:

   ```yaml
   gitea:
     token: ${GITEA_TOKEN}
   slack:
     bot_token: ${SLACK_BOT_TOKEN}

   feeds:
     https://git.example.com/infra/dns: C0123456789
     https://git.example.com/platform-team: "#platform"
   ```

   The URL is any Gitea user, org or repo page; `.atom` is added if you leave it off. Every setting is documented in [giteabot.example.yml](giteabot.example.yml).

4. **Run**

   ```bash
   npm install
   npm start
   ```

Tokens are scrubbed out of log output, including from error messages that happen to carry them.