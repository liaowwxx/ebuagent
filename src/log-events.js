const EVENT_TYPES = new Set(["rating", "low_score_reason", "product_detail_click"]);

function cleanKeyPart(value, fallback = "unknown") {
  const cleaned = String(value || "")
    .trim()
    .slice(0, 120)
    .replace(/[^\w.-]/g, "_");
  return cleaned || fallback;
}

function cleanText(value, maxLength = 500) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function dayFromIso(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

export function chatLogKey({ startedAt, sessionId, requestId }) {
  const day = dayFromIso(startedAt);
  return `chat/${day}/${cleanKeyPart(sessionId)}/${cleanKeyPart(requestId)}.json`;
}

export function pendingEventKey(event) {
  const day = dayFromIso(event.startedAt || event.createdAt);
  const created = cleanKeyPart(event.createdAt || new Date().toISOString());
  const id = cleanKeyPart(event.eventId || Math.random().toString(36).slice(2, 10));
  return `chat-events/${day}/${cleanKeyPart(event.sessionId)}/${cleanKeyPart(event.requestId)}/${created}_${id}.json`;
}

export function pendingEventPrefix({ startedAt, sessionId, requestId }) {
  const day = dayFromIso(startedAt);
  return `chat-events/${day}/${cleanKeyPart(sessionId)}/${cleanKeyPart(requestId)}/`;
}

export function normalizeClientLogEvent(body, context = {}) {
  const eventType = String(body?.eventType || "").trim();
  if (!EVENT_TYPES.has(eventType)) {
    throw new Error("不支持的反馈类型。");
  }

  const requestId = cleanText(body?.requestId, 120);
  const sessionId = cleanText(body?.sessionId, 120);
  if (!requestId || !sessionId) {
    throw new Error("缺少反馈关联信息。");
  }

  const event = {
    schemaVersion: 1,
    eventId: context.eventId || globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10),
    eventType,
    requestId,
    sessionId,
    startedAt: cleanText(body?.startedAt, 40) || new Date().toISOString(),
    createdAt: context.createdAt || new Date().toISOString(),
    user: context.user || null,
    client: context.client || {}
  };

  if (eventType === "rating") {
    const rating = Number(body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
      throw new Error("评分必须是 1 到 10。");
    }
    event.rating = rating;
  }

  if (eventType === "low_score_reason") {
    event.reason = cleanText(body?.reason, 1000);
    if (!event.reason) {
      throw new Error("请输入低分原因。");
    }
  }

  if (eventType === "product_detail_click") {
    event.productId = cleanText(body?.productId, 120);
    event.productName = cleanText(body?.productName, 240);
    event.source = cleanText(body?.source, 80) || eventType;
  }

  return event;
}

function ensureFeedback(entry) {
  if (!entry.feedback) {
    entry.feedback = {
      rating: null,
      ratingSubmittedAt: null,
      lowScoreReason: "",
      lowScoreReasonSubmittedAt: null
    };
  }
  return entry.feedback;
}

function ensureInteractionSummary(entry) {
  if (!Array.isArray(entry.interactionEvents)) entry.interactionEvents = [];
  if (!entry.interactionSummary) {
    entry.interactionSummary = {
      productDetailClickCount: 0,
      detailClickedProductIds: [],
      productDetailClicked: false
    };
  }
  return entry.interactionSummary;
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

export function applyLogEvent(entry, event) {
  if (!entry || !event) return entry;

  if (event.eventType === "rating") {
    const feedback = ensureFeedback(entry);
    feedback.rating = event.rating;
    feedback.ratingSubmittedAt = event.createdAt;
    feedback.updatedAt = event.createdAt;
  }

  if (event.eventType === "low_score_reason") {
    const feedback = ensureFeedback(entry);
    feedback.lowScoreReason = event.reason;
    feedback.lowScoreReasonSubmittedAt = event.createdAt;
    feedback.updatedAt = event.createdAt;
  }

  if (event.eventType === "product_detail_click") {
    const summary = ensureInteractionSummary(entry);
    entry.interactionEvents.push({
      eventId: event.eventId,
      eventType: event.eventType,
      productId: event.productId || "",
      productName: event.productName || "",
      source: event.source || "",
      createdAt: event.createdAt
    });

    summary.productDetailClickCount += 1;
    addUnique(summary.detailClickedProductIds, event.productId);
    summary.productDetailClicked = summary.productDetailClickCount > 0;
    entry.productDetailClicked = summary.productDetailClicked;
  }

  return entry;
}

export function chatLogMetadata(entry) {
  return {
    schemaVersion: String(entry.schemaVersion || 1),
    sessionId: entry.sessionId,
    status: entry.status,
    mode: entry.mode || "unknown",
    hasRecommendations: String((entry.recommendations || []).length > 0),
    hasFeedback: String(!!entry.feedback?.rating),
    productDetailClicked: String(!!entry.interactionSummary?.productDetailClicked || !!entry.productDetailClicked),
    startedAt: entry.startedAt
  };
}
