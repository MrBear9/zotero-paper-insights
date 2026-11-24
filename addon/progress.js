/* One local task per attachment. Keep validated model outputs, not the PDF text. */
var PaperProgress = {
  path(item) {
    return PathUtils.join(Zotero.DataDirectory.dir, "paper-insights-progress", item.libraryID + "-" + item.key + ".json");
  },
  async read(item) {
    const path = this.path(item);
    if (!await IOUtils.exists(path)) return null;
    const task = await IOUtils.readJSON(path);
    if (task?.version !== 1 || !Array.isArray(task.steps) || !["api", "codex"].includes(task.settings?.engine)) {
      throw new Error("无法读取这份 PDF 的任务进度，可放弃该进度后重新生成。");
    }
    return task;
  },
  async write(item, task) {
    const path = this.path(item);
    await IOUtils.makeDirectory(PathUtils.parent(path), { ignoreExisting: true });
    await IOUtils.writeJSON(path, task, { tmpPath: path + ".tmp" });
  },
  async clear(item) {
    await IOUtils.remove(this.path(item), { ignoreAbsent: true });
  },
};
