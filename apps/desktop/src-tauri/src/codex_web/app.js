(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const ui = { threads: $("#threads"), newThread: $("#new-thread"), connectionDot: $("#connection-dot"), connectionLabel: $("#connection-label"), title: $("#thread-title"), workspace: $("#workspace-path"), messages: $("#messages"), empty: $("#empty-state"), approvals: $("#approvals"), composer: $("#composer"), prompt: $("#prompt"), send: $("#send"), interrupt: $("#interrupt") };
  const state = { socket: null, runtime: null, requestId: 0, pending: new Map(), threads: [], threadId: null, turnId: null, items: new Map(), connected: false, busy: false, reconnectTimer: null };

  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function setConnection(label, tone) { ui.connectionLabel.textContent = label; ui.connectionDot.dataset.tone = tone; }
  function setBusy(value) { state.busy = value; ui.send.disabled = value || !state.connected; ui.prompt.disabled = !state.connected; ui.interrupt.hidden = !value; }
  function rpc(method, params) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Codex app-server 尚未连接"));
    const id = ++state.requestId; state.socket.send(JSON.stringify({ method, id, params }));
    return new Promise((resolve, reject) => { state.pending.set(id, { resolve, reject }); window.setTimeout(() => { const pending = state.pending.get(id); if (!pending) return; state.pending.delete(id); reject(new Error(`${method} 请求超时`)); }, 30000); });
  }
  function notify(method, params) { state.socket?.send(JSON.stringify({ method, params })); }
  function threadTitle(thread) { return thread.name || thread.preview || "新任务"; }
  function formatTime(seconds) { if (!seconds) return "刚刚"; return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(seconds * 1000)); }
  function renderThreads() {
    ui.threads.replaceChildren();
    for (const thread of state.threads) { const button = element("button", "thread-row"); button.type = "button"; button.dataset.active = String(thread.id === state.threadId); button.append(element("strong", "", threadTitle(thread)), element("small", "", formatTime(thread.updatedAt))); button.addEventListener("click", () => void selectThread(thread.id)); ui.threads.append(button); }
    if (!state.threads.length) ui.threads.append(element("p", "thread-empty", "还没有 Codex 任务"));
  }
  function contentText(content) { return Array.isArray(content) ? content.filter((item) => item?.type === "text").map((item) => item.text || "").join("\n") : ""; }
  function itemLabel(item) { const labels = { commandExecution: "命令", fileChange: "文件变更", reasoning: "思考", plan: "计划", webSearch: "网页搜索" }; return labels[item.type] || (item.type === "mcpToolCall" ? `工具 · ${item.server || "MCP"}` : "执行记录"); }
  function itemText(item) {
    if (item.type === "userMessage") return contentText(item.content);
    if (item.type === "agentMessage" || item.type === "plan") return item.text || "";
    if (item.type === "reasoning") return [...(item.summary || []), ...(item.content || []), item.summaryText || ""].filter(Boolean).join("\n");
    if (item.type === "commandExecution") return [item.command, item.aggregatedOutput].filter(Boolean).join("\n\n");
    if (item.type === "fileChange") return (item.changes || []).map((change) => change.path || change.file || JSON.stringify(change)).join("\n");
    if (item.type === "mcpToolCall") return `${item.tool || "tool"}\n${JSON.stringify(item.arguments || {}, null, 2)}`;
    return item.output || item.delta || "";
  }
  function renderMessages() {
    const items = [...state.items.values()]; ui.empty.hidden = items.length > 0;
    for (const existing of [...ui.messages.querySelectorAll(".message")]) existing.remove();
    for (const item of items) { const role = item.type === "userMessage" ? "user" : item.type === "agentMessage" ? "assistant" : "activity"; const card = element("article", `message ${role}`); if (role === "activity") card.append(element("div", "message-label", itemLabel(item))); card.append(element(role === "activity" ? "pre" : "div", "message-text", itemText(item))); if (item.status) card.append(element("span", "message-status", String(item.status))); ui.messages.append(card); }
    ui.messages.scrollTop = ui.messages.scrollHeight;
  }
  function loadThreadItems(thread) { state.items.clear(); for (const turn of thread.turns || []) for (const item of turn.items || []) state.items.set(item.id || `${turn.id}-${state.items.size}`, item); renderMessages(); }
  async function refreshThreads() { const response = await rpc("thread/list", { cursor: null, limit: 60, sortKey: "updated_at", sortDirection: "desc", sourceKinds: ["cli", "vscode", "exec", "appServer"], cwd: state.runtime.workspace }); state.threads = response.data || []; renderThreads(); }
  async function selectThread(threadId) { try { const response = await rpc("thread/resume", { threadId, cwd: state.runtime.workspace }); state.threadId = response.thread.id; state.turnId = null; ui.title.textContent = threadTitle(response.thread); loadThreadItems(response.thread); renderThreads(); ui.prompt.focus(); } catch (error) { showSystemError(error); } }
  function newThread() { state.threadId = null; state.turnId = null; state.items.clear(); ui.title.textContent = "新任务"; renderThreads(); renderMessages(); ui.prompt.focus(); }
  async function ensureThread() { if (state.threadId) return state.threadId; const response = await rpc("thread/start", { cwd: state.runtime.workspace, approvalPolicy: "on-request", sandbox: "workspace-write" }); state.threadId = response.thread.id; ui.title.textContent = threadTitle(response.thread); await refreshThreads(); return state.threadId; }
  async function sendPrompt() {
    const text = ui.prompt.value.trim(); if (!text || state.busy) return;
    try { setBusy(true); const threadId = await ensureThread(); ui.prompt.value = ""; resizePrompt(); const response = await rpc("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }], cwd: state.runtime.workspace }); state.turnId = response.turn.id; }
    catch (error) { setBusy(false); showSystemError(error); }
  }
  function showSystemError(error) { const id = `error-${Date.now()}`; state.items.set(id, { id, type: "systemError", output: error?.message || String(error), status: "error" }); renderMessages(); }
  function upsertItem(item) { if (!item?.id) return; state.items.set(item.id, { ...(state.items.get(item.id) || {}), ...item }); renderMessages(); }
  function appendDelta(itemId, field, delta, fallbackType) { const item = state.items.get(itemId) || { id: itemId, type: fallbackType }; item[field] = `${item[field] || ""}${delta || ""}`; state.items.set(itemId, item); renderMessages(); }
  function showApproval(message) {
    const params = message.params || {}; const card = element("article", "approval-card"); card.append(element("strong", "", message.method.includes("fileChange") ? "允许文件变更？" : "允许运行命令？"), element("pre", "", params.command || params.reason || params.grantRoot || "Codex 请求额外权限")); const actions = element("div", "approval-actions");
    const respond = (decision) => { state.socket?.send(JSON.stringify({ id: message.id, result: { decision } })); card.remove(); };
    for (const [label, decision, kind] of [["拒绝", "decline", "quiet"], ["本次会话允许", "acceptForSession", "quiet"], ["允许一次", "accept", "primary"]]) { const button = element("button", kind, label); button.addEventListener("click", () => respond(decision)); actions.append(button); }
    card.append(actions); ui.approvals.append(card);
  }
  function showUserInput(message) {
    const card = element("form", "approval-card input-card"); card.append(element("strong", "", "Codex 需要你的选择")); const controls = new Map();
    for (const question of message.params?.questions || []) {
      const group = element("fieldset", "question-group"); group.append(element("legend", "", question.question || question.header)); const inputs = [];
      for (const option of question.options || []) { const label = element("label", "question-option"); const input = document.createElement("input"); input.type = "radio"; input.name = `question-${question.id}`; input.value = option.label; label.append(input, element("span", "", option.description ? `${option.label} · ${option.description}` : option.label)); group.append(label); inputs.push(input); }
      let other = null; if (!question.options || question.isOther) { other = document.createElement("input"); other.className = "question-other"; other.type = question.isSecret ? "password" : "text"; other.placeholder = question.isOther ? "其他回答" : "输入回答"; group.append(other); }
      controls.set(question.id, { inputs, other }); card.append(group);
    }
    const actions = element("div", "approval-actions"); const submit = element("button", "primary", "提交回答"); submit.type = "submit"; actions.append(submit); card.append(actions);
    card.addEventListener("submit", (event) => { event.preventDefault(); const answers = {}; for (const [id, control] of controls) { const selected = control.inputs.find((input) => input.checked)?.value; const other = control.other?.value.trim(); answers[id] = { answers: [selected, other].filter(Boolean) }; } state.socket?.send(JSON.stringify({ id: message.id, result: { answers } })); card.remove(); });
    ui.approvals.append(card);
  }
  function handleNotification(message) {
    const params = message.params || {};
    if (message.method === "item/started" || message.method === "item/completed") upsertItem(params.item);
    if (message.method === "item/agentMessage/delta") appendDelta(params.itemId, "text", params.delta, "agentMessage");
    if (message.method === "item/commandExecution/outputDelta") appendDelta(params.itemId, "aggregatedOutput", params.delta, "commandExecution");
    if (message.method === "item/reasoning/summaryTextDelta") appendDelta(params.itemId, "summaryText", params.delta, "reasoning");
    if (message.method === "turn/started") { state.turnId = params.turn?.id || null; setBusy(true); }
    if (message.method === "turn/completed") { state.turnId = null; setBusy(false); for (const item of params.turn?.items || []) upsertItem(item); void refreshThreads(); }
    if (message.method === "error") showSystemError(new Error(params.error?.message || params.message || "Codex 返回错误"));
  }
  function handleMessage(event) {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.id !== undefined && message.method) {
      if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method)) showApproval(message);
      else if (message.method === "item/tool/requestUserInput") showUserInput(message);
      else {
        state.socket?.send(JSON.stringify({ id: message.id, error: { code: -32601, message: `小妍 Codex Web 暂不支持 ${message.method}` } }));
        showSystemError(new Error(`Codex 请求了暂不支持的交互：${message.method}`));
      }
      return;
    }
    if (message.id !== undefined) { const pending = state.pending.get(message.id); if (!pending) return; state.pending.delete(message.id); if (message.error) pending.reject(new Error(message.error.message || "Codex 请求失败")); else pending.resolve(message.result); return; }
    if (message.method) handleNotification(message);
  }
  async function connect() {
    window.clearTimeout(state.reconnectTimer); setConnection("正在连接", "waiting"); const socket = new WebSocket(state.runtime.appServerUrl); state.socket = socket; socket.addEventListener("message", handleMessage);
    socket.addEventListener("open", async () => { try { await rpc("initialize", { clientInfo: { name: "xiaoyan-codex-web", title: "小妍 Codex Web", version: "1.0.0" }, capabilities: { experimentalApi: false, requestAttestation: false } }); notify("initialized", {}); state.connected = true; setConnection("已连接", "ready"); setBusy(false); await refreshThreads(); } catch (error) { showSystemError(error); socket.close(); } });
    socket.addEventListener("close", () => { state.connected = false; setBusy(false); setConnection("连接已断开，正在重试", "error"); for (const pending of state.pending.values()) pending.reject(new Error("Codex 连接已断开")); state.pending.clear(); state.reconnectTimer = window.setTimeout(connect, 1200); });
  }
  function resizePrompt() { ui.prompt.style.height = "auto"; ui.prompt.style.height = `${Math.min(ui.prompt.scrollHeight, 180)}px`; }
  ui.newThread.addEventListener("click", newThread); ui.composer.addEventListener("submit", (event) => { event.preventDefault(); void sendPrompt(); }); ui.prompt.addEventListener("input", resizePrompt); ui.prompt.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendPrompt(); } });
  ui.interrupt.addEventListener("click", async () => { if (!state.threadId || !state.turnId) return; try { await rpc("turn/interrupt", { threadId: state.threadId, turnId: state.turnId }); } catch (error) { showSystemError(error); } });
  fetch("/runtime.json", { cache: "no-store" }).then((response) => response.json()).then((runtime) => { state.runtime = runtime; ui.workspace.textContent = runtime.workspace; return connect(); }).catch((error) => showSystemError(error));
})();
