// postly publisher — a deliberately thin Obsidian plugin.
//
// It does exactly one thing: push the current note's pure Markdown to a
// GitHub repository (the postly content repo). All rendering happens in the
// postly engine on the build side; the plugin never transforms content
// beyond two normalizations that keep the file editor-neutral:
//   1. strip YAML frontmatter (the vault may use it; the blog does not)
//   2. ensure the title: if the body has no H1, one is derived from the file
//      name so the engine's title rule has something to find.

import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from "obsidian";

interface PostlySettings {
  owner: string;
  repo: string;
  branch: string;
  /** Directory in the content repo the note is pushed to, e.g. "blog". */
  targetDir: string;
  token: string;
  stripFrontmatter: boolean;
  publishedPaths?: Record<string, string>;
  publishedShas?: Record<string, string>;
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

  private publishing = false;

  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "push-current-note",
      name: "Push current note to postly blog",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || this.publishing) return false;
        if (!checking) void this.pushCurrentNote(view);
        return true;
      },
    });
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      void this.reconcileRename(oldPath, file.path).catch(() => {
        new Notice("postly: could not save renamed publication mapping");
      });
    }));
    this.addSettingTab(new PostlySettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async reconcileRename(oldPath: string, newPath: string) {
    const paths = { ...this.settings.publishedPaths };
    const shas = { ...this.settings.publishedShas };
    let changed = false;
    for (const key of Object.keys(paths)) {
      const parts = JSON.parse(key) as string[];
      const source = parts[4];
      if (source !== oldPath && !source.startsWith(oldPath + "/")) continue;
      parts[4] = newPath + source.slice(oldPath.length);
      const replacement = JSON.stringify(parts);
      if (paths[replacement] !== undefined) {
        new Notice("postly: rename conflicts with another publication mapping");
        continue;
      }
      paths[replacement] = paths[key];
      if (shas[key]) shas[replacement] = shas[key];
      delete paths[key];
      delete shas[key];
      changed = true;
    }
    if (changed) {
      this.settings.publishedPaths = paths;
      this.settings.publishedShas = shas;
      await this.saveSettings();
    }
  }

  private async pushCurrentNote(view: MarkdownView) {
    const file = view.file;
    if (!file) return;
    if (!this.settings.owner || !this.settings.repo || !this.settings.token) {
      new Notice("postly: set owner / repo / token in settings first");
      return;
    }
    if (this.publishing) return;
    this.publishing = true;
    try {
      const settings = { ...this.settings };
      const dir = settings.targetDir.replace(/^\/+|\/+$/g, "");
      if (dir.split("/").some(part => !part || part === "." || part === "..")) {
        throw new Error("Invalid target directory");
      }
      const sourcePath = file.path;
      const key = JSON.stringify([settings.owner, settings.repo, settings.branch, dir, sourcePath]);
      const existing = settings.publishedPaths?.[key];
      const now = new Date();
      const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      const name = /^\d{4}-\d{2}-\d{2}-/.test(file.name) ? file.name : date + "-" + file.name;
      const path = existing ?? dir + "/" + name;
      const body = this.normalize(view.editor.getValue(), file.name);
      const accepted = await new Promise<boolean>(resolve => {
        new PublishConfirmModal(this.app, path, Boolean(existing), resolve).open();
      });
      if (!accepted) return;
      if (file.path !== sourcePath) throw new Error("Note moved during confirmation; retry publication");
      const result = await this.putContents(path, body, settings, settings.publishedShas?.[key], Boolean(existing));
      const currentKey = JSON.stringify([settings.owner, settings.repo, settings.branch, dir, file.path]);
      this.settings.publishedPaths = { ...this.settings.publishedPaths, [currentKey]: path };
      this.settings.publishedShas = { ...this.settings.publishedShas, [currentKey]: result.sha };
      await this.saveSettings();
      new Notice(`postly: committed ✓ ${result.url ?? ""} (site deployment not verified)`);
    } catch (e) {
      new Notice(`postly: push failed — ${String(e)}`);
    } finally {
      this.publishing = false;
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
  private async putContents(path: string, content: string, settings: PostlySettings, expectedSha: string | undefined, known: boolean): Promise<{ sha: string; url?: string }> {
    const { owner, repo, branch, token } = settings;
    const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };

    let sha: string | undefined;
    const get = await requestUrl({ url: `${api}?ref=${encodeURIComponent(branch)}`, headers, throw: false });
    if (get.status === 200) {
      if (!known) throw new Error("Remote path already exists; refusing to overwrite an untracked article");
      sha = get.json?.sha;
      if (get.json?.type !== "file" || typeof sha !== "string" || !sha) throw new Error("Remote path is not a file");
      if (!expectedSha || sha !== expectedSha) throw new Error("Remote article changed or has no recorded revision; refusing to overwrite");
    }
    else if (get.status !== 404) throw new Error(`GitHub GET ${get.status}`);
    else if (known) throw new Error("Previously published article is missing remotely; refusing to recreate it automatically");

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
      const savedSha = put.json?.content?.sha;
      if (typeof savedSha !== "string" || !savedSha) throw new Error("Commit response lacks content revision; check GitHub before retrying");
      return { sha: savedSha, url: put.json?.commit?.html_url };
    }
    throw new Error(`GitHub PUT ${put.status}: ${put.text?.slice(0, 200)}`);
  }
}

class PublishConfirmModal extends Modal {
  private accepted = false;
  constructor(app: App, private path: string, private update: boolean, private resolve: (value: boolean) => void) {
    super(app);
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: this.update ? "Update public article?" : "Publish public article?" });
    this.contentEl.createEl("p", { text: this.path });
    this.contentEl.createEl("p", { text: "The current note will be sent to GitHub. Review its contents before publishing. Attachments are not yet synchronized." });
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton(b => b.setButtonText("Publish").setCta().onClick(() => { this.accepted = true; this.close(); }));
  }
  onClose() {
    this.contentEl.empty();
    this.resolve(this.accepted);
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
