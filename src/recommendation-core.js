function writeSseChunk(controller, encoder, event, payload) {
  controller.enqueue(encoder.encode(`event: ${event}\n`));
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
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
  const chineseChars = [...normalized.replace(/\s/g, "")].filter((char) => /[\u3400-\u9fff]/.test(char));
  return [...new Set([...words, ...chineseChars])].filter((token) => token.length > 0);
}

function priceIntent(message) {
  const text = String(message || "");
  const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const max = numbers.length ? Math.max(...numbers) : null;
  if (/便宜|实惠|低价|划算|预算|以内|不超过|少于/.test(text)) return { type: "budget", max };
  if (/高端|送礼|礼盒|体面|贵|品质|进口/.test(text)) return { type: "premium", max };
  return { type: "neutral", max };
}

function localCandidates(products, message, limit = 18) {
  const tokens = queryTokens(message);
  const intent = priceIntent(message);
  const text = String(message || "");

  return products
    .map((product) => {
      let score = product.hasQrCode ? 8 : -20;
      const haystack = normalizeText(product.searchText);

      for (const token of tokens) {
        if (haystack.includes(token)) score += token.length > 1 ? 8 : 2;
      }

      if (/零食|吃|小吃|休闲/.test(text) && product.category2 === "休闲食品") score += 12;
      if (/水果|生鲜|牛排|肉|榴莲|冷链/.test(text) && /水果|生鲜|冻品/.test(product.category2)) score += 12;
      if (/酒|红酒|葡萄酒|起泡酒/.test(text) && product.category2 === "酒水") score += 14;
      if (/耳机|蓝牙|降噪|数码/.test(text) && product.category3 === "耳机") score += 18;
      if (/礼|送人|伴手礼|年货|端午/.test(text) && /礼盒|礼包|礼篮|伴手礼|粽/.test(product.searchText)) score += 15;
      if (/榴莲|甜品|冰淇淋|泡芙|千层/.test(text) && /榴芒一刻|榴莲|冰淇淋|泡芙|千层/.test(product.searchText)) score += 16;

      if (intent.type === "budget" && product.priceMin <= 50) score += 8;
      if (intent.type === "budget" && intent.max && product.priceMin <= intent.max) score += 12;
      if (intent.type === "premium" && product.priceMin >= 100) score += 7;

      return { product, score };
    })
    .sort((a, b) => b.score - a.score || a.product.priceMin - b.product.priceMin)
    .slice(0, limit)
    .map(({ product }) => product);
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

function fallbackRecommendation(products, message, candidates = localCandidates(products, message, 3)) {
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
    body: JSON.stringify({
      model,
      temperature: 0.45,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
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
    body: JSON.stringify({
      model,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`Model stream request failed with ${response.status}`);
  }

  const decoder = new TextDecoder();
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
          const text = parsed?.choices?.[0]?.delta?.content || "";
          if (text) emit("token", { text });
        } catch {
          continue;
        }
      }
    }
  }
}

export async function createRecommendationStream({ message, products, config, logContext = {}, onLog }) {
  const encoder = new TextEncoder();
  const candidates = localCandidates(products, message, 18);

  return new ReadableStream({
    async start(controller) {
      const startedAt = new Date();
      const logEntry = {
        schemaVersion: 1,
        requestId: logContext.requestId || globalThis.crypto?.randomUUID?.() || fallbackId(),
        sessionId: logContext.sessionId || "unknown",
        startedAt: startedAt.toISOString(),
        endedAt: null,
        durationMs: null,
        status: "started",
        mode: null,
        user: logContext.user || null,
        client: logContext.client || {},
        dialogue: {
          userMessage: message,
          aiMessage: ""
        },
        recommendations: [],
        error: null
      };

      const emit = (event, payload) => {
        if (event === "meta") logEntry.mode = payload?.mode || null;
        if (event === "recommendations") {
          logEntry.recommendations = (payload?.recommendations || []).map(compactLoggedRecommendation);
        }
        if (event === "token") logEntry.dialogue.aiMessage += payload?.text || "";
        if (event === "error") {
          logEntry.status = "error";
          logEntry.error = payload?.error || "推荐服务暂时不可用。";
        }
        writeSseChunk(controller, encoder, event, payload);
      };

      try {
        let plan = null;
        try {
          plan = await llmRecommendationPlan(config, message, candidates);
        } catch (error) {
          console.warn(error.message);
        }

        const reply = plan || fallbackRecommendation(products, message, candidates);
        const recommendations = hydrateRecommendations(products, reply, message);

        emit("meta", { mode: reply.mode });
        emit("recommendations", { recommendations });

        try {
          await streamModelAnalysis(config, emit, message, reply, recommendations);
        } catch (error) {
          console.warn(error.message);
          emit("token", { text: fallbackStreamText(message, recommendations) });
        }

        emit("done", { ok: true });
        logEntry.status = "completed";
      } catch (error) {
        emit("error", { error: error.message || "推荐服务暂时不可用。" });
      } finally {
        logEntry.endedAt = new Date().toISOString();
        logEntry.durationMs = Date.parse(logEntry.endedAt) - startedAt.getTime();
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
    model: env.OPENAI_MODEL || "gpt-4.1-mini"
  };
}

export function badRequest(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
