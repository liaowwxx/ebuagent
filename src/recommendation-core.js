function writeSseChunk(controller, encoder, event, payload) {
  controller.enqueue(encoder.encode(`event: ${event}\n`));
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function modelRequestBody(config, body) {
  const requestBody = { ...body };
  const isOpenAI = /(^|\.)openai\.com$/i.test(new URL(config.baseUrl).hostname);

  if (config.disableThinking && !isOpenAI) {
    requestBody.enable_thinking = false;
    requestBody.thinking = { type: "disabled" };
  }

  return requestBody;
}

function createVisibleTextFilter() {
  let pending = "";
  let insideThinking = false;

  return {
    push(chunk) {
      pending += chunk;
      let visible = "";

      while (pending) {
        const lower = pending.toLowerCase();

        if (insideThinking) {
          const endIndex = lower.indexOf("</think>");
          if (endIndex === -1) {
            pending = "";
            break;
          }
          pending = pending.slice(endIndex + "</think>".length);
          insideThinking = false;
          continue;
        }

        const startIndex = lower.indexOf("<think>");
        if (startIndex === -1) {
          const keepLength = Math.min("<think>".length - 1, pending.length);
          visible += pending.slice(0, pending.length - keepLength);
          pending = pending.slice(-keepLength);
          break;
        }

        visible += pending.slice(0, startIndex);
        pending = pending.slice(startIndex + "<think>".length);
        insideThinking = true;
      }

      return visible;
    },
    flush() {
      if (insideThinking) {
        pending = "";
        return "";
      }
      const visible = pending;
      pending = "";
      return visible;
    }
  };
}

function compactLoggedRecommendation(product) {
  return {
    productId: product.productId,
    name: product.name,
    brand: product.brand,
    category1: product.category1,
    category2: product.category2,
    category3: product.category3,
    priceMin: product.priceMin,
    priceMax: product.priceMax,
    specs: (product.specs || []).map((spec) => spec.value).filter(Boolean),
    hasQrCode: product.hasQrCode,
    qrCodePath: product.qrCodePath,
    reason: product.reason,
    angle: product.angle,
    scanPrompt: product.scanPrompt
  };
}

function fallbackId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTokens(message) {
  const normalized = normalizeText(message);
  const words = normalized.split(" ").filter(Boolean);
  const chineseText = normalized.replace(/[^\u3400-\u9fff]/g, "");
  const chineseTokens = [];

  for (let size = 2; size <= 6; size += 1) {
    for (let index = 0; index <= chineseText.length - size; index += 1) {
      chineseTokens.push(chineseText.slice(index, index + size));
    }
  }

  const usefulSingleChars = [...chineseText].filter((char) => !/[我想要买给有的和或一二三几款个些吗呢吧啊了是都就很更最]/.test(char));
  return [...new Set([...words, ...chineseTokens, ...usefulSingleChars])].filter((token) => token.length > 0);
}

function priceIntent(message) {
  const text = String(message || "");
  const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const max = numbers.length ? Math.max(...numbers) : null;
  if (/便宜|实惠|低价|划算|预算|以内|不超过|少于/.test(text)) return { type: "budget", max };
  if (/高端|送礼|礼盒|体面|贵|品质|进口/.test(text)) return { type: "premium", max };
  return { type: "neutral", max };
}

function productFields(product) {
  return [
    { key: "category3", value: product.category3, weight: 16 },
    { key: "category2", value: product.category2, weight: 13 },
    { key: "name", value: product.name, weight: 10 },
    { key: "brand", value: product.brand, weight: 8 },
    { key: "category1", value: product.category1, weight: 6 },
    {
      key: "specs",
      value: (product.specs || []).map((spec) => spec.value).filter(Boolean).join(" "),
      weight: 3
    },
    { key: "searchText", value: product.searchText, weight: 2 }
  ];
}

function tokenScore(token, fieldText, fieldWeight) {
  if (!token || !fieldText.includes(token)) return 0;
  if (token.length === 1) return fieldWeight * 0.45;
  if (token.length === 2) return fieldWeight * 0.8;
  return fieldWeight;
}

function productTextScore(product, tokens) {
  let score = 0;
  const matchedFields = new Set();

  for (const field of productFields(product)) {
    const fieldText = normalizeText(field.value);
    if (!fieldText) continue;

    for (const token of tokens) {
      const added = tokenScore(token, fieldText, field.weight);
      if (added > 0) {
        score += added;
        matchedFields.add(field.key);
      }
    }
  }

  if (matchedFields.has("category3")) score += 10;
  if (matchedFields.has("category2")) score += 8;
  if (matchedFields.has("name")) score += 6;
  if (matchedFields.has("brand")) score += 4;

  return score;
}

function catalogAffinity(products, message) {
  const tokens = queryTokens(message);
  const categoryHits = new Map();
  const brandHits = new Map();

  for (const product of products) {
    const score = productTextScore(product, tokens);
    if (score <= 0) continue;

    for (const category of [product.category1, product.category2, product.category3].filter(Boolean)) {
      categoryHits.set(category, (categoryHits.get(category) || 0) + score);
    }
    if (product.brand) {
      brandHits.set(product.brand, (brandHits.get(product.brand) || 0) + score * 0.7);
    }
  }

  return { categoryHits, brandHits };
}

function localCandidateEntries(products, message, limit = 18) {
  const tokens = queryTokens(message);
  const intent = priceIntent(message);
  const text = String(message || "");
  const affinity = catalogAffinity(products, message);

  return products
    .map((product) => {
      const textScore = productTextScore(product, tokens);
      let affinityScore = 0;

      for (const category of [product.category1, product.category2, product.category3].filter(Boolean)) {
        affinityScore += Math.min(18, (affinity.categoryHits.get(category) || 0) * 0.08);
      }
      if (product.brand) {
        affinityScore += Math.min(8, (affinity.brandHits.get(product.brand) || 0) * 0.05);
      }

      const occasionScore =
        /礼|送人|伴手礼|年货|端午/.test(text) && /礼盒|礼包|礼篮|伴手礼|粽/.test(product.searchText) ? 15 : 0;

      let priceScore = 0;
      if (intent.type === "budget" && product.priceMin <= 50) priceScore += 8;
      if (intent.type === "budget" && intent.max && product.priceMin <= intent.max) priceScore += 12;
      if (intent.type === "premium" && product.priceMin >= 100) priceScore += 7;

      const relevanceScore = textScore + affinityScore + occasionScore + priceScore;
      const score = (product.hasQrCode ? 8 : -20) + relevanceScore;

      return { product, score, relevanceScore };
    })
    .sort((a, b) => b.score - a.score || a.product.priceMin - b.product.priceMin)
    .slice(0, limit);
}

function localCandidates(products, message, limit = 18) {
  return localCandidateEntries(products, message, limit).map(({ product }) => product);
}

function formatPrice(min, max) {
  if (min === max) return `¥${min}`;
  return `¥${min}-${max}`;
}

function compactProduct(product) {
  return {
    productId: product.productId,
    name: product.name,
    brand: product.brand,
    category: [product.category1, product.category2, product.category3].filter(Boolean).join(" / "),
    price: formatPrice(product.priceMin, product.priceMax),
    specs: product.specs.map((spec) => spec.value).filter(Boolean).slice(0, 5),
    hasQrCode: product.hasQrCode
  };
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && ["user", "assistant"].includes(item.role))
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").trim().slice(0, 2000)
    }))
    .filter((item) => item.content)
    .slice(-12);
}

function recommendationTool() {
  return {
    type: "function",
    function: {
      name: "recommend_products",
      description:
        "当用户明确需要你挑选、推荐、比较店铺商品，或需要商品卡片/扫码入口时调用。普通聊天、追问澄清、解释规则时不要调用。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "结合当前用户消息和必要上下文后的商品需求，例如预算、品类、用途、口味或送礼对象。"
          },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 3,
            description: "需要推荐的商品数量，默认 3。"
          }
        },
        required: ["query"]
      }
    }
  };
}

function parseToolArguments(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function appendToolCallDelta(toolCalls, deltaToolCalls = []) {
  for (const delta of deltaToolCalls) {
    const index = delta.index || 0;
    if (!toolCalls[index]) {
      toolCalls[index] = {
        id: delta.id || "",
        type: delta.type || "function",
        function: { name: "", arguments: "" }
      };
    }

    if (delta.id) toolCalls[index].id = delta.id;
    if (delta.type) toolCalls[index].type = delta.type;
    if (delta.function?.name) toolCalls[index].function.name += delta.function.name;
    if (delta.function?.arguments) toolCalls[index].function.arguments += delta.function.arguments;
  }
}

function buildLogConversation(history, message) {
  const normalizedHistory = normalizeHistory(history);
  return {
    history: normalizedHistory,
    currentTurn: {
      user: { role: "user", content: message },
      assistant: { role: "assistant", content: "" }
    },
    messages: [...normalizedHistory, { role: "user", content: message }]
  };
}

function finalizeLogConversation(conversation) {
  const messages = [
    ...conversation.history,
    conversation.currentTurn.user
  ];

  if (conversation.currentTurn.assistant.content) {
    messages.push(conversation.currentTurn.assistant);
  }

  conversation.messages = messages;
}

function buildLocalReason(product, message) {
  const text = String(message || "");
  if (/送|礼|伴手礼|年货|端午/.test(text)) {
    return `${product.brand}这款更适合送礼，规格完整，扫码就能直接查看。`;
  }
  if (/便宜|实惠|划算|预算/.test(text)) {
    return `价格在 ${formatPrice(product.priceMin, product.priceMax)}，适合想要实惠选择时优先看。`;
  }
  if (/酒|红酒|葡萄酒/.test(text)) {
    return "这款属于酒水品类，适合聚会、佐餐或作为轻礼赠。";
  }
  return `${product.category2 || product.category1}里的匹配度较高，品牌和规格都比较明确。`;
}

function fallbackRecommendation(products, message, candidateEntries = localCandidateEntries(products, message, 3)) {
  const entries = candidateEntries.map((entry) => (entry.product ? entry : { product: entry, relevanceScore: 0 }));
  const relevantEntries = entries.filter((entry) => entry.relevanceScore >= 8);
  const candidates = relevantEntries.length ? relevantEntries.map((entry) => entry.product) : entries.map((entry) => entry.product);
  const picked = candidates.filter((item) => item.hasQrCode).slice(0, 3);
  const productsForReply = picked.length ? picked : candidates.slice(0, 3);
  return {
    mode: "local",
    answer: "我先按店铺现有商品为你推荐这几款，都是比较贴合你需求的选择。",
    recommendations: productsForReply.map((product) => ({
      productId: product.productId,
      reason: buildLocalReason(product, message)
    }))
  };
}

function hydrateRecommendations(products, reply, message) {
  const productMap = new Map(products.map((product) => [String(product.productId), product]));
  return reply.recommendations
    .map((item) => {
      const product = productMap.get(String(item.productId));
      if (!product) return null;
      return {
        ...product,
        reason: item.reason || buildLocalReason(product, message),
        angle: item.angle || "精选推荐",
        scanPrompt: item.scanPrompt || "扫码查看"
      };
    })
    .filter(Boolean);
}

function fallbackStreamText(message, recommendations) {
  const names = recommendations.map((item) => item.name).join("、");
  const hasGiftNeed = /送|礼|朋友|伴手礼|年货/.test(message);
  const opening = hasGiftNeed
    ? "我先按送礼场景帮你筛了一遍：优先选择包装完整、品牌辨识度高、扫码查看方便的商品。"
    : "我先按你的需求从店铺现有商品里做了匹配：优先选择有二维码、信息完整、和关键词更贴近的商品。";
  return `${opening}\n\n这次更推荐 ${names}。它们的共同点是商品信息清楚、价格和规格容易判断，顾客扫码后可以直接进入商品页继续查看。\n\n你可以先看第一款，如果更在意预算或口味，再对比后面两款。每张卡片右侧都有对应二维码，直接扫码就能进入小程序商品页面。`;
}

async function llmRecommendationPlan(config, message, candidates) {
  const { apiKey, baseUrl, model } = config;
  if (!apiKey) return null;

  const system = [
    "你是一个中文店铺商品推荐智能体，必须从候选商品中做真实选择。",
    "你要根据用户需求判断场景、预算、口味、品类和送礼属性，选出最多3个最合适商品。",
    "只输出严格 JSON，不要 Markdown，不要 JSON 外的文字。",
    "必须使用候选里的 productId，不要编造商品、价格、规格、二维码或库存。",
    "推荐理由要具体、克制、事实导向，说明匹配依据，避免夸张、煽动、过度情绪化表达。"
  ].join("\n");

  const user = JSON.stringify({
    userNeed: message,
    candidates: candidates.map(compactProduct),
    requiredShape: {
      answer: "先总结你的判断，说明推荐方向，60字以内",
      recommendations: [
        {
          productId: "候选商品ID",
          reason: "推荐理由，60到100字，基于品类、规格、价格、场景匹配说明依据，语气中性",
          angle: "推荐角度，例如预算匹配/规格合适/品类匹配/扫码方便",
          scanPrompt: "中性的扫码提示，例如扫码查看商品详情"
        }
      ]
    }
  });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(modelRequestBody(config, {
      model,
      temperature: 0.45,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    }))
  });

  if (!response.ok) {
    throw new Error(`Model recommendation request failed with ${response.status}`);
  }

  const data = await response.json();
  const parsed = extractJson(data?.choices?.[0]?.message?.content);
  if (!parsed || !Array.isArray(parsed.recommendations)) {
    throw new Error("Model recommendation response is not valid JSON.");
  }

  const valid = parsed.recommendations
    .map((item) => ({
      productId: String(item.productId),
      reason: String(item.reason || "").slice(0, 180),
      angle: String(item.angle || "").slice(0, 40),
      scanPrompt: String(item.scanPrompt || "扫码查看商品详情").slice(0, 60)
    }))
    .slice(0, 3);

  if (!valid.length) return null;
  return {
    mode: "llm",
    answer: String(parsed.answer || "我按你的需求挑了几款更合适的商品。").slice(0, 120),
    recommendations: valid
  };
}

async function streamModelAnalysis(config, emit, message, plan, recommendations) {
  const { apiKey, baseUrl, model } = config;
  if (!apiKey || plan.mode !== "llm") {
    emit("token", { text: fallbackStreamText(message, recommendations) });
    return;
  }

  const selected = recommendations.map((product) => ({
    productId: product.productId,
    name: product.name,
    brand: product.brand,
    category: [product.category1, product.category2, product.category3].filter(Boolean).join(" / "),
    price: formatPrice(product.priceMin, product.priceMax),
    specs: product.specs.map((spec) => spec.value).filter(Boolean).slice(0, 5),
    reason: product.reason,
    angle: product.angle,
    scanPrompt: product.scanPrompt,
    hasQrCode: product.hasQrCode
  }));

  const system = [
    "你是一个中文店铺导购智能体。",
    "必须根据已经选定的右侧商品卡片结果撰写推荐说明，不要脱离这些商品另行推荐。",
    "用中性、专业、具体的中文解释推荐逻辑，像商品对比说明，不像广告文案。",
    "内容要说明整体筛选依据，然后逐个商品说明匹配点、差异和扫码查看建议。",
    "只能使用给定商品事实，不要编造库存、功效、物流、优惠、图片或二维码内容。",
    "可以使用简洁 Markdown，例如加粗、小标题和项目符号；不要输出表格或 JSON。",
    "避免夸张、煽动或强情绪词，比如惊喜、超值、必买、闭眼入、体面、有面子、超爱、非常、突出、扎实、精美、新奇、经典。",
    "少用主观判断，多用可核对事实：价格、规格、品类、预算区间、适用场景。"
  ].join("\n");

  const user = JSON.stringify({
    userNeed: message,
    recommendationSummary: plan.answer,
    selectedProducts: selected,
    writingRequirements: [
      "约220到360字",
      "每个商品至少给出一个明确、可核对的推荐理由",
      "说明哪个更适合预算、规格、品类或使用场景",
      "最后用中性语气提醒用户可以扫描右侧二维码查看详情"
    ]
  });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(modelRequestBody(config, {
      model,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    }))
  });

  if (!response.ok || !response.body) {
    throw new Error(`Model stream request failed with ${response.status}`);
  }

  const decoder = new TextDecoder();
  const visibleText = createVisibleTextFilter();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const text = visibleText.push(parsed?.choices?.[0]?.delta?.content || "");
          if (text) emit("token", { text });
        } catch {
          continue;
        }
      }
    }
  }

  const tail = visibleText.flush();
  if (tail) emit("token", { text: tail });
}

async function streamAssistantTurn({ config, emit, message, history }) {
  const { apiKey, baseUrl, model } = config;
  if (!apiKey) {
    emit("meta", { mode: "chat" });
    emit("token", { text: "当前没有配置大模型服务，我暂时只能在主窗口回复。请配置模型后再让我判断是否需要生成商品推荐卡片。" });
    return { toolCall: null };
  }

  const system = [
    "你是一个中文店铺导购智能体，可以进行连续上下文对话。",
    "只有当用户明确要求你推荐、挑选、比较具体商品，或需要商品卡片、扫码入口时，才调用 recommend_products 工具。",
    "如果用户只是寒暄、提问、补充偏好、询问流程、修改条件但还没要求你推荐，就只在聊天窗口自然回复，不要调用工具。",
    "需要推荐但信息明显不足时，先在聊天窗口追问关键条件，不要急着调用工具。",
    "不要输出思考过程、推理过程、<think> 标签或任何隐藏推理内容。"
  ].join("\n");

  const messages = [
    { role: "system", content: system },
    ...normalizeHistory(history),
    { role: "user", content: message }
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(modelRequestBody(config, {
      model,
      temperature: 0.35,
      stream: true,
      tools: [recommendationTool()],
      tool_choice: "auto",
      messages
    }))
  });

  if (!response.ok || !response.body) {
    throw new Error(`Model chat request failed with ${response.status}`);
  }

  emit("meta", { mode: "chat" });

  const decoder = new TextDecoder();
  const visibleText = createVisibleTextFilter();
  const toolCalls = [];
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta || {};
          appendToolCallDelta(toolCalls, delta.tool_calls || []);
          const text = visibleText.push(delta.content || "");
          if (text) emit("token", { text });
        } catch {
          continue;
        }
      }
    }
  }

  const tail = visibleText.flush();
  if (tail) emit("token", { text: tail });

  const toolCall = toolCalls.find((item) => item?.function?.name === "recommend_products");
  return { toolCall: toolCall || null };
}

export async function createRecommendationStream({ message, history = [], products, config, logContext = {}, onLog }) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const startedAt = new Date();
      const conversation = buildLogConversation(history, message);
      const logEntry = {
        schemaVersion: 2,
        requestId: logContext.requestId || globalThis.crypto?.randomUUID?.() || fallbackId(),
        sessionId: logContext.sessionId || "unknown",
        startedAt: startedAt.toISOString(),
        endedAt: null,
        durationMs: null,
        status: "started",
        mode: null,
        user: logContext.user || null,
        client: logContext.client || {},
        conversation,
        toolCall: null,
        recommendationRequest: null,
        recommendations: [],
        error: null,
        // Legacy shape retained so existing local/KV readers do not break immediately.
        dialogue: {
          userMessage: message,
          history: conversation.history,
          aiMessage: ""
        }
      };

      const emit = (event, payload) => {
        if (event === "meta") logEntry.mode = payload?.mode || null;
        if (event === "recommendations") {
          logEntry.recommendations = (payload?.recommendations || []).map(compactLoggedRecommendation);
        }
        if (event === "token") {
          const text = payload?.text || "";
          logEntry.dialogue.aiMessage += text;
          logEntry.conversation.currentTurn.assistant.content += text;
        }
        if (event === "error") {
          logEntry.status = "error";
          logEntry.error = payload?.error || "推荐服务暂时不可用。";
        }
        writeSseChunk(controller, encoder, event, payload);
      };

      try {
        const { toolCall } = await streamAssistantTurn({ config, emit, message, history });
        if (!toolCall) {
          emit("done", { ok: true });
          logEntry.status = "completed";
          return;
        }

        emit("meta", { mode: "selecting" });

        const toolArgs = parseToolArguments(toolCall.function.arguments);
        const recommendationNeed = String(toolArgs.query || message).trim() || message;
        const recommendationCount = Math.max(1, Math.min(3, Number(toolArgs.count || 3)));
        logEntry.toolCall = {
          id: toolCall.id || "",
          name: toolCall.function.name,
          arguments: toolArgs
        };
        logEntry.recommendationRequest = {
          query: recommendationNeed,
          count: recommendationCount
        };
        const candidateEntries = localCandidateEntries(products, recommendationNeed, 18);
        const scopedCandidateEntries = candidateEntries.slice(0, Math.max(6, recommendationCount * 6));
        const scopedCandidates = scopedCandidateEntries.map(({ product }) => product);
        let plan = null;
        try {
          plan = await llmRecommendationPlan(config, recommendationNeed, scopedCandidates);
        } catch (error) {
          console.warn(error.message);
        }

        const fallbackEntries = scopedCandidateEntries.slice(0, Math.max(3, recommendationCount));
        const reply = plan || fallbackRecommendation(products, recommendationNeed, fallbackEntries);
        reply.recommendations = reply.recommendations.slice(0, recommendationCount);
        const recommendations = hydrateRecommendations(products, reply, recommendationNeed);

        emit("meta", { mode: reply.mode });
        emit("recommendations", { recommendations });

        try {
          await streamModelAnalysis(config, emit, recommendationNeed, reply, recommendations);
        } catch (error) {
          console.warn(error.message);
          emit("token", { text: fallbackStreamText(recommendationNeed, recommendations) });
        }

        emit("done", { ok: true });
        logEntry.status = "completed";
      } catch (error) {
        emit("error", { error: error.message || "推荐服务暂时不可用。" });
      } finally {
        logEntry.endedAt = new Date().toISOString();
        logEntry.durationMs = Date.parse(logEntry.endedAt) - startedAt.getTime();
        finalizeLogConversation(logEntry.conversation);
        if (onLog) {
          try {
            await onLog(logEntry);
          } catch (error) {
            console.warn(`Chat log write failed: ${error.message}`);
          }
        }
        controller.close();
      }
    }
  });
}

export function sseHeaders() {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  };
}

export function modelConfigFromEnv(env) {
  return {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    disableThinking: env.OPENAI_DISABLE_THINKING !== "false"
  };
}

export function badRequest(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
