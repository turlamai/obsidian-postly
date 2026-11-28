# Obsidian Postly

[English](README.md) · **简体中文**

从 Obsidian 选取笔记，发布到 GitHub 内容分支。[Postly](https://github.com/turlamai/postly) 根据该分支构建公开站点。

## 安装

从 [GitHub Releases](https://github.com/turlamai/obsidian-postly/releases) 下载 `main.js` 和 `manifest.json`，放进笔记库的 `.obsidian/plugins/postly-publisher/`。重新加载 Obsidian，在第三方插件中启用 **postly publisher**。插件 ID 为 `postly-publisher`。

## 配置

在 **设置 → postly publisher** 填写 GitHub 仓库所有者、仓库、已有内容分支及目标目录 `blog`。创建细粒度 GitHub token，只授予对应仓库的 **Contents 读写**权限。插件向 GitHub 发送 token，并将它保存在笔记库的插件设置中。请保持该设置文件私密。

接入 TurLamAI 主站时，使用所有者 `turlamai`、仓库 `turlamai.github.io`、分支 `articles-content` 和目标目录 `blog`。

## 发布、修改和撤回

- 打开笔记并运行 **Push current note to postly blog**。确认前检查目标路径和列出的图片。插件默认移除 YAML frontmatter，缺少一级标题时根据文件名补上。
- 每张本地图片嵌入独占一行，例如 `![[diagram.png]]`。支持 PNG、JPEG、GIF、WebP 和 AVIF，单张上限 10 MiB，每次发布上限 30 MiB。正文和已选图片提交在同一个 Git 提交中。发布前请检查其他 Markdown 链接和嵌入。
- 再次运行同一命令可更新已跟踪的文章，包括本地笔记重命名后的更新。更新沿用原日期路径。远端版本与本地记录不一致时，插件会阻止覆盖。
- 运行 **Withdraw current note from postly blog** 可从内容分支移除已跟踪的文章。本地笔记、共享图片、Git 历史和缓存副本会保留。站点重新构建并替换上一版产物后，文章页面、RSS 和站点地图条目才会消失。

命令成功表示 GitHub 已提交。站点构建完成后再检查公开页面。重装或换设备时请保留笔记库中的发布记录。

## 从源码构建

运行 `npm ci`、`npx tsc --noEmit` 和 `npm run build`。按前述方式安装生成的 `main.js` 和 `manifest.json`。

MIT · [许可证](LICENSE)
