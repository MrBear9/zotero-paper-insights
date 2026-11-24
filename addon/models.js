var PaperModels = {
  async readPipe(pipe, limit) {
    let out = "", part;
    while ((part = await pipe.readString())) out = (out + part).slice(-limit);
    return out;
  },

  async listModels(configured) {
    const visible = catalog => [...new Set(catalog.models.filter(m => m.visibility === "list" && typeof m.slug === "string" && m.slug)
      .sort((a, b) => a.priority - b.priority).map(m => m.slug))];
    // The desktop app may share its cache with a different CLI version.
    try {
      const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
      const command = await this.executable(Subprocess, configured);
      const proc = await Subprocess.call({ command, arguments: ["debug", "models", "--bundled"], stderr: "pipe", workdir: PathUtils.tempDir });
      const timer = setTimeout(() => proc.kill(), 10000);
      try {
        await proc.stdin.close();
        const [out, , status] = await Promise.all([this.readPipe(proc.stdout, 12000000), this.readPipe(proc.stderr, 4096), proc.wait()]);
        if (!status.exitCode) {
          const models = visible(JSON.parse(out));
          if (models.length) return models;
        }
      } finally { clearTimeout(timer); }
    } catch { /* Older CLIs may only have a cached catalog. */ }
    try {
      const home = Services.env.get("CODEX_HOME") ||
        PathUtils.join(Services.dirsvc.get("Home", Components.interfaces.nsIFile).path, ".codex");
      const catalog = await IOUtils.readJSON(PathUtils.join(home, "models_cache.json"));
      return visible(catalog);
    } catch {
      return [];
    }
  },

  async executable(Subprocess, configured) {
    if (configured) return configured;
    if (Zotero.isWin) {
      const roaming = Services.env.get("APPDATA");
      if (roaming) {
        const vendor = PathUtils.join(roaming, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai");
        for (const [pkg, arch] of [["codex-win32-x64", "x86_64"], ["codex-win32-arm64", "aarch64"]]) {
          for (const folder of ["bin", "codex"]) {
            const path = PathUtils.join(vendor, pkg, "vendor", arch + "-pc-windows-msvc", folder, "codex.exe");
            if (await IOUtils.exists(path)) return path;
          }
        }
      }
    }
    try { return await Subprocess.pathSearch(Zotero.isWin ? "codex.exe" : "codex"); }
    catch { throw new Error("找不到 Codex CLI，请在设置中填写 codex 可执行文件的完整路径。"); }
  },


  endpoint(input) {
    let url;
    try { url = new URL(input.trim()); } catch { throw new Error("请填写有效的 API 地址。"); }
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (!(url.protocol === "https:" || (local && url.protocol === "http:")) || url.username || url.password || url.hash || url.search) {
      throw new Error("请填写 HTTPS 接口地址。本机服务也可以使用 HTTP。");
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (!url.pathname.endsWith("/chat/completions")) url.pathname = url.pathname.replace(/\/$/, "") + "/chat/completions";
    return url.href;
  },

  async listAPIModels(input, key) {
    const url = this.endpoint(input).replace(/\/chat\/completions$/, "/models");
    if (/[\r\n]/.test(key)) throw new Error("API Key 格式有误。");
    let response;
    try {
      response = await Zotero.HTTP.request("GET", url, {
        headers: key ? { Authorization: "Bearer " + key } : {},
        responseType: "json", timeout: 15000, anon: true, followRedirects: false, errorDelayMax: 0,
      });
    } catch (error) {
      if ([401, 403].includes(error.status)) throw new Error("无法读取模型列表，请检查 API Key 或手动输入模型 ID。");
      throw new Error("读取模型列表失败" + (error.status ? "（HTTP " + error.status + "）" : "") + "。可刷新或手动输入模型 ID。");
    }
    const rows = response.response?.data;
    if (!Array.isArray(rows)) throw new Error("服务没有返回兼容的模型列表，可手动输入模型 ID。");
    return [...new Set(rows.map(row => row?.id).filter(id => typeof id === "string" && id.trim()))].sort();
  },

  async ask(settings, key, system, rows, job) {
    job.check();
    const data = JSON.stringify(rows);
    if (settings.engine === "api") {
      const endpoint = this.endpoint(settings.endpoint);
      if (!settings.apiModel.trim()) throw new Error("请填写 API 模型 ID。");
      const headers = { "Content-Type": "application/json" };
      if (key) headers.Authorization = "Bearer " + key;
      let response;
      try {
        response = await Zotero.HTTP.request("POST", endpoint, {
          headers, body: JSON.stringify({ model: settings.apiModel, messages: [
            { role: "system", content: system }, { role: "user", content: data }
          ] }), responseType: "json", timeout: 180000, followRedirects: false,
          logBodyLength: 0, errorDelayMax: 0, anon: true,
          cancellerReceiver: cancel => { job.cancel = cancel; if (job.stopped) cancel(); },
        });
      } catch (error) {
        job.check();
        throw new Error("模型 API 请求失败" + (error.status ? "（HTTP " + error.status + "）" : "") + "，请检查地址、模型 ID 和 API Key。");
      } finally { job.cancel = null; }
      job.check();
      const result = response.response?.choices?.[0]?.message?.content;
      if (typeof result !== "string") throw new Error("接口需要兼容 OpenAI Chat Completions，并返回文本。");
      return result;
    }
    const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
    const command = await this.executable(Subprocess, settings.codexPath);
    job.check();
    const args = ["exec", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only",
      "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "apps",
      "--skip-git-repo-check", "--color", "never"];
    if (settings.codexModel) args.push("--model", settings.codexModel);
    args.push("-");
    const proc = await Subprocess.call({ command, arguments: args, workdir: PathUtils.tempDir, stderr: "pipe" });
    job.cancel = () => proc.kill();
    const timer = setTimeout(job.cancel, 180000);
    try {
      if (job.stopped) proc.kill();
      const send = async () => { await proc.stdin.write(system + "\n\n" + data); await proc.stdin.close(); };
      const [out, err, status] = await Promise.all([this.readPipe(proc.stdout, 250000), this.readPipe(proc.stderr, 32000), proc.wait(), send()]);
      job.check();
      if (status.exitCode !== 0) {
        if (/model.{0,140}(?:not supported|not available|not found|does not exist)|model_not_found/i.test(err)) {
          throw new Error("当前 Codex 账号或 CLI 不支持该模型，请选择其他模型或使用 CLI 默认模型。");
        }
        if (/401|unauthorized|login required/i.test(err)) throw new Error("请先在本机运行 codex login。");
        throw new Error("Codex 调用失败，请检查所选模型、CLI 登录和网络。");
      }
      return out;
    } finally { clearTimeout(timer); job.cancel = null; }
  }
};
