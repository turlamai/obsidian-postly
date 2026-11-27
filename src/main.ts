// postly publisher — a deliberately thin Obsidian plugin.
//
// It does exactly one thing: push the current note's pure Markdown to a
// GitHub repository (the postly content repo). All rendering happens in the
// postly engine on the build side; the plugin never transforms content
// beyond two normalizations that keep the file editor-neutral:
//   1. strip YAML frontmatter (the vault may use it; the blog does not)
//   2. ensure the title: if the body has no H1, one is derived from the file
//      name so the engine's title rule has something to find.

import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl } from "obsidian";

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
      const prepared = await this.prepareAssets(this.normalize(view.editor.getValue(), file.name), sourcePath);
      const accepted = await new Promise<boolean>(resolve => {
        new PublishConfirmModal(this.app, path, Boolean(existing), prepared.assets.map(a => a.source), resolve).open();
      });
      if (!accepted) return;
      if (file.path !== sourcePath) throw new Error("Note moved during confirmation; retry publication");
      const result = await this.putContents(path, prepared.body, prepared.assets, settings, settings.publishedShas?.[key], Boolean(existing));
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

  // Initial attachment support: standalone Obsidian image embeds outside fenced code.
  // Never traverse linked notes or upload unsupported file types.
  private async prepareAssets(body: string, sourcePath: string): Promise<{body: string; assets: PublicAsset[]}> {
    const assets = new Map<string, PublicAsset>();
    const lines = body.split("\n");
    let fence: string | undefined;
    let total = 0;
    for (let i = 0; i < lines.length; i++) {
      const marker = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
        continue;
      }
      if (fence) continue;
      const match = lines[i].match(/^ {0,3}!\[\[([^\]#|]+)(?:\|([^\]]+))?\]\]\s*$/);
      if (!match) continue;
      const target = this.app.metadataCache.getFirstLinkpathDest(match[1], sourcePath);
      if (!(target instanceof TFile) || !/^(png|jpe?g|gif|webp|avif)$/i.test(target.extension)) {
        throw new Error("Unsupported or missing standalone image embed: " + match[1]);
      }
      if (target.stat.size > 10 * 1024 * 1024) throw new Error("Image exceeds 10 MiB: " + target.path);
      const bytes = new Uint8Array(await this.app.vault.readBinary(target));
      if (bytes.length > 10 * 1024 * 1024) throw new Error("Image exceeds 10 MiB: " + target.path);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
      const path = "assets/" + digest + "." + target.extension.toLowerCase();
      if (!assets.has(path)) {
        total += bytes.length;
        if (total > 30 * 1024 * 1024) throw new Error("Total images exceed 30 MiB");
        assets.set(path, {path, source: target.path, content: encodeBytes(bytes)});
      }
      lines[i] = "![](/" + path + ")";
    }
    return {body: lines.join("\n"), assets: Array.from(assets.values())};
  }

  /** Publish article and assets in one non-forced Git ref update. */
  private async putContents(path: string, content: string, assets: PublicAsset[], settings: PostlySettings, expectedSha: string | undefined, known: boolean): Promise<{ sha: string; url?: string }> {
    const { owner, repo, branch, token } = settings;
    const base = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
    const headers = {Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"};
    const api = async (method: string, suffix: string, body?: unknown) => {
      const response = await requestUrl({url: base + suffix, method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}), throw: false});
      if (response.status < 200 || response.status >= 300) throw new Error("GitHub " + method + " " + response.status);
      return response.json;
    };
    const ref = branch.split("/").map(encodeURIComponent).join("/");
    const parent = (await api("GET", "/git/ref/heads/" + ref)).object.sha;
    const tree = (await api("GET", "/git/commits/" + parent)).tree.sha;
    const snapshot = await api("GET", "/git/trees/" + tree + "?recursive=1");
    if (snapshot.truncated) throw new Error("Repository tree too large to verify safely");
    const entries = new Map<string, {sha: string; type: string; mode: string}>();
    for (const entry of snapshot.tree) entries.set(entry.path, entry);
    const current = entries.get(path);
    if (known ? !current || current.type !== "blob" || current.mode !== "100644" || !expectedSha || current.sha !== expectedSha : Boolean(current)) {
      throw new Error("Remote article conflicts with the recorded publication");
    }
    const changes: {path: string; mode: string; type: string; sha: string}[] = [];
    const stage = async (target: string, encoded: string, immutable: boolean) => {
      const blob = await api("POST", "/git/blobs", {content: encoded, encoding: "base64"});
      const previous = entries.get(target);
      if (previous && (previous.type !== "blob" || previous.mode !== "100644" || (immutable && previous.sha !== blob.sha))) {
        throw new Error("Unexpected existing asset: " + target);
      }
      if (previous?.sha !== blob.sha) changes.push({path: target, mode: "100644", type: "blob", sha: blob.sha});
      return blob.sha as string;
    };
    for (const asset of assets) await stage(asset.path, asset.content, true);
    const sha = await stage(path, encodeBytes(new TextEncoder().encode(content)), false);
    if (!changes.length) return {sha};
    const nextTree = await api("POST", "/git/trees", {base_tree: tree, tree: changes});
    const commit = await api("POST", "/git/commits", {message: "postly: publish " + path, tree: nextTree.sha, parents: [parent]});
    await api("PATCH", "/git/refs/heads/" + ref, {sha: commit.sha, force: false});
    return {sha, url: "https://github.com/" + owner + "/" + repo + "/commit/" + commit.sha};
  }
}

interface PublicAsset { path: string; source: string; content: string; }

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

class PublishConfirmModal extends Modal {
  private accepted = false;
  constructor(app: App, private path: string, private update: boolean, private assets: string[], private resolve: (value: boolean) => void) {
    super(app);
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: this.update ? "Update public article?" : "Publish public article?" });
    this.contentEl.createEl("p", { text: this.path });
    this.contentEl.createEl("p", { text: "The current note will be sent to GitHub. Review its contents before publishing. Only listed standalone image embeds are included." });
    if (this.assets.length) {
      const list = this.contentEl.createEl("ul");
      for (const source of this.assets) list.createEl("li", {text: source});
    }
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
