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
    angle: product.angle
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

const COVERAGE_STOP_TOKENS = new Set([
  "推荐",
  "商品",
  "东西",
  "一些",
  "一点",
  "几个",
  "几款",
  "一款",
  "两款",
  "三款",
  "帮我",
  "给我",
  "看看",
  "有没有",
  "有没",
  "可以",
  "适合",
  "预算",
  "左右",
  "以内",
  "不超过",
  "便宜",
  "实惠",
  "划算",
  "高端",
  "品质",
  "送人",
  "朋友",
  "扫码",
  "入口",
  "详情"
]);

const COVERAGE_SINGLE_CHAR_TOKENS = new Set(["酒", "茶", "肉", "粽", "面"]);

function isCoverageToken(token) {
  if (!token || COVERAGE_STOP_TOKENS.has(token)) return false;
  if (/^\d+(?:\.\d+)?$/.test(token)) return false;
  if (token.length === 1) return COVERAGE_SINGLE_CHAR_TOKENS.has(token);
  return token.length >= 2;
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

function coverageFields(product) {
  return [
    { key: "category3", value: product.category3, weight: 18 },
    { key: "category2", value: product.category2, weight: 16 },
    { key: "name", value: product.name, weight: 12 },
    { key: "brand", value: product.brand, weight: 9 },
    { key: "category1", value: product.category1, weight: 7 },
    {
      key: "specs",
      value: (product.specs || []).map((spec) => spec.value).filter(Boolean).join(" "),
      weight: 4
    }
  ];
}

function productCoverageScore(product, tokens) {
  let score = 0;
  const matchedFields = new Set();
  const coverageTokens = tokens.filter(isCoverageToken);

  for (const field of coverageFields(product)) {
    const fieldText = normalizeText(field.value);
    if (!fieldText) continue;

    for (const token of coverageTokens) {
      const added = tokenScore(token, fieldText, field.weight);
      if (added > 0) {
        score += added;
        matchedFields.add(field.key);
      }
    }
  }

  if (matchedFields.has("category3")) score += 12;
  if (matchedFields.has("category2")) score += 10;
  if (matchedFields.has("name")) score += 8;
  if (matchedFields.has("brand")) score += 5;

  return score;
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
      const coverageScore = productCoverageScore(product, tokens);
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

      return { product, score, relevanceScore, coverageScore };
    })
    .sort((a, b) => b.score - a.score || a.product.priceMin - b.product.priceMin)
    .slice(0, limit);
}

function localCandidates(products, message, limit = 18) {
  return localCandidateEntries(products, message, limit).map(({ product }) => product);
}

function buildCatalogSummary(products) {
  const grouped = new Map();

  for (const product of products) {
    const category1 = product.category1 || "未分类";
    const category2 = product.category2 || "未分类";
    const category3 = product.category3 || "";

    if (!grouped.has(category1)) grouped.set(category1, new Map());
    const secondLevel = grouped.get(category1);
    if (!secondLevel.has(category2)) secondLevel.set(category2, new Set());
    if (category3) secondLevel.get(category2).add(category3);
  }

  return [...grouped.entries()]
    .slice(0, 8)
    .map(([category1, secondLevel]) => {
      const secondText = [...secondLevel.entries()]
        .slice(0, 10)
        .map(([category2, thirdLevel]) => {
          const thirdText = [...thirdLevel].slice(0, 8).join("、");
          return thirdText ? `${category2}（${thirdText}）` : category2;
        })
        .join("；");
      return `${category1}：${secondText}`;
    })
    .join("\n");
}

function availableCategoryList(products) {
  return [
    ...new Set(
      products
        .map((product) => product.category2 || product.category1 || product.category3)
        .filter(Boolean)
    )
  ].slice(0, 8);
}

function evaluateCatalogCoverage(products, query, candidateEntries = localCandidateEntries(products, query, 18)) {
  const coveredEntries = candidateEntries.filter((entry) => entry.coverageScore >= 12);
  const topEntry = candidateEntries[0] || null;
  return {
    matched: coveredEntries.length > 0,
    query,
    topCoverageScore: topEntry?.coverageScore || 0,
    matchedCount: coveredEntries.length,
    availableCategories: availableCategoryList(products),
    candidateEntries: coveredEntries.length ? coveredEntries : []
  };
}

function noCatalogMatchText(match) {
  const categories = match.availableCategories.join("、");
  return `目前商品库里没有和「${match.query}」明确匹配的商品，所以不能直接推荐对应商品卡片。店内当前主要有${categories}等类目；如果你愿意，可以从这些类目里选一个，我再帮你挑。`;
}

function catalogOverviewText(products) {
  return `当前商品库主要有这些类目：\n\n${buildCatalogSummary(products)}\n\n你可以告诉我预算、用途或想看的类目，我会先查商品库，再生成对应商品卡片。`;
}

function isCatalogOverviewRequest(message) {
  const text = String(message || "");
  return /有哪些|有什么|都有什么|卖什么|商品库|品类|类目|经营范围|商品范围/.test(text);
}

function hasProductIntent(text) {
  return /推荐|有没有|有吗|有么|有售|卖|买|买点|想要|想买|想找|挑|选|看看|看下|来点|商品|价格|多少钱|预算|扫码|二维码|礼盒|零食|小吃|吃的|喝的|食品|酒|红酒|葡萄酒|水果|榴莲|耳机|牛排|面|粽|茶|巧克力|坚果|冰淇淋|甜品|生鲜|冻品|饰品|手链|礼物|礼品|送礼|送人|送朋友|伴手礼|年货/.test(
    String(text || "")
  );
}

function isCatalogFollowUp(message) {
  return /^(那|就|再|帮我|给我|可以|行|好|嗯|恩)?\s*(推荐|挑|选|来|看看|看下|换|两款|三款|几款|一个|两个|三个|这类|这种)/.test(
    String(message || "").trim()
  );
}

function shouldForceCatalogLookup(message, history) {
  if (isCatalogOverviewRequest(message)) return false;
  if (hasProductIntent(message)) return true;

  const normalizedHistory = normalizeHistory(history);
  const recentUserMessages = normalizedHistory
    .filter((item) => item.role === "user")
    .slice(-3)
    .map((item) => item.content)
    .join(" ");

  return isCatalogFollowUp(message) && hasProductIntent(recentUserMessages);
}

function isDirectInfoRequest(message) {
  const text = String(message || "");
  if (/推荐|挑|选|来|看看|看下|换|几款|一款|两款|三款|适合|搭配|送礼|礼物|想买|想要|想找|买/.test(text)) {
    return false;
  }
  return /多少钱|价格|价位|售价|卖不卖|库存/.test(text);
}

function requestedRecommendationCount(message) {
  const text = String(message || "");
  if (/一款|一个|1\s*款?/.test(text)) return 1;
  if (/两款|二款|两个|2\s*款?/.test(text)) return 2;
  if (/三款|三个|3\s*款?/.test(text)) return 3;
  return 3;
}

function buildForcedCatalogQuery(message, history) {
  const recentUserMessages = normalizeHistory(history)
    .filter((item) => item.role === "user" && hasProductIntent(item.content))
    .slice(-3)
    .map((item) => item.content);

  return [...recentUserMessages, message].join("；").trim() || message;
}

function enrichCatalogQuery(query) {
  const text = String(query || "");
  const hints = [];

  if (/吃的|食品|来点|小吃|零食/.test(text)) {
    hints.push("零食", "小吃", "甜品", "坚果", "巧克力", "方便面", "牛排", "粽子");
  }

  if (/喝的|饮品|酒|聚会|佐餐/.test(text)) {
    hints.push("茶", "红酒", "葡萄酒", "利口酒");
  }

  if (/送|朋友|礼物|礼品|伴手礼|年货|东西/.test(text)) {
    hints.push("礼盒", "礼包", "伴手礼", "零食", "坚果", "红酒", "巧克力");
  }

  const uniqueHints = [...new Set(hints)].filter((hint) => !text.includes(hint));
  return uniqueHints.length ? `${text}；${uniqueHints.join(" ")}` : text;
}

function normalizeIntentPlan(plan, message, history) {
  const allowedIntents = new Set(["chat", "catalog_overview", "search", "recommend"]);
  const intent = allowedIntents.has(plan?.intent) ? plan.intent : fallbackCatalogIntent(message, history).intent;
  const query = String(plan?.query || "").trim() || buildForcedCatalogQuery(message, history);
  const count = Math.max(1, Math.min(3, Number(plan?.count || requestedRecommendationCount(message))));

  return {
    intent,
    query: intent === "chat" || intent === "catalog_overview" ? "" : query,
    count,
    budgetMax: Number.isFinite(Number(plan?.budgetMax)) ? Number(plan.budgetMax) : null,
    categoryHints: Array.isArray(plan?.categoryHints) ? plan.categoryHints.map((item) => String(item).trim()).filter(Boolean).slice(0, 6) : [],
    constraints: Array.isArray(plan?.constraints) ? plan.constraints.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : [],
    confidence: Math.max(0, Math.min(1, Number(plan?.confidence || 0))),
    source: plan?.source || "llm"
  };
}

function fallbackCatalogIntent(message, history) {
  if (isCatalogOverviewRequest(message)) {
    return {
      intent: "catalog_overview",
      query: "",
      count: 0,
      budgetMax: null,
      categoryHints: [],
      constraints: [],
      confidence: 0.85,
      source: "rule"
    };
  }

  const shouldLookup = shouldForceCatalogLookup(message, history);
  if (!shouldLookup) {
    return {
      intent: "chat",
      query: "",
      count: 0,
      budgetMax: null,
      categoryHints: [],
      constraints: [],
      confidence: 0.75,
      source: "rule"
    };
  }

  const text = String(message || "");
  const wantsRecommendation = !isDirectInfoRequest(text) || isCatalogFollowUp(message);
  return {
    intent: wantsRecommendation ? "recommend" : "search",
    query: buildForcedCatalogQuery(message, history),
    count: requestedRecommendationCount(message),
    budgetMax: priceIntent(message).max,
    categoryHints: [],
    constraints: [],
    confidence: 0.7,
    source: "rule"
  };
}

async function planCatalogIntent({ config, message, history, products }) {
  const fallback = fallbackCatalogIntent(message, history);
  const { apiKey, baseUrl, model } = config;
  if (!apiKey) return fallback;

  const system = [
    "你是一个中文导购对话的 Query Planner，只输出严格 JSON。",
    "你的任务是根据当前用户消息和最近上下文，判断这一轮应如何处理，并生成可用于商品库检索的搜索词。",
    "你不能推荐具体商品，不能判断库存最终有无，不能编造商品名、价格、规格或二维码。",
    "推荐入口要主动：只要用户表达了购买意向、品类、口味、预算、送礼对象、使用场景、想买/想要/想找/看看/来点/帮我选，就优先 intent=recommend。",
    "不要因为预算、口味、对象、数量、规格不完整就先追问；信息不足时用已有线索直接推荐最多3款，并把不确定点放到推荐说明里。",
    "如果用户只说“来点吃的”“送朋友买点东西”等泛需求，query 要补充店内可能相关的类目词，例如零食、小吃、甜品、礼盒、伴手礼、红酒、坚果，而不是留成空泛词。",
    "如果用户在问商品有无、价格、预算、扫码入口、想买/想找/推荐/挑选，intent 必须是 search 或 recommend；其中大多数购物需求应选 recommend。",
    "用户问“有没有某类商品”时也优先 recommend，用商品卡直接展示可选项；只有用户明确只是查卖不卖、多少钱、价格或库存，且没有让你挑选/推荐/看看时，intent 才是 search。",
    "如果用户只是寒暄、问能力、闲聊，intent 是 chat。",
    "如果用户问店里有哪些商品、类目、经营范围，intent 是 catalog_overview。",
    "连续对话中，如果当前消息是“那推荐两款”“换几个看看”等省略表达，要结合历史生成完整 query。",
    "当前商品库类目概览如下：",
    buildCatalogSummary(products)
  ].join("\n");

  const user = JSON.stringify({
    currentMessage: message,
    history: normalizeHistory(history),
    requiredShape: {
      intent: "chat | catalog_overview | search | recommend",
      query: "用于商品库检索的完整中文搜索词；chat/catalog_overview 时为空字符串",
      count: "推荐数量，1到3；不是推荐时为0或1",
      budgetMax: "最高预算数字；没有则 null",
      categoryHints: ["用户提到或上下文推出的类目/品类词"],
      constraints: ["口味、用途、对象、规格、价格等约束"],
      confidence: "0到1之间的小数"
    }
  });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(modelRequestBody(config, {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      }))
    });

    if (!response.ok) throw new Error(`Model intent plan request failed with ${response.status}`);

    const data = await response.json();
    const parsed = extractJson(data?.choices?.[0]?.message?.content);
    return normalizeIntentPlan({ ...parsed, source: "llm" }, message, history);
  } catch (error) {
    console.warn(error.message);
    return fallback;
  }
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

  const candidateIds = new Set(candidates.map((candidate) => String(candidate.productId)));
  const valid = parsed.recommendations
    .map((item) => ({
      productId: String(item.productId),
      reason: String(item.reason || "").slice(0, 180),
      angle: String(item.angle || "").slice(0, 40),
      scanPrompt: String(item.scanPrompt || "扫码查看商品详情").slice(0, 60)
    }))
    .filter((item) => candidateIds.has(item.productId))
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

async function streamChatResponse({ config, emit, message, history, products }) {
  const { apiKey, baseUrl, model } = config;
  if (!apiKey) {
    emit("meta", { mode: "chat" });
    emit("token", { text: "当前没有配置大模型服务，我可以处理商品库查询；普通聊天需要配置模型后使用。" });
    return;
  }

  const system = [
    "你是一个中文店铺导购聊天助手。",
    "这一轮已经由后端判定为普通聊天，不是商品库查询或推荐。",
    "不要输出具体商品名、价格、规格、库存、有无售卖结论或二维码信息。",
    "如果用户转而询问商品、价格、推荐、库存或扫码入口，请简短提醒用户直接描述商品需求，后端会查询商品库。",
    "不要输出思考过程、推理过程、<think> 标签或任何隐藏推理内容。",
    "当前商品库类目概览仅供你描述能力边界，不得据此断言具体商品库存：",
    buildCatalogSummary(products)
  ].join("\n");

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
      messages: [
        { role: "system", content: system },
        ...normalizeHistory(history),
        { role: "user", content: message }
      ]
    }))
  });

  if (!response.ok || !response.body) {
    throw new Error(`Model chat request failed with ${response.status}`);
  }

  emit("meta", { mode: "chat" });

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

async function runRecommendationFlow({ products, config, emit, logEntry, recommendationNeed, recommendationCount, toolCall }) {
  const lookupQuery = enrichCatalogQuery(recommendationNeed);
  logEntry.toolCall = toolCall;
  logEntry.recommendationRequest = {
    query: recommendationNeed,
    lookupQuery,
    count: recommendationCount
  };

  const candidateEntries = localCandidateEntries(products, lookupQuery, 18);
  const inventoryMatch = evaluateCatalogCoverage(products, lookupQuery, candidateEntries);
  logEntry.inventoryMatch = {
    matched: inventoryMatch.matched,
    query: inventoryMatch.query,
    topCoverageScore: inventoryMatch.topCoverageScore,
    matchedCount: inventoryMatch.matchedCount,
    availableCategories: inventoryMatch.availableCategories
  };

  if (!inventoryMatch.matched) {
    emit("meta", { mode: "no_match" });
    emit("token", { text: noCatalogMatchText({ ...inventoryMatch, query: recommendationNeed }) });
    return false;
  }

  emit("meta", { mode: "selecting" });

  const scopedCandidateEntries = inventoryMatch.candidateEntries.slice(0, Math.max(6, recommendationCount * 6));
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

  return true;
}

function catalogSearchText(query, entries) {
  const productsForReply = entries
    .map(({ product }) => product)
    .filter(Boolean)
    .slice(0, 3);
  const names = productsForReply.map((product) => `「${product.name}」`).join("、");
  const categories = [
    ...new Set(productsForReply.map((product) => product.category3 || product.category2 || product.category1).filter(Boolean))
  ].join("、");

  if (!productsForReply.length) {
    return `我查了当前商品库，暂时没有和「${query}」明确匹配的商品。`;
  }

  return `我查了当前商品库，有和「${query}」相关的商品，主要集中在${categories || "相关"}类目，比如 ${names}。如果你需要，我可以继续按预算、用途或数量生成推荐卡片。`;
}

async function runCatalogSearchFlow({ products, emit, logEntry, query, count, toolCall }) {
  const lookupQuery = enrichCatalogQuery(query);
  logEntry.toolCall = toolCall;
  logEntry.recommendationRequest = {
    query,
    lookupQuery,
    count
  };

  const candidateEntries = localCandidateEntries(products, lookupQuery, 18);
  const inventoryMatch = evaluateCatalogCoverage(products, lookupQuery, candidateEntries);
  logEntry.inventoryMatch = {
    matched: inventoryMatch.matched,
    query: inventoryMatch.query,
    topCoverageScore: inventoryMatch.topCoverageScore,
    matchedCount: inventoryMatch.matchedCount,
    availableCategories: inventoryMatch.availableCategories
  };

  if (!inventoryMatch.matched) {
    emit("meta", { mode: "no_match" });
    emit("token", { text: noCatalogMatchText({ ...inventoryMatch, query }) });
    return false;
  }

  emit("meta", { mode: "search" });
  emit("token", { text: catalogSearchText(query, inventoryMatch.candidateEntries) });
  return true;
}

export async function createRecommendationStream({ message, history = [], products, config, logContext = {}, onLog }) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const startedAt = new Date();
      const logEntry = {
        schemaVersion: 3,
        requestId: logContext.requestId || globalThis.crypto?.randomUUID?.() || fallbackId(),
        sessionId: logContext.sessionId || "unknown",
        startedAt: startedAt.toISOString(),
        endedAt: null,
        durationMs: null,
        status: "started",
        mode: null,
        client: logContext.client || {},
        userInput: message,
        assistantText: "",
        intentPlan: null,
        toolCall: null,
        inventoryMatch: null,
        recommendationRequest: null,
        recommendations: [],
        feedback: {
          rating: null,
          ratingSubmittedAt: null,
          lowScoreReason: "",
          lowScoreReasonSubmittedAt: null
        },
        interactionEvents: [],
        interactionSummary: {
          productDetailClickCount: 0,
          detailClickedProductIds: [],
          productDetailClicked: false
        },
        productDetailClicked: false,
        error: null
      };

      const emit = (event, payload) => {
        if (event === "meta") logEntry.mode = payload?.mode || null;
        if (event === "recommendations") {
          logEntry.recommendations = (payload?.recommendations || []).map(compactLoggedRecommendation);
        }
        if (event === "token") {
          const text = payload?.text || "";
          logEntry.assistantText += text;
        }
        if (event === "error") {
          logEntry.status = "error";
          logEntry.error = payload?.error || "推荐服务暂时不可用。";
        }
        writeSseChunk(controller, encoder, event, payload);
      };

      try {
        emit("meta", {
          mode: "started",
          requestId: logEntry.requestId,
          sessionId: logEntry.sessionId,
          startedAt: logEntry.startedAt
        });

        const intentPlan = await planCatalogIntent({ config, message, history, products });
        logEntry.intentPlan = intentPlan;

        if (intentPlan.intent === "catalog_overview") {
          emit("meta", { mode: "chat" });
          emit("token", { text: catalogOverviewText(products) });
          emit("done", {
            ok: true,
            requestId: logEntry.requestId,
            sessionId: logEntry.sessionId,
            startedAt: logEntry.startedAt
          });
          logEntry.status = "completed";
          return;
        }

        if (intentPlan.intent === "search") {
          await runCatalogSearchFlow({
            products,
            emit,
            logEntry,
            query: intentPlan.query,
            count: intentPlan.count,
            toolCall: {
              id: "planned_catalog_search",
              name: "search_catalog",
              arguments: {
                query: intentPlan.query,
                count: intentPlan.count,
                planned: true
              }
            }
          });
          emit("done", {
            ok: true,
            requestId: logEntry.requestId,
            sessionId: logEntry.sessionId,
            startedAt: logEntry.startedAt
          });
          logEntry.status = "completed";
          return;
        }

        if (intentPlan.intent === "recommend") {
          await runRecommendationFlow({
            products,
            config,
            emit,
            logEntry,
            recommendationNeed: intentPlan.query,
            recommendationCount: intentPlan.count,
            toolCall: {
              id: "planned_catalog_recommendation",
              name: "recommend_products",
              arguments: {
                query: intentPlan.query,
                count: intentPlan.count,
                planned: true
              }
            }
          });
          emit("done", {
            ok: true,
            requestId: logEntry.requestId,
            sessionId: logEntry.sessionId,
            startedAt: logEntry.startedAt
          });
          logEntry.status = "completed";
          return;
        }

        await streamChatResponse({ config, emit, message, history, products });
        emit("done", {
          ok: true,
          requestId: logEntry.requestId,
          sessionId: logEntry.sessionId,
          startedAt: logEntry.startedAt
        });
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
