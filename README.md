# Obsidian Postly

**English** · [简体中文](README.zh-CN.md)

Publish selected notes from Obsidian to a GitHub content branch. [Postly](https://github.com/turlamai/postly) builds the public site from that branch.

## Install

Download `main.js` and `manifest.json` from [GitHub Releases](https://github.com/turlamai/obsidian-postly/releases). Copy both into `.obsidian/plugins/postly-publisher/` in your vault. Reload Obsidian and enable **postly publisher** under Community plugins. The plugin ID is `postly-publisher`.

## Configure

In **Settings → postly publisher**, enter the GitHub owner, repository, existing content branch and the target directory `blog`. Create a fine-grained GitHub token with **Contents read/write** for only that repository. The plugin sends the token to GitHub and stores it in the vault's plugin settings. Keep that settings file private.

For the TurLamAI portal, use owner `turlamai`, repository `turlamai.github.io`, branch `articles-content` and target directory `blog`.

## Publish, update or withdraw

- Open a note and run **Push current note to postly blog**. Review the destination and listed images before confirming. The plugin strips YAML frontmatter by default and inserts an H1 from the filename when needed.
- Put each local image embed on its own line, for example `![[diagram.png]]`. PNG, JPEG, GIF, WebP and AVIF are supported, with a 10 MiB limit per image and 30 MiB per publication. The article and its staged images are committed together. Review other Markdown links and embeds before publishing.
- Run the same command to update a tracked article, including after renaming the local note. Updates reuse the original dated path. The plugin rejects changes when the remote article differs from its recorded revision.
- Run **Withdraw current note from postly blog** to remove the tracked article from the content branch. The local note, shared images, Git history and cached copies remain. The site build must replace the previous published output to remove the article page, RSS entry and sitemap entry.

A successful command confirms a GitHub commit. Check the public site after its build runs. Keep the vault's publication mappings if you reinstall or move to another device.

## Build from source

Run `npm ci`, `npx tsc --noEmit` and `npm run build`. Install the resulting `main.js` with `manifest.json` as above.

MIT · [License](LICENSE)
