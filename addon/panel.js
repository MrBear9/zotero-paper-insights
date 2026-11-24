var PaperPanel = class {
  constructor(reader, doc) {
    this.reader = reader;
    this.doc = doc;
    this.button = this.el("button");
    // The reader marks its toolbar as a window drag region. The native button
    // class excludes this hit area even before the panel stylesheet is loaded.
    this.button.className = "toolbar-button paper-insights-toggle";
    this.button.title = "论文总结";
    this.button.setAttribute("aria-label", "论文总结");
    this.button.setAttribute("aria-controls", "paper-insights");
    this.button.setAttribute("aria-expanded", "false");
    const icon = this.el("img");
    icon.width = icon.height = 20;
    icon.alt = "";
    icon.draggable = false;
    icon.style.pointerEvents = "none";
    toolbarIcon.then(uri => { icon.src = uri; }).catch(e => Zotero.logError(e));
    this.button.append(icon);
    this.button.addEventListener("click", () => this.toggle());
  }

  el(tag, text) {
    const node = this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (text !== undefined) node.textContent = text;
    if (tag === "button") node.type = "button";
    return node;
  }

  action(label, handler) {
    const b = this.el("button", label);
    b.addEventListener("click", handler);
    return b;
  }

  get item() { return Zotero.Items.get(this.reader.itemID); }

  mountDivider() {
    const pref = "extensions.zotero.paperInsights.panelWidth";
    const body = this.doc.body, win = this.doc.defaultView;
    const divider = this.divider = this.el("div");
    divider.className = "pi-divider";
    divider.tabIndex = 0;
    divider.title = "左右拖动调整总结面板宽度";
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-label", "总结面板宽度");
    divider.setAttribute("aria-controls", "paper-insights");
    divider.setAttribute("aria-orientation", "vertical");
    const saved = Services.prefs.getIntPref(pref, 0);
    if (saved > 0) body.style.setProperty("--pi-preferred-width", saved + "px");
    const width = () => this.box.getBoundingClientRect().width;
    const direction = () => win.getComputedStyle(body).direction === "rtl" ? 1 : -1;
    const set = value => {
      const px = Math.round(Math.max(270, Math.min(win.innerWidth * 0.65, value)));
      body.style.setProperty("--pi-preferred-width", px + "px");
    };
    const remember = () => Services.prefs.setIntPref(pref, Math.round(width()));
    let drag;
    divider.addEventListener("pointerdown", e => {
      if (e.button !== 0 || drag) return;
      divider.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, width: width() };
      body.classList.add("pi-resizing");
      e.preventDefault();
    });
    divider.addEventListener("pointermove", e => {
      if (drag?.id === e.pointerId) set(drag.width + direction() * (e.clientX - drag.x));
    });
    divider.addEventListener("lostpointercapture", () => {
      if (drag && !this.box.hidden) remember();
      drag = null;
      body.classList.remove("pi-resizing");
    });
    divider.addEventListener("keydown", e => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      set(width() + (e.key === "ArrowRight" ? 24 : -24) * direction());
      remember();
    });
    this.widthObserver = new win.ResizeObserver(() => {
      divider.setAttribute("aria-valuemin", "270");
      divider.setAttribute("aria-valuemax", String(Math.round(win.innerWidth * 0.65)));
      divider.setAttribute("aria-valuenow", String(Math.round(width())));
    });
    this.widthObserver.observe(this.box);
    body.append(divider);
  }

  modelPicker(field, fetchModels, useDefault = false) {
    const label = this.el("label", "选择模型");
    const list = this.el("select");
    list.size = 4;
    label.append(list);
    const hint = this.el("small");
    hint.setAttribute("role", "status");
    let revision = 0, requested = false;
    const sync = () => {
      list.selectedIndex = Array.from(list.options).findIndex(o => o.value === field.value.trim());
    };
    const render = ids => {
      const values = useDefault ? ["", ...ids] : ids;
      list.replaceChildren(...values.map(id => {
        const option = this.el("option", id || "自动（CLI 默认）");
        option.value = id;
        return option;
      }));
      list.hidden = !values.length;
      sync();
    };
    const reset = () => { revision++; requested = false; render([]); hint.textContent = ""; };
    const load = async (force = false) => {
      if (requested && !force) return;
      requested = true;
      const ticket = ++revision;
      hint.textContent = "正在读取模型列表…";
      try {
        const ids = await fetchModels();
        if (ticket !== revision) return;
        render(ids);
        hint.textContent = ids.length ? "" : "没有可列出的模型，可手动输入模型 ID。";
      } catch (e) {
        if (ticket === revision) { render([]); hint.textContent = e.message; }
      }
    };
    field.addEventListener("input", sync);
    list.addEventListener("change", () => { if (list.selectedIndex >= 0) field.value = list.value; });
    const refresh = this.action("刷新模型列表", () => load(true));
    field.parentNode.before(label, refresh, hint);
    reset();
    return { reset, load };
  }

  toggle(open = !this.box || this.box.hidden) {
    try {
      if (!this.box) this.mount();
      if (!open && this.claimMenu.matches(":popover-open")) this.claimMenu.hidePopover();
      this.box.hidden = !open;
      this.doc.body.classList.toggle("paper-insights-open", open);
      this.button.setAttribute("aria-expanded", String(open));
      this.button.classList.toggle("active", open);
      if (open && !this.job) {
        const saved = Evidence.saved(this.item);
        this.display(Evidence.combined(saved, this.sessionRecords || []));
        const stale = Evidence.trashedMarkKeys(this.item);
        if (stale.length) this.reader.unsetAnnotations(stale).catch(e => Zotero.logError(e));
        this.refreshTask();
      }
    } catch (error) { Zotero.logError(error); if (this.status) this.status.textContent = error.message; }
  }

  mount() {
    const el = (tag, text) => this.el(tag, text);
    const sheet = this.sheet = el("style");
    readerStyles.then(css => { sheet.textContent = css; }).catch(e => Zotero.logError(e));
    this.doc.head.append(sheet);
    const box = this.box = el("aside");
    box.id = "paper-insights";
    box.setAttribute("aria-label", "论文重点总结");
    const header = el("header");
    header.append(el("h2", "论文重点总结"), this.action("收起", () => this.toggle(false)));
    const config = this.config = el("details");
    config.append(el("summary", "模型与标注设置"));
    const local = loadSettings();
    const control = (parent, label, name, value, type = "text") => {
      const wrap = el("label", label);
      const field = el("input");
      field.type = type; field.value = value; field.name = name;
      field.autocomplete = "off"; wrap.append(field); parent.append(wrap);
      return field;
    };
    const radio = (parent, group, value, title, selected) => {
      const label = el("label");
      const input = el("input"); input.type = "radio"; input.name = "pi-" + group;
      input.value = value; input.checked = value === selected;
      label.append(input, this.doc.createTextNode(title)); parent.append(label); return input;
    };
    const engines = el("fieldset");
    engines.append(el("legend", "总结方式"));
    const codex = radio(engines, "engine", "codex", "Codex CLI", local.engine);
    radio(engines, "engine", "api", "模型 API", local.engine);
    const cli = el("div"), api = el("div");
    const model = control(cli, "所选模型 ID（可修改）", "codexModel", local.codexModel);
    model.placeholder = "自动（CLI 默认）";
    const exe = control(cli, "Codex 可执行文件", "codexPath", local.codexPath);
    exe.placeholder = "留空自动查找";
    const endpoint = control(api, "API 地址（含版本路径）", "endpoint", local.endpoint);
    endpoint.placeholder = "https://服务地址/v1";
    const secret = control(api, "API Key（本次 Zotero 会话）", "apiKey", "", "password");
    const apiModel = control(api, "所选模型 ID（可修改）", "apiModel", local.apiModel);
    const cliPicker = this.modelPicker(model, () => PaperModels.listModels(exe.value.trim()), true);
    const apiPicker = this.modelPicker(apiModel, () => {
      if (!endpoint.value.trim()) throw new Error("请先填写 API 地址以获取模型列表。");
      return PaperModels.listAPIModels(endpoint.value, secret.value.trim());
    });
    const restoreKey = () => {
      try { secret.value = keys.get(PaperModels.endpoint(endpoint.value)) || ""; } catch { secret.value = ""; }
    };
    restoreKey();
    endpoint.addEventListener("input", restoreKey);
    const updateEngine = () => {
      cli.hidden = !codex.checked; api.hidden = codex.checked;
      if (config.open) (codex.checked ? cliPicker : apiPicker).load();
    };
    for (const [field, picker] of [[exe, cliPicker], [endpoint, apiPicker], [secret, apiPicker]]) {
      field.addEventListener("input", picker.reset);
      field.addEventListener("change", () => { picker.reset(); updateEngine(); });
    }
    config.addEventListener("toggle", updateEngine);
    engines.addEventListener("change", updateEngine); updateEngine();
    const style = el("fieldset"); style.append(el("legend", "原文标注"));
    const highlight = radio(style, "mark", "highlight", "高亮", local.mark);
    radio(style, "mark", "underline", "下划线", local.mark);
    this.settings = () => ({ engine: codex.checked ? "codex" : "api", codexModel: model.value.trim(),
      codexPath: exe.value.trim(), endpoint: endpoint.value.trim(), apiModel: apiModel.value.trim(),
      mark: highlight.checked ? "highlight" : "underline" });
    this.key = () => secret.value.trim();
    config.append(engines, cli, api, style, this.action("保存设置", () => {
      try { persist(this.settings(), this.key()); this.status.textContent = "设置已保存。"; }
      catch (e) { this.status.textContent = e.message; }
    }));
    const dialog = el("dialog");
    dialog.setAttribute("aria-labelledby", "pi-request-title");
    const title = el("h2", "本次总结要求");
    title.id = "pi-request-title";
    const methodLabel = el("label");
    const methods = el("input");
    methods.type = "checkbox";
    methodLabel.append(methods, this.doc.createTextNode(" 详细讲解研究方法"));
    const label = el("label", "希望这次重点讲什么？（选填）");
    const instructions = el("textarea");
    instructions.rows = 4;
    instructions.placeholder = "例如：按顺序讲解模型训练与验证，指出每一步的输入和输出，并标出对应原句。";
    label.append(instructions);
    const actions = el("div");
    const start = this.action("开始生成", () => {
      const request = { detailedMethods: methods.checked, instructions: instructions.value.trim() };
      dialog.close();
      this.run(request);
    });
    actions.append(this.action("取消", () => dialog.close()), start);
    dialog.append(title, methodLabel, label, actions);
    this.generate = this.action("生成总结并标注", () => {
      methods.checked = false;
      instructions.value = "";
      dialog.showModal();
      instructions.focus();
    });
    this.resume = this.action("继续生成", () => this.run(null, true));
    this.discard = this.action("放弃本次进度", () => this.discardTask());
    this.stop = this.action("暂停", () => this.cancel());
    this.taskInfo = el("p");
    this.taskInfo.className = "pi-status";
    this.generate.hidden = this.resume.hidden = this.discard.hidden = this.stop.hidden = this.taskInfo.hidden = true;
    this.status = el("p"); this.status.setAttribute("role", "status");
    this.status.className = "pi-status";
    this.results = el("div");
    this.claimMenu = el("div");
    this.claimMenu.className = "pi-claim-menu";
    this.claimMenu.setAttribute("popover", "auto");
    this.claimMenu.setAttribute("role", "group");
    this.claimMenu.setAttribute("aria-label", "要点操作");
    const copy = this.action("复制要点", () => {
      const { text } = this.menuClaim;
      this.claimMenu.hidePopover();
      Zotero.Utilities.Internal.copyTextToClipboard(text);
      this.status.textContent = "已复制这条要点。";
    });
    this.deleteAction = this.action("删除这条要点…", () => {
      const { section, text } = this.menuClaim;
      this.claimMenu.hidePopover();
      this.deleteSummary({ section, text });
    });
    this.claimMenu.append(copy, this.deleteAction);
    this.clearSummary = this.action("清除本篇总结…", () => this.deleteSummary(null));
    const summaryActions = el("div");
    summaryActions.className = "pi-summary-actions";
    summaryActions.append(this.generate, this.clearSummary);
    box.append(this.claimMenu);
    box.append(header, config, this.taskInfo, this.resume, this.discard, this.stop, summaryActions, dialog, this.status, this.results);
    this.doc.body.append(box);
    this.mountDivider();
  }

  display(records) {
    if (this.claimMenu.matches(":popover-open")) this.claimMenu.hidePopover();
    this.results.replaceChildren();
    this.clearSummary.hidden = !records.length;
    this.clearReadOnly = this.reader._isReadOnly() && records.some(r => r.annotationID);
    this.clearSummary.disabled = this.clearReadOnly || jobs.has(this.item.id);
    this.generate.textContent = records.length ? "按新要求补充总结" : "生成总结并标注";
    if (!records.length) {
      this.status.textContent = "生成时会将当前 PDF 的可定位文字发送给所选模型。";
      return;
    }
    this.status.textContent = "点击要点定位原文，右键可复制或删除要点。";
    for (const section of Evidence.sections) {
      const grouped = new Map();
      for (const record of records) {
        for (const claim of record.claims.filter(c => c.section === section)) {
          if (!grouped.has(claim.text)) grouped.set(claim.text, []);
          const refs = grouped.get(claim.text);
          if (!refs.includes(record)) refs.push(record);
        }
      }
      if (!grouped.size) continue;
      const block = this.el("section");
      block.append(this.el("h3", section));
      const go = async record => {
        try { await this.reader.navigate({ position: record.position }); }
        catch { this.status.textContent = "无法定位该批注，请重新打开 PDF。"; }
      };
      for (const [text, refs] of grouped) {
        const jump = this.action(text, () => go(refs[0]));
        jump.className = "pi-claim";
        const row = this.el("div");
        row.className = "pi-claim-row";
        const more = this.action("⋯", () => {
          const r = more.getBoundingClientRect();
          show(r.left, r.bottom);
        });
        more.className = "pi-more";
        more.title = "要点操作";
        more.setAttribute("aria-label", "要点操作");
        const show = (x, y) => {
          this.menuClaim = { section, text };
          this.deleteAction.disabled = jobs.has(this.item.id) || (this.reader._isReadOnly() && refs.some(r => r.annotationID));
          const menu = this.claimMenu;
          if (!menu.matches(":popover-open")) menu.showPopover();
          const bounds = menu.getBoundingClientRect();
          const w = this.doc.defaultView;
          menu.style.left = Math.max(0, Math.min(x, w.innerWidth - bounds.width)) + "px";
          menu.style.top = Math.max(0, Math.min(y, w.innerHeight - bounds.height)) + "px";
        };
        const secondary = e => {
          if (e.type === "pointerup" && e.button !== 2) return;
          e.preventDefault();
          e.stopPropagation();
          const r = jump.getBoundingClientRect();
          show(e.clientX || r.left, e.clientY || r.bottom);
        };
        row.addEventListener("contextmenu", secondary, true);
        row.addEventListener("pointerup", secondary, true);
        const sources = this.el("details"); sources.className = "pi-sources";
        sources.append(this.el("summary", "原文依据 · " + refs.length + " 处"));
        for (const record of refs) {
          const link = this.action("第 " + record.pageLabel + " 页　" + record.text, () => go(record));
          sources.append(link);
        }
        row.append(jump, more, sources);
        block.append(row);
      }
      this.results.append(block);
    }
  }

  async deleteSummary(target) {
    const item = this.item;
    if (jobs.has(item.id)) return;
    const readOnly = this.reader._isReadOnly();
    const matches = c => !target || (c.section === target.section && c.text === target.text);
    if (readOnly && Evidence.saved(item).some(r => r.claims.some(matches))) return;
    const title = target ? "删除这条要点" : "清除本篇总结";
    const message = readOnly ? "清除当前窗口中选定的总结内容？" :
      (target ? "删除这条要点及其专用高亮或下划线？其他要点共用的批注会保留。" :
        "清除当前 PDF 的全部总结要点，以及关联的全部总结高亮和下划线？单独创建的手工批注会保留。")
      + "\n相关总结批注会连同附加的评论和标签移入 Zotero 回收站。";
    if (!Services.prompt.confirm(this.reader._window, title, message + (target ? "\n\n" + target.text : "")) || jobs.has(item.id)) return;
    jobs.set(item.id, {});
    this.refreshReaders(item);
    try {
      const trashed = readOnly ? [] : await Evidence.removeClaims(item, target);
      // Zotero refreshes reader highlights on permanent deletion, but not on trash.
      const updates = trashed.length ? await Promise.allSettled(Zotero.Reader._readers
        .filter(r => r.itemID === item.id).map(r => r.unsetAnnotations(trashed))) : [];
      for (const panel of panels.values()) {
        if (!panel.box || panel.reader.itemID !== item.id) continue;
        if (panel.sessionRecords && (panel === this || !readOnly)) {
          panel.sessionRecords = panel.sessionRecords.map(r => ({ ...r,
            claims: r.claims.filter(c => !matches(c)) })).filter(r => r.claims.length);
        }
        panel.display(Evidence.combined(Evidence.saved(item), panel.sessionRecords || []));
      }
      this.status.textContent = (target ? "已删除这条要点。" : "已清除本篇总结。")
        + (trashed.length ? "已移除 " + trashed.length + " 处原文批注。" : "")
        + (updates.some(r => r.status === "rejected") ? "部分阅读窗口刷新失败，请重新打开该 PDF。" : "");
    } catch (error) { this.status.textContent = error.message; }
    finally { jobs.delete(item.id); this.refreshReaders(item); }
  }

  async refreshTask() {
    const ticket = this.refreshTicket = (this.refreshTicket || 0) + 1;
    const active = jobs.has(this.item.id);
    this.clearSummary.disabled = active || this.clearReadOnly;
    this.generate.hidden = this.resume.hidden = this.discard.hidden = true;
    this.stop.hidden = !this.job;
    this.taskInfo.hidden = true;
    if (active) {
      if (!this.job) {
        this.taskInfo.textContent = "这份 PDF 的任务正在另一个窗口中处理。";
        this.taskInfo.hidden = false;
      }
      return;
    }
    try {
      const task = await PaperProgress.read(this.item);
      if (ticket !== this.refreshTicket || this.disposed) return;
      this.generate.hidden = !!task;
      this.resume.hidden = this.discard.hidden = !task;
      if (task) {
        const s = task.settings;
        const model = s.engine === "api" ? s.apiModel : s.codexModel || "CLI 默认模型";
        const service = s.engine === "api" ? " · " + s.endpoint : "";
        this.taskInfo.textContent = "待继续 · " + model + service + " · " + (task.lastStep ? "上次完成：" + task.lastStep : "等待完成第一段");
        this.taskInfo.hidden = false;
      }
    } catch (error) {
      if (ticket !== this.refreshTicket || this.disposed) return;
      this.discard.hidden = false;
      this.taskInfo.hidden = false;
      this.taskInfo.textContent = error.message;
    }
  }

  refreshReaders(item) {
    for (const panel of panels.values()) {
      if (panel.box && !panel.disposed && panel.reader.itemID === item.id) panel.refreshTask();
    }
  }

  async discardTask() {
    const item = this.item;
    if (jobs.has(item.id) || !Services.prompt.confirm(Zotero.getMainWindow(), "放弃本次进度", "放弃这次未完成的总结？已写入的文献批注会保留。")) return;
    if (jobs.has(item.id)) return;
    jobs.set(item.id, {});
    this.refreshReaders(item);
    try {
      await PaperProgress.clear(item);
      this.status.textContent = "已放弃本次进度，可重新生成。";
    } catch (error) { this.status.textContent = error.message; }
    finally { jobs.delete(item.id); this.refreshReaders(item); }
  }

  async run(request, resume = false) {
    const item = this.item;
    if (jobs.has(item.id)) { this.status.textContent = "此 PDF 已在生成总结。"; return; }
    const job = this.job = { stopped: false, cancel: null, check() {
      if (this.stopped) throw new Error("已停止生成。");
    } };
    jobs.set(item.id, job);
    this.stop.disabled = false;
    this.refreshReaders(item);
    const progress = msg => { this.status.textContent = msg; };
    try {
      let task = await PaperProgress.read(item);
      if (resume && !task) { progress("这份 PDF 已没有待继续的任务。"); return; }
      if (!resume && task) { progress("已有未完成的任务，请点击继续生成。"); return; }
      const current = this.settings();
      if (!task) {
        persist(current, this.key());
        const { engine, mark, endpoint, apiModel, codexPath, codexModel } = current;
        const settings = engine === "api" ? { engine, mark, endpoint, apiModel } : { engine, mark, codexPath, codexModel };
        task = { version: 1, settings, request: request || {}, steps: [] };
        await PaperProgress.write(item, task);
      }
      const settings = task.settings;
      let key = "";
      if (settings.engine === "api") {
        const endpoint = PaperModels.endpoint(settings.endpoint);
        let same = false;
        try { same = endpoint === PaperModels.endpoint(current.endpoint); } catch {}
        key = (same && this.key()) || keys.get(endpoint) || "";
      }
      job.check();
      const { sources, empty } = await Evidence.extract(this.reader, progress, () => job.check());
      const claims = await Evidence.summarize(sources,
        (prompt, data) => PaperModels.ask(settings, key, prompt, data, job), progress, task.request,
        { task, check: () => job.check(), save: () => PaperProgress.write(item, task) });
      job.check();
      const records = Evidence.marks(claims, sources);
      const readOnly = this.reader._isReadOnly();
      if (readOnly) this.sessionRecords = Evidence.combined(this.sessionRecords || [], records);
      else {
        progress("正在保存原文批注…");
        await Evidence.save(item, records, settings.mark, () => job.check());
      }
      await PaperProgress.clear(item);
      this.display(Evidence.combined(Evidence.saved(item), this.sessionRecords || []));
      progress("已生成 " + claims.length + " 条要点，关联 " + records.length + " 处原文。"
        + (empty ? "有 " + empty + " 页缺少可定位文字。" : "")
        + (readOnly ? "当前 PDF 为只读，总结仅在此阅读窗口显示。" : ""));
    } catch (e) {
      progress(job.stopped ? "已暂停。" : (e.message || String(e)));
    } finally {
      jobs.delete(item.id); this.job = null;
      this.refreshReaders(item);
    }
  }

  cancel() {
    if (this.job) {
      this.job.stopped = true;
      this.stop.disabled = true;
      this.status.textContent = "正在暂停…";
      this.job.cancel?.();
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    this.widthObserver?.disconnect();
    this.divider?.remove();
    this.doc.body?.classList.remove("paper-insights-open", "pi-resizing");
    this.doc.body?.style.removeProperty("--pi-preferred-width");
    this.button.remove(); this.box?.remove(); this.sheet?.remove();
  }
};
