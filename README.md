# obsidian-postly

**Support:** [Issues & feedback](https://github.com/turlamai/obsidian-postly/issues) · [Development policy](https://github.com/turlamai/turlamai.github.io/blob/master/PORTFOLIO.md)

[English](README.md) · [简体中文](README.zh-CN.md)

A deliberately thin Obsidian plugin: push the current note's **pure
Markdown** to a [postly](https://github.com/turlamai/postly) blog repository
via the GitHub Contents API.

One command: **"Push current note to postly blog"**. The plugin never
transforms content beyond two normalizations that keep the file
editor-neutral — stripping YAML frontmatter (vault-local by design; the blog
never depends on it) and deriving an H1 title from the filename when the body
has none. Everything else is pushed byte-for-byte; the postly engine does all
rendering on the build side.

## Identity

The repository and plugin id intentionally differ: the Obsidian manifest id
is `postly-publisher` (set at first publication — changing it would orphan
existing installs), while the repository/package name is `obsidian-postly`,
matching its sibling naming (`obsidian` is the Racket Markdown library this
plugin does not depend on). The display name is "postly publisher".

## Setup

1. Settings → postly publisher: repository owner/name, branch, target
   directory (`blog` for posts), and a fine-grained PAT with Contents
   read/write on that repository only.
2. Run the command from the note you want to publish.

## License

MIT — see `LICENSE`.
