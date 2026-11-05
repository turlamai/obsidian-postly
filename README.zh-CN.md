# obsidian-postly

[English](README.md) · 简体中文

刻意做薄的 Obsidian 插件：把当前笔记的**纯 Markdown** 经 GitHub Contents API 推送到 [postly](https://github.com/turlamai/postly) 博客仓库。

一条命令：**"Push current note to postly blog"**。插件只做两种保持编辑器中立的归一化——剥掉 YAML frontmatter（它属于 vault 本地，博客从不依赖它）、正文无 H1 时从文件名派生标题——其余内容逐字节原样推送；全部渲染在构建侧由 postly 引擎完成。

## 配置

1. 设置 → postly publisher：仓库 owner/name、分支、目标目录（文章填 `blog`）、仅对该仓库有 Contents 读写权限的 fine-grained PAT。
2. 在要发布的笔记里执行命令即可。

## 许可

MIT，见 `LICENSE`。
