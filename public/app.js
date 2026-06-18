const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const recommendationList = document.querySelector("#recommendationList");
const recommendationMode = document.querySelector("#recommendationMode");
const recPanel = document.querySelector("#recPanel");
const recBackdrop = document.querySelector("#recBackdrop");
const recToggle = document.querySelector("#recToggle");
const recClose = document.querySelector(".rec-close");

const starters = ["送礼零食", "榴莲甜品", "聚会红酒", "实惠小吃"];

let isSending = false;

function openRecPanel() {
  recPanel.classList.add("open");
  recBackdrop.classList.add("open");
}

function closeRecPanel() {
  recPanel.classList.remove("open");
  recBackdrop.classList.remove("open");
}

function toggleRecPanel() {
  if (recPanel.classList.contains("open")) {
    closeRecPanel();
  } else {
    openRecPanel();
  }
}

function boot() {
  addMessage({
    role: "agent",
    text: "你好，我是店铺智能推荐助手。告诉我你的预算、口味或使用场景，我会直接给你挑具体商品和扫码入口。",
    chips: starters
  });
  resizeInput();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdown(markdown) {
  let html = escapeHtml(markdown);
  html = html
    .replace(/^###\s+(.+)$/gm, "<h4>$1</h4>")
    .replace(/^##\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^#\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br />");
  return `<p>${html}</p>`;
}

function priceLabel(product) {
  if (product.priceMin === product.priceMax) return `¥${product.priceMin}`;
  return `¥${product.priceMin}-${product.priceMax}`;
}

function specLabel(product) {
  const specs = (product.specs || []).map((spec) => spec.value).filter(Boolean);
  if (!specs.length) return "规格详见商品页";
  const unique = [...new Set(specs)];
  return unique.slice(0, 3).join(" / ") + (unique.length > 3 ? ` 等${unique.length}种` : "");
}

function addMessage({ role, text, recommendations = [], chips = [] }) {
  const message = document.createElement("article");
  message.className = `message ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<p>${escapeHtml(text)}</p>`;

  if (chips.length) {
    const chipRow = document.createElement("div");
    chipRow.className = "chip-row";
    chips.forEach((chip) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = chip;
      button.addEventListener("click", () => {
        input.value = chip;
        resizeInput();
        input.focus();
      });
      chipRow.append(button);
    });
    bubble.append(chipRow);
  }

  if (recommendations.length) {
    const list = document.createElement("div");
    list.className = "recommendations";
    recommendations.forEach((product, index) => {
      const card = document.createElement("section");
      card.className = "product-card";
      card.style.setProperty("--delay", `${index * 90}ms`);
      card.innerHTML = `
        <div class="product-main">
          <div class="product-meta">
            <span>${escapeHtml(product.brand || "精选商品")}</span>
            <span>${escapeHtml(product.category3 || product.category2 || "推荐")}</span>
          </div>
          <h2>${escapeHtml(product.name)}</h2>
          <p class="reason">${escapeHtml(product.reason || "这款商品比较符合你的需求。")}</p>
          <div class="product-facts">
            <strong>${escapeHtml(priceLabel(product))}</strong>
            <span>${escapeHtml(specLabel(product))}</span>
          </div>
        </div>
        <div class="qr-wrap">
          ${
            product.hasQrCode && product.qrCodePath
              ? `<img src="${escapeHtml(product.qrCodePath)}" alt="${escapeHtml(product.name)} 小程序二维码" />`
              : `<div class="qr-empty">暂无<br />二维码</div>`
          }
          <span>扫码查看</span>
        </div>
      `;
      list.append(card);
    });
    bubble.append(list);
  }

  message.append(bubble);
  messagesEl.append(message);
  scrollToBottom();
  return message;
}

function setRecommendationStatus(text, tone = "idle") {
  recommendationMode.textContent = text;
  recommendationMode.dataset.tone = tone;
}

function setRecommendationLoading() {
  openRecPanel();
  setRecommendationStatus("生成中", "loading");
  recommendationList.innerHTML = `
    <section class="recommendation-empty loading-card">
      <div class="mini-loader" aria-hidden="true"><span></span><span></span><span></span></div>
      <strong>大模型正在挑选商品</strong>
      <span>商品卡片和二维码会在下方生成，聊天分析会同时流式输出。</span>
    </section>
  `;
}

function renderRecommendations(recommendations) {
  if (!recommendations.length) {
    setRecommendationStatus("暂无推荐", "idle");
    recToggle.classList.remove("has-recs");
    recommendationList.innerHTML = `
      <section class="recommendation-empty">
        <strong>暂时没有匹配商品</strong>
        <span>可以换一种需求描述，比如预算、口味、送礼对象或使用场景。</span>
      </section>
    `;
    return;
  }

  openRecPanel();
  recToggle.classList.add("has-recs");
  setRecommendationStatus("已生成", "ready");
  recommendationList.innerHTML = "";
  recommendations.forEach((product, index) => {
    const card = document.createElement("section");
    card.className = "product-card";
    card.style.setProperty("--delay", `${index * 90}ms`);
    card.innerHTML = `
      <div class="product-main">
        <div class="product-meta">
          <span>${escapeHtml(product.brand || "精选商品")}</span>
          <span>${escapeHtml(product.angle || product.category3 || product.category2 || "推荐")}</span>
        </div>
        <h2>${escapeHtml(product.name)}</h2>
        <p class="reason">${escapeHtml(product.reason || "这款商品比较符合你的需求。")}</p>
        <div class="product-facts">
          <strong>${escapeHtml(priceLabel(product))}</strong>
          <span>${escapeHtml(specLabel(product))}</span>
        </div>
      </div>
      <div class="qr-wrap">
        ${
          product.hasQrCode && product.qrCodePath
            ? `<img src="${escapeHtml(product.qrCodePath)}" alt="${escapeHtml(product.name)} 小程序二维码" />`
            : `<div class="qr-empty">暂无<br />二维码</div>`
        }
        <span>${escapeHtml(product.scanPrompt || "扫码查看")}</span>
      </div>
    `;
    recommendationList.append(card);
  });
}

function addStreamingMessage() {
  const message = document.createElement("article");
  message.className = "message agent streaming-message";

  const bubble = document.createElement("div");
  bubble.className = "bubble streaming";
  const paragraph = document.createElement("p");
  bubble.append(paragraph);
  message.append(bubble);
  messagesEl.append(message);
  scrollToBottom();

  let text = "";
  return {
    message,
    bubble,
    setText(next) {
      text = next;
      paragraph.innerHTML = renderMarkdown(text);
      scrollToBottom();
    },
    appendText(chunk) {
      text += chunk;
      paragraph.innerHTML = renderMarkdown(text);
      scrollToBottom();
    },
    addRecommendations(recommendations) {
      renderRecommendations(recommendations);
    },
    finish() {
      bubble.classList.remove("streaming");
    }
  };
}

function addThinking() {
  const message = document.createElement("article");
  message.className = "message agent thinking-message";
  message.innerHTML = `
    <div class="bubble thinking">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;
  messagesEl.append(message);
  scrollToBottom();
  return message;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  });
}

function setSending(next) {
  isSending = next;
  sendButton.disabled = next;
  input.disabled = next;
}

async function requestRecommendation(message) {
  const response = await fetch("/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "推荐服务暂时不可用。");
  }

  return response.json();
}

async function requestRecommendationStream(message, handlers) {
  const response = await fetch("/api/recommend/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message })
  });

  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "推荐服务暂时不可用。");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const event = parseSseEvent(rawEvent);
      if (!event) continue;
      handlers[event.event]?.(event.data);
    }
  }
}

function parseSseEvent(rawEvent) {
  let event = "message";
  const dataLines = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || isSending) return;

  addMessage({ role: "user", text: message });
  input.value = "";
  resizeInput();
  setSending(true);
  setRecommendationLoading();
  const stream = addStreamingMessage();

  try {
    await requestRecommendationStream(message, {
      meta(data) {
        if (data.mode === "local") {
          setRecommendationStatus("本地推荐", "local");
          stream.setText("我先按店铺现有商品为你推荐，真实大模型暂时不可用。\n\n");
        } else {
          setRecommendationStatus("AI 生成", "ready");
        }
      },
      recommendations(data) {
        stream.addRecommendations(data.recommendations || []);
      },
      token(data) {
        stream.appendText(data.text || "");
      },
      error(data) {
        throw new Error(data.error || "推荐服务暂时不可用。");
      },
      done() {
        stream.finish();
      }
    });
    stream.finish();
  } catch (error) {
    stream.setText(`${error.message} 你可以换一种说法再试一次，比如告诉我预算、送礼对象或想要的口味。`);
    stream.finish();
  } finally {
    setSending(false);
    input.focus();
  }
});

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

recBackdrop.addEventListener("click", closeRecPanel);
recToggle.addEventListener("click", toggleRecPanel);
recClose.addEventListener("click", closeRecPanel);

boot();
