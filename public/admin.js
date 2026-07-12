const prefixSelect = document.querySelector("#prefixSelect");
const refreshButton = document.querySelector("#refreshButton");
const downloadSelectedButton = document.querySelector("#downloadSelectedButton");
const downloadPrefixButton = document.querySelector("#downloadPrefixButton");
const deleteSelectedButton = document.querySelector("#deleteSelectedButton");
const deletePrefixButton = document.querySelector("#deletePrefixButton");
const deleteConfirmInput = document.querySelector("#deleteConfirmInput");
const statusText = document.querySelector("#statusText");
const countText = document.querySelector("#countText");
const keyTableBody = document.querySelector("#keyTableBody");
const emptyState = document.querySelector("#emptyState");
const loadMoreButton = document.querySelector("#loadMoreButton");
const selectAllBox = document.querySelector("#selectAllBox");

let keys = [];
let cursor = "";
let listComplete = true;

function setStatus(message, tone = "normal") {
  statusText.textContent = message;
  statusText.dataset.tone = tone;
}

function setBusy(busy) {
  for (const button of [
    refreshButton,
    downloadSelectedButton,
    downloadPrefixButton,
    deleteSelectedButton,
    deletePrefixButton,
    loadMoreButton
  ]) {
    button.disabled = busy;
  }
}

function selectedKeys() {
  return [...keyTableBody.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function metadataText(metadata) {
  if (!metadata) return "无";
  const parts = [];
  if (metadata.status) parts.push(metadata.status);
  if (metadata.mode) parts.push(metadata.mode);
  if (metadata.eventType) parts.push(metadata.eventType);
  if (metadata.hasRecommendations === "true") parts.push("有推荐");
  if (metadata.hasFeedback === "true") parts.push("有评分");
  if (metadata.productDetailClicked === "true") parts.push("点过详情");
  return parts.join(" / ") || "有元数据";
}

function timeText(metadata) {
  const value = metadata?.startedAt || metadata?.createdAt || "";
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function render() {
  keyTableBody.innerHTML = "";
  selectAllBox.checked = false;

  for (const item of keys) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" value="${escapeHtml(item.name)}" aria-label="选择 ${escapeHtml(item.name)}" /></td>
      <td class="key-cell">${escapeHtml(item.name)}</td>
      <td class="muted">${escapeHtml(metadataText(item.metadata))}</td>
      <td class="muted">${escapeHtml(timeText(item.metadata))}</td>
    `;
    keyTableBody.append(row);
  }

  emptyState.classList.toggle("hidden", keys.length > 0);
  loadMoreButton.classList.toggle("hidden", listComplete || !cursor);
  countText.textContent = keys.length ? `已加载 ${keys.length} 条` : "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function checkAuth() {
  const response = await fetch("/api/admin/check");
  if (response.ok) return true;
  setStatus("未登录管理员账号。请返回聊天页右上角“管理”入口登录。");
  return false;
}

async function loadKeys({ append = false } = {}) {
  setBusy(true);
  try {
    if (!append) {
      keys = [];
      cursor = "";
      listComplete = true;
      render();
    }

    const params = new URLSearchParams({
      prefix: prefixSelect.value,
      limit: "100"
    });
    if (append && cursor) params.set("cursor", cursor);

    const response = await fetch(`/api/admin/kv?${params.toString()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "读取 KV 失败。");

    keys = append ? [...keys, ...(data.keys || [])] : data.keys || [];
    cursor = data.cursor || "";
    listComplete = !!data.listComplete;
    setStatus("读取完成");
    render();
  } catch (error) {
    setStatus(error.message || "读取失败");
    render();
  } finally {
    setBusy(false);
  }
}

async function postKvAction(body) {
  const response = await fetch("/api/admin/kv", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (body.action === "export" && response.ok) return response;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作失败。");
  return data;
}

async function download(body) {
  setBusy(true);
  try {
    const response = await postKvAction({ action: "export", ...body });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const count = response.headers.get("x-exported-count") || "0";
    link.href = url;
    link.download = `chat-logs-${new Date().toISOString().slice(0, 10)}.jsonl`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`已下载 ${count} 条`);
  } catch (error) {
    setStatus(error.message || "下载失败");
  } finally {
    setBusy(false);
  }
}

async function deleteLogs(body) {
  setBusy(true);
  try {
    const data = await postKvAction({ action: "delete", ...body });
    setStatus(`已删除 ${data.deletedCount || 0} 条`);
    await loadKeys();
  } catch (error) {
    setStatus(error.message || "删除失败");
  } finally {
    setBusy(false);
  }
}

refreshButton.addEventListener("click", () => loadKeys());
prefixSelect.addEventListener("change", () => loadKeys());
loadMoreButton.addEventListener("click", () => loadKeys({ append: true }));

selectAllBox.addEventListener("change", () => {
  for (const input of keyTableBody.querySelectorAll("input[type='checkbox']")) {
    input.checked = selectAllBox.checked;
  }
});

downloadSelectedButton.addEventListener("click", () => {
  const picked = selectedKeys();
  if (!picked.length) {
    setStatus("请先选择要下载的 key。");
    return;
  }
  download({ keys: picked });
});

downloadPrefixButton.addEventListener("click", () => {
  download({ prefix: prefixSelect.value });
});

deleteSelectedButton.addEventListener("click", () => {
  const picked = selectedKeys();
  if (!picked.length) {
    setStatus("请先选择要删除的 key。");
    return;
  }
  if (!confirm(`确认删除已选 ${picked.length} 条 KV？`)) return;
  deleteLogs({ keys: picked });
});

deletePrefixButton.addEventListener("click", () => {
  if (deleteConfirmInput.value.trim() !== "DELETE") {
    setStatus("请输入 DELETE 后再删除当前范围。");
    return;
  }
  const label = prefixSelect.value || "全部 KV";
  if (!confirm(`确认删除「${label}」范围内的 KV？此操作不可恢复。`)) return;
  deleteLogs({ prefix: prefixSelect.value, confirm: "DELETE" });
});

async function init() {
  if (!(await checkAuth())) return;
  await loadKeys();
}

init();
