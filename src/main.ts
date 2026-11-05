// postly publisher — a deliberately thin Obsidian plugin.
//
// It does exactly one thing: push the current note's pure Markdown to a
// GitHub repository (the postly content repo). All rendering happens in the
// postly engine on the build side; the plugin never transforms content
// beyond two normalizations that keep the file editor-neutral:
//   1. strip YAML frontmatter (the vault may use it; the blog does not)
//   2. ensure the title: if the body has no H1, one is derived from the file
//      name so the engine's title rule has something to find.

import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from "obsidian";

interface PostlySettings {
  owner: string;
  repo: string;
  branch: string;
  /** Directory in the content repo the note is pushed to, e.g. "blog". */
  targetDir: string;
  token: string;
  stripFrontmatter: boolean;
}

const DEFAULT_SETTINGS: PostlySettings = {
  owner: "",
  repo: "",
  branch: "main",
  targetDir: "blog",
  token: "",
  stripFrontmatter: true,
};

export default class PostlyPlugin extends Plugin {
  settings: PostlySettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "push-current-note",
      name: "Push current note to postly blog",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.pushCurrentNote(view);
        return true;
      },
    });
    this.addSettingTab(new PostlySettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async pushCurrentNote(view: MarkdownView) {
    const file = view.file;
    if (!file) return;
    if (!this.settings.owner || !this.settings.repo || !this.settings.token) {
      new Notice("postly: set owner / repo / token in settings first");
      return;
    }
    const raw = await this.app.vault.read(file);
    const body = this.normalize(raw, file.name);
    const path = `${this.settings.targetDir}/${file.name}`;
    try {
      new Notice(`postly: pushing ${file.name}…`);
      const url = await this.putContents(path, body);
      new Notice(`postly: pushed ✓ ${url ?? ""}`);
    } catch (e) {
      new Notice(`postly: push failed — ${String(e)}`);
    }
  }

  /** Editor-neutral normalization; everything else is left byte-for-byte. */
  private normalize(raw: string, fileName: string): string {
    let body = raw;
    if (this.settings.stripFrontmatter) {
      body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
    }
    if (!/^#\s/m.test(body)) {
      const title = fileName.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
      body = `# ${title}\n\n${body}`;
    }
    return body;
  }

  /** GitHub Contents API PUT; returns the commit HTML URL when present. */
  private async putContents(path: string, content: string): Promise<string | undefined> {
    const { owner, repo, branch, token } = this.settings;
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };

    let sha: string | undefined;
    const get = await requestUrl({ url: `${api}?ref=${branch}`, headers, throw: false });
    if (get.status === 200) sha = get.json?.sha;
    else if (get.status !== 404) throw new Error(`GitHub GET ${get.status}`);

    const put = await requestUrl({
      url: api,
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `postly: publish ${path}`,
        content: btoa(unescape(encodeURIComponent(content))),
        branch,
        ...(sha ? { sha } : {}),
      }),
      throw: false,
    });
    if (put.status >= 200 && put.status < 300) {
      return put.json?.commit?.html_url;
    }
    throw new Error(`GitHub PUT ${put.status}: ${put.text?.slice(0, 200)}`);
  }
}

class PostlySettingTab extends PluginSettingTab {
  plugin: PostlyPlugin;

  constructor(app: App, plugin: PostlyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "postly publisher" });

    new Setting(containerEl)
      .setName("Repository owner")
      .addText((t) => t.setValue(this.plugin.settings.owner).onChange(async (v) => {
        this.plugin.settings.owner = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Repository")
      .setDesc("The postly content repository (engine + blog/ + pages/).")
      .addText((t) => t.setValue(this.plugin.settings.repo).onChange(async (v) => {
        this.plugin.settings.repo = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Branch")
      .addText((t) => t.setValue(this.plugin.settings.branch).onChange(async (v) => {
        this.plugin.settings.branch = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Target directory")
      .setDesc('Where notes land in the repo, e.g. "blog" for posts.')
      .addText((t) => t.setValue(this.plugin.settings.targetDir).onChange(async (v) => {
        this.plugin.settings.targetDir = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("GitHub token")
      .setDesc("Fine-grained PAT with Contents read/write on the repo only.")
      .addText((t) => {
        t.setValue(this.plugin.settings.token);
        t.inputEl.type = "password";
        t.onChange(async (v) => {
          this.plugin.settings.token = v;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Strip frontmatter")
      .setDesc("The blog never depends on frontmatter; keep it vault-local.")
      .addToggle((tg) => tg.setValue(this.plugin.settings.stripFrontmatter).onChange(async (v) => {
        this.plugin.settings.stripFrontmatter = v;
        await this.plugin.saveSettings();
      }));
  }
}
