/* global Zotero, PaperModels, Evidence, PaperPanel */
const settingsPref = "extensions.zotero.paperInsights.settings";
const keys = new Map();
const panels = new Map();
const jobs = new Map();
let readerStyles;
let toolbarIcon;

function install() {}
function uninstall() {}

function startup({ id, rootURI }) {
  readerStyles = Zotero.File.getResourceAsync(rootURI + "reader.css");
  toolbarIcon = Zotero.File.getResourceAsync(rootURI + "icons/summary.svg")
    .then(svg => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
  for (const name of ["models", "evidence", "progress", "panel"]) {
    Services.scriptloader.loadSubScriptWithOptions(rootURI + name + ".js", { target: globalThis, ignoreCache: true });
  }
  Zotero.Reader.registerEventListener("renderToolbar", toolbar, id);
}

function toolbar({ reader, doc, append }) {
  if (reader.type !== "pdf") return;
  let panel = panels.get(doc);
  if (!panel) {
    panel = new PaperPanel(reader, doc);
    panels.set(doc, panel);
    doc.defaultView.addEventListener("unload", () => {
      panel.dispose();
      panels.delete(doc);
    }, { once: true });
  }
  append(panel.button);
}

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(Services.prefs.getStringPref(settingsPref, "{}")); } catch {}
  return { engine: "codex", codexPath: "", codexModel: "", apiModel: "", endpoint: "", mark: "highlight", ...saved };
}

function persist(settings, key) {
  if (settings.engine === "api") {
    const endpoint = PaperModels.endpoint(settings.endpoint);
    if (!settings.apiModel) throw new Error("请填写 API 模型 ID。");
    if (/[\r\n]/.test(key)) throw new Error("API Key 格式有误。");
    keys.set(endpoint, key);
  }
  Services.prefs.setStringPref(settingsPref, JSON.stringify(settings));
}

function shutdown() {
  Zotero.Reader.unregisterEventListener("renderToolbar", toolbar);
  for (const panel of panels.values()) panel.dispose();
  panels.clear();
  keys.clear();
}
