#!/usr/bin/env node
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "http://localhost:4173";
const DEFAULT_AGENTS = 3;
const DEFAULT_ROUNDS = 5;
const MAX_TURNS_PER_ROUND = 1;

const personas = [
  "大学生，常买宿舍零食，预算敏感，喜欢直接比较价格和分量。",
  "上班族，经常给同事或朋友买小礼物，关注包装和方便扫码。",
  "家庭用户，给家人挑食品，关注规格、口味和是否适合分享。",
  "聚会采购者，偏好酒水、零食组合，关注多人场景。",
  "尝鲜用户，喜欢甜品和进口零食，愿意换品类继续追问。"
];

const questionBank = [
  "宿舍想囤点零食，便宜量大一点的有吗",
  "办公室下午茶想买几样，别太甜，有推荐吗",
  "一百块左右送朋友，想要看起来体面的礼盒",
  "家里人周末一起吃，推荐几款适合分享的零食",
  "最近想买点方便速食，加班晚上吃，推荐一下",
  "有没有适合追剧吃的小零食，价格别太高",
  "给同事带点小礼物，包装好看一点的有什么",
  "想买坚果类礼盒，预算一百以内，帮我挑",
  "有没有不辣的零食组合，家里老人也能吃",
  "想买点甜口的东西，最好扫码就能下单",
  "红酒有没有适合聚会喝的，推荐两款",
  "想试试榴莲甜品，有没有比较合适的",
  "预算五十左右，想买办公室分着吃的零食",
  "方便面整箱有没有性价比高的推荐",
  "想买苹果干这类水果干，有什么选择",
  "送长辈不要太花哨，食品礼盒推荐一下",
  "有没有适合过节走亲戚的礼篮",
  "给客户准备小礼物，预算两百以内",
  "想买年货零食大礼包，东西丰富一点",
  "孩子也能吃的零食，尽量别太刺激",
  "周末朋友来家里，想买点能一起吃的",
  "想买可可或者巧克力类的，有推荐吗",
  "有没有适合早餐临时垫肚子的速食",
  "预算三十以内，想买点小零食",
  "想买几款扫码方便的商品，适合自己吃",
  "宿舍四个人分着吃，推荐便宜一点的",
  "有没有适合女生送礼的小食品",
  "我想买包装精致但别太贵的零食",
  "一百五以内的礼盒，送亲戚合适的",
  "想买粽子礼盒，帮我挑几款",
  "有没有广州酒家这类老牌食品推荐",
  "想买无穷大礼包，或者类似的零食组合",
  "下午茶想配点饼干或甜食，有什么",
  "预算八十以内，送同事不要太寒酸",
  "家里聚餐后吃的零食，推荐几种",
  "有什么适合囤办公室抽屉里的零食",
  "不想买太贵，三四十块有好选择吗",
  "想买一箱方便面，最好适合多人吃",
  "送朋友想要实用一点，不要太浮夸",
  "有没有适合端午送礼的食品",
  "想买花胶或者高汤粽这类礼品，有吗",
  "进口零食有没有适合尝鲜的",
  "想给爸妈买点吃的，别太甜",
  "预算一百左右，坚果和零食礼包哪个更好",
  "聚会想买红酒加零食，先推荐红酒",
  "想买点能当夜宵的东西，别太麻烦",
  "有没有单价低一点、分量大的零食",
  "给室友买生日小礼物，食品类推荐一下",
  "想买几款适合扫码进小程序看的商品",
  "有没有适合全家分享的礼篮",
  "宿舍零食要耐放一点，有推荐吗",
  "办公室开会准备小食，方便分发的",
  "预算两百以内，想买比较有档次的礼盒",
  "追剧想吃咸口零食，不要甜的",
  "想买点健康一点的零食，水果干之类",
  "有没有品牌比较熟悉的食品礼盒",
  "方便速食里哪几款适合囤货",
  "想买过年送人的大礼包，丰富一点",
  "给朋友带伴手礼，最好价格清楚",
  "有没有适合情侣一起吃的甜品零食",
  "想买一款不容易踩雷的坚果礼盒",
  "预算五十到一百，办公室下午茶怎么选",
  "家里老人不吃辣，推荐温和一点的",
  "想买零食但不知道买什么，给我三款",
  "有没有适合小型聚会的食品组合",
  "想买粽子，不一定送礼，自己家吃",
  "红酒预算别太高，聚餐喝就行",
  "有没有榴莲味比较明显的甜品",
  "想买巧克力或者可可，送人也能看",
  "宿舍想囤整箱的，最好实惠",
  "给同事每人分一点，有什么合适",
  "预算一百，想买礼盒不要太小",
  "有没有适合加班团队分着吃的",
  "想买点茶包或饮品类的食品",
  "儿童能吃的零食礼盒有没有",
  "想买品牌零食大礼包，推荐几个",
  "端午礼品不要太贵，有什么",
  "有没有适合送客户的高端一点食品",
  "自己吃想尝鲜，推荐不常见的",
  "想买苹果干，和别的零食搭配推荐",
  "宿舍预算有限，三款以内就行",
  "办公室下午茶需要看起来干净卫生",
  "想买可直接扫码查看详情的商品",
  "给家人买点饭后零食，甜咸都行",
  "有没有适合多人分享的大包装",
  "预算八十左右，有没有体面礼品",
  "想买方便面和零食混着囤",
  "朋友喜欢甜食，送什么合适",
  "长辈喜欢传统食品，推荐一下",
  "聚会红酒有没有入门选择",
  "想买一款高汤粽礼盒，价格别太离谱",
  "有没有适合节日送礼的组合",
  "孩子放学吃的小点心，有推荐吗",
  "想买便宜但包装不差的食品",
  "给老师送个小礼，食品类怎么选",
  "有没有一百以内坚果礼盒",
  "想买无穷这类肉类零食礼包",
  "预算三十到五十，水果干推荐",
  "加班晚上想吃热乎点的速食",
  "想买几款小程序里能直接看的",
  "朋友来打牌，买点什么零食",
  "给家里备点方便食品，有什么",
  "想买礼篮，价格中等就行",
  "有没有适合公司活动采购的零食",
  "宿舍不方便做饭，速食推荐",
  "办公室想买不掉渣的小零食",
  "送朋友想要品牌知名一点",
  "想买甜品但怕太腻，推荐轻一点的",
  "红酒送人和聚会喝分别推荐",
  "有没有适合父母的食品礼盒",
  "想买粽子类，但不要太贵",
  "预算一百五，礼盒越丰富越好",
  "自己吃零食，优先性价比",
  "给同学带零食，便宜一点",
  "有没有办公室能长期囤的",
  "想买茶包饮品，搭配甜食也行",
  "家庭看电视吃的零食推荐",
  "客户拜访带什么食品合适",
  "有没有适合节后回礼的小礼盒",
  "想买水果干给女生朋友",
  "方便面有没有桶装整箱的",
  "坚果礼盒送礼会不会合适，推荐几款",
  "想买一款价格明确的礼品",
  "有没有一百块上下的年货礼包",
  "聚餐想买点酒水，先看红酒",
  "想试试进口巧克力或可可",
  "儿童零食别太甜，有没有",
  "宿舍零食要能放久一点",
  "办公室下午茶预算每人十几块",
  "端午走亲戚买什么比较稳",
  "给爸妈买传统口味食品",
  "想买花胶礼盒送人，推荐一下",
  "有没有适合周末野餐带的零食",
  "想买三只松鼠这类礼盒",
  "预算五十，有没有像样的礼物",
  "朋友喜欢咸口零食，推荐一下",
  "追剧零食想要甜咸搭配",
  "想买点看起来高级的食品",
  "有没有适合扫码看详情后购买的",
  "办公室茶水间补货，买什么",
  "家庭囤货，速食和零食都可以",
  "一百以内送同事，食品别太普通",
  "想买适合年轻人的零食礼包",
  "有没有适合老人小孩一起吃的",
  "聚会人多，推荐分量大的",
  "想买两三款礼品做备选",
  "预算两百，送客户不要失礼",
  "自己想吃点甜的，推荐具体商品",
  "有没有适合早餐和夜宵两用的",
  "想买红酒，价格别太夸张",
  "办公室分发的小包装零食有吗",
  "给宿舍买一批，越实惠越好",
  "送礼想要有品牌和包装",
  "家庭聚餐后甜点零食推荐",
  "有没有适合临时送人的食品",
  "想买一款礼盒和一款自吃零食",
  "预算一百左右，综合推荐三款",
  "想买点适合女生宿舍分享的零食",
  "办公室下午茶想要不占地方的小包装",
  "给男生朋友送食品，预算一百以内",
  "家里有老人小孩，推荐温和一点的零食",
  "聚会想买酒水和零食，先推荐吃的",
  "加班餐不想点外卖，有什么速食",
  "早餐来不及做饭，推荐方便食品",
  "追剧想买甜口和咸口各一款",
  "长辈不喜欢新奇口味，送什么稳妥",
  "儿童节想买小朋友能吃的食品",
  "宿舍零食想要价格低但量多",
  "办公室零食要适合大家分着吃",
  "家庭聚餐想准备几样饭后小食",
  "朋友生日送吃的，包装要好看",
  "小型聚会十个人左右，推荐零食",
  "晚上加班想吃泡面类的东西",
  "早上垫肚子的食品，有没有推荐",
  "追剧零食别太贵，三款以内",
  "给长辈送食品，最好不要太甜",
  "给孩子买零食，想要清淡一点",
  "坚果礼盒有没有适合送领导的",
  "方便面整箱买哪款比较划算",
  "苹果干适合送人吗，推荐一下",
  "可可茶包有没有适合办公室喝的",
  "粽子礼篮哪款更适合走亲戚",
  "年货礼包想要种类多一点",
  "榴莲甜品适合尝鲜的推荐",
  "红酒送朋友有没有不贵的",
  "进口零食想买一两款试试",
  "巧克力类送人推荐具体商品",
  "饼干类下午茶有没有合适的",
  "饮品类有没有适合搭配零食的",
  "高汤粽礼盒送长辈合适吗",
  "花胶礼盒预算两百以内有吗",
  "零食大礼包想要肉类多一点",
  "预算二十多买点小零食有吗",
  "预算四十左右办公室零食推荐",
  "预算六十左右送朋友食品",
  "预算九十以内礼盒推荐",
  "预算一百二左右送亲戚",
  "预算一百八以内客户礼品",
  "想买便携食品，出门路上吃",
  "想买不需要加热的零食",
  "想买需要热水就能吃的速食",
  "想买适合茶水间摆放的零食",
  "想买几样看电影时吃的",
  "想买适合宿舍夜宵的",
  "想买能放进抽屉里的小零食",
  "想买分量大的礼盒，送家人",
  "想买品牌感强一点的礼品",
  "想买传统口味的食品礼盒",
  "想买年轻人会喜欢的甜食",
  "想买不辣不油的食品",
  "想买有扫码二维码的商品",
  "想买能直接看详情的推荐",
  "想买两款低价和一款礼盒",
  "想买一款办公室吃的一款送人的",
  "想买适合周五下午茶的",
  "想买适合部门活动的零食",
  "想买给室友分着吃的",
  "想买给爸妈寄回家的食品",
  "想买给朋友的零食组合",
  "想买公司前台能放的小食",
  "想买客户拜访随手带的",
  "想买亲戚聚餐能带的礼盒",
  "想买过节备用礼品两三款",
  "想买小朋友和大人都能吃的",
  "想买甜味不要太重的甜品",
  "想买咸香一点的休闲食品",
  "想买价格明确方便比较的商品",
  "想买一百以内扫码下单方便的",
  "想买适合午休后吃的小零食",
  "想买办公室新人入职分享的",
  "想买毕业季送同学的小食品",
  "想买开学宿舍囤货推荐",
  "想买节日礼盒但别太正式",
  "想买看起来高级但价格适中的",
  "想买红酒和巧克力搭配送人",
  "想买水果干和坚果搭配",
  "想买方便面加零食组合",
  "想买礼篮和大礼包比较一下",
  "想买端午礼品和日常自吃都合适的",
  "想买办公室下午茶，优先不辣",
  "想买家庭零食，优先不太甜",
  "想买宿舍零食，优先耐放",
  "想买朋友礼物，优先包装",
  "想买聚会食品，优先分量",
  "想买加班夜宵，优先方便",
  "想买早餐速食，优先省事",
  "想买追剧食品，优先口味丰富",
  "想买长辈礼品，优先稳妥",
  "想买儿童零食，优先清淡",
  "想买客户礼品，优先体面",
  "想买同事礼物，优先实用",
  "想买家用囤货，优先性价比",
  "想买节日走访，优先不出错",
  "想买自己尝鲜，优先特别一点",
  "想买零食礼包，预算一百左右",
  "想买速食食品，预算五十左右",
  "想买送礼食品，预算两百以内",
  "想买下午茶食品，预算八十以内",
  "想买聚会零食，预算一百五以内"
];

function usage() {
  return [
    "Usage: node scripts/simulate-agents.mjs [options]",
    "",
    "Options:",
    `  --base-url <url>    Local site URL. Default: ${DEFAULT_BASE_URL}`,
    `  --agents <number>   Concurrent simulated users. Default: ${DEFAULT_AGENTS}`,
    `  --rounds <number>   Complete conversation rounds per user. Default: ${DEFAULT_ROUNDS}`,
    "  --model <model>     Override OPENAI_MODEL",
    "  --out <path>        Optional JSONL summary output path",
    "  --help              Show this help"
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    agents: DEFAULT_AGENTS,
    rounds: DEFAULT_ROUNDS,
    model: "",
    out: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    const next = argv[index + 1];
    if (arg === "--base-url") {
      args.baseUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--agents") {
      args.agents = positiveInt(requireValue(arg, next), arg);
      index += 1;
    } else if (arg === "--rounds") {
      args.rounds = positiveInt(requireValue(arg, next), arg);
      index += 1;
    } else if (arg === "--model") {
      args.model = requireValue(arg, next);
      index += 1;
    } else if (arg === "--out") {
      args.out = requireValue(arg, next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  return args;
}

function requireValue(name, value) {
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function positiveInt(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

async function loadLocalEnv(filePath = ".env") {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function modelConfig(args) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required because rating and click decisions are generated by the model.");
  }

  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: args.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    disableThinking: process.env.OPENAI_DISABLE_THINKING !== "false"
  };
}

function modelRequestBody(config, body) {
  const requestBody = { ...body };
  const hostname = new URL(config.baseUrl).hostname;
  const isOpenAI = /(^|\.)openai\.com$/i.test(hostname);

  if (config.disableThinking && !isOpenAI) {
    requestBody.enable_thinking = false;
    requestBody.thinking = { type: "disabled" };
  }

  return requestBody;
}

async function callJsonModel(config, { system, user, temperature = 0.4 }) {
  const url = `${config.baseUrl}/chat/completions`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(modelRequestBody(config, {
        model: config.model,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) }
        ]
      }))
    });
  } catch (error) {
    throw new Error(`Model request could not reach ${url}: ${networkCause(error)}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Model request failed with ${response.status}: ${text.slice(0, 240)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return extractJson(content);
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function normalizeHistory(history) {
  return history
    .filter((item) => item?.content && ["user", "assistant"].includes(item.role))
    .slice(-12);
}

function plannedQuestionCount(args) {
  return args.agents * args.rounds;
}

function assertQuestionCapacity(args) {
  const required = plannedQuestionCount(args);
  if (required > questionBank.length) {
    throw new Error(
      `Question bank has ${questionBank.length} questions, but this run needs ${required}. ` +
        "Lower --agents/--rounds or add more questions."
    );
  }
}

function selectQuestion(agentId, round, agentCount) {
  const directIndex = (round - 1) * agentCount + (agentId - 1);
  return questionBank[directIndex];
}

async function decideNextAction(config, agent, roundResult) {
  const products = roundResult.recommendations.map((item) => ({
    productId: item.productId,
    name: item.name,
    priceMin: item.priceMin,
    priceMax: item.priceMax,
    reason: item.reason,
    angle: item.angle
  }));

  const result = await callJsonModel(config, {
    system: [
      "你是电商导购测试中的模拟用户评价器。",
      "你要根据用户问题、AI回答和商品推荐，决定评分和是否点击商品详情。",
      "评分要接近普通用户，但必须拉开差异，不要把 8 当作默认分。",
      "按匹配度、场景贴合度、价格/预算贴合度、推荐理由清楚程度、商品数量综合评分。",
      "10 分：完全命中需求，商品、价格、场景和理由都非常合适，几乎可以直接购买。",
      "9 分：非常满意，只有很小瑕疵。",
      "8 分：满意但普通，有用但没有特别精准或惊喜；只能在确实明显满意时使用。",
      "7 分：基本可用，部分商品相关，但理由或场景贴合一般。",
      "6 分：勉强可用，有明显缺失，例如预算不准、品类偏离、解释太泛。",
      "5 分：不太满意，但仍有一点参考价值。",
      "1-4 分：明显答非所问、推荐很少且不匹配、或无法解决当前需求。",
      "如果推荐商品只有 1 个，除非特别精准，否则不要高于 7 分。",
      "如果推荐商品有 2-3 个但理由泛泛，通常给 6-7 分，不要自动给 8。",
      "如果用户有明确预算而推荐价格明显不合适，评分应降低。",
      "同一批测试中评分应自然分布在 5-10 之间，低分可以少，但不要集中在 8。",
      "只输出严格 JSON。"
    ].join("\n"),
    user: {
      persona: agent.persona,
      taskRound: roundResult.taskRound,
      turn: roundResult.turn,
      maxTurnsPerRound: MAX_TURNS_PER_ROUND,
      maxRounds: agent.maxRounds,
      userMessage: roundResult.message,
      assistantText: roundResult.assistantText.slice(0, 3000),
      recommendations: products,
      requiredShape: {
        rating: "1到10的整数",
        lowScoreReason: "rating低于5时可以填写原因；也可以为空字符串",
        detailClicks: ["想查看详情的 productId；可以为空；只能使用 recommendations 中的 productId"]
      }
    },
    temperature: 0.35
  });

  const validIds = new Set(products.map((item) => String(item.productId)));
  const parsedRating = Number(result?.rating);
  const rating = Number.isFinite(parsedRating)
    ? Math.max(1, Math.min(10, Math.round(parsedRating)))
    : fallbackRating(roundResult, products);
  const detailClicks = Array.isArray(result?.detailClicks)
    ? [...new Set(result.detailClicks.map((id) => String(id)).filter((id) => validIds.has(id)))]
    : [];

  return {
    rating,
    lowScoreReason: rating < 5
      ? String(result?.lowScoreReason || "").trim().slice(0, 500)
      : "",
    detailClicks,
    continueConversation: false,
    nextIntentHint: ""
  };
}

function fallbackRating(roundResult, products) {
  const recommendationCount = products.length;
  const text = `${roundResult.message}\n${roundResult.assistantText}`.toLowerCase();
  let score = recommendationCount >= 3 ? 7 : recommendationCount === 2 ? 6 : 5;

  if (/预算|以内|左右|别太贵|便宜|价格|性价比/.test(roundResult.message)) {
    const hasPrice = products.some((item) => Number.isFinite(Number(item.priceMin)) || Number.isFinite(Number(item.priceMax)));
    score += hasPrice ? 1 : -1;
  }

  if (/送|礼|客户|长辈|朋友|同事|家人|聚会|宿舍|办公室/.test(roundResult.message)) {
    score += /送|礼|客户|长辈|朋友|同事|家人|聚会|宿舍|办公室/.test(text) ? 1 : -1;
  }

  if (products.some((item) => item.reason || item.angle)) score += 1;
  return Math.max(1, Math.min(9, score));
}

async function requestRecommendation(baseUrl, { message, sessionId, history }) {
  const url = `${baseUrl}/api/recommend/stream`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, sessionId, history: normalizeHistory(history) })
    });
  } catch (error) {
    throw new Error(`Recommendation request could not reach ${url}: ${networkCause(error)}`);
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Recommendation request failed with ${response.status}: ${text.slice(0, 240)}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  const result = {
    requestId: "",
    sessionId,
    startedAt: "",
    modes: [],
    recommendations: [],
    assistantText: ""
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const event = parseSseEvent(rawEvent);
      if (!event) continue;

      if (event.event === "meta") {
        if (event.data.mode) result.modes.push(event.data.mode);
        captureContext(result, event.data);
      } else if (event.event === "recommendations") {
        result.recommendations = event.data.recommendations || [];
      } else if (event.event === "token") {
        result.assistantText += event.data.text || "";
      } else if (event.event === "done") {
        captureContext(result, event.data);
      } else if (event.event === "error") {
        throw new Error(event.data.error || "Recommendation stream returned an error.");
      }
    }
  }

  if (!result.requestId || !result.startedAt) {
    throw new Error("Recommendation stream did not return request context.");
  }

  return result;
}

function captureContext(result, data) {
  if (data?.requestId) result.requestId = String(data.requestId);
  if (data?.sessionId) result.sessionId = String(data.sessionId);
  if (data?.startedAt) result.startedAt = String(data.startedAt);
}

function parseSseEvent(rawEvent) {
  let event = "message";
  const dataLines = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  return { event, data: JSON.parse(dataLines.join("\n")) };
}

async function postFeedback(baseUrl, context, eventType, payload = {}) {
  const url = `${baseUrl}/api/feedback`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: context.requestId,
        sessionId: context.sessionId,
        startedAt: context.startedAt,
        eventType,
        ...payload
      })
    });
  } catch (error) {
    throw new Error(`Feedback ${eventType} could not reach ${url}: ${networkCause(error)}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Feedback ${eventType} failed with ${response.status}: ${text.slice(0, 240)}`);
  }
}

async function writeSummary(outPath, summary) {
  if (!outPath) return;
  await mkdir(path.dirname(outPath), { recursive: true });
  await appendFile(outPath, `${JSON.stringify(summary)}\n`, "utf8");
}

function networkCause(error) {
  const cause = error?.cause;
  const parts = [
    error?.message,
    cause?.code,
    cause?.message
  ].filter(Boolean);
  return parts.join(" - ") || "network error";
}

async function preflight(baseUrl) {
  const url = `${baseUrl}/api/check`;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Local site is not reachable at ${url}: ${networkCause(error)}. Start it with "npm start" or pass --base-url to the running server.`
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Local site check failed with ${response.status}: ${text.slice(0, 240)}`);
  }
}

async function runAgent({ id, args, config, outPath }) {
  const agent = {
    id,
    persona: personas[(id - 1) % personas.length],
    sessionId: globalThis.crypto?.randomUUID?.() || fallbackSessionId(),
    maxRounds: args.rounds,
    history: []
  };

  const summaries = [];

  for (let taskRound = 1; taskRound <= args.rounds; taskRound += 1) {
    agent.history = [];
    const turn = 1;
    const startedAt = Date.now();
    try {
      const message = selectQuestion(id, taskRound, args.agents);
      const recommendation = await requestRecommendation(args.baseUrl, {
        message,
        sessionId: agent.sessionId,
        history: agent.history
      });

      let decision = null;
      if (recommendation.recommendations.length > 0) {
        decision = await decideNextAction(config, agent, {
          taskRound,
          turn,
          message,
          assistantText: recommendation.assistantText,
          recommendations: recommendation.recommendations
        });
        await postFeedback(args.baseUrl, recommendation, "rating", { rating: decision.rating });
        if (decision.rating < 5 && decision.lowScoreReason) {
          await postFeedback(args.baseUrl, recommendation, "low_score_reason", {
            reason: decision.lowScoreReason
          });
        }

        const productMap = new Map(recommendation.recommendations.map((item) => [String(item.productId), item]));
        for (const productId of decision.detailClicks) {
          const product = productMap.get(String(productId));
          if (!product) continue;
          await postFeedback(args.baseUrl, recommendation, "product_detail_click", {
            productId: product.productId,
            productName: product.name,
            source: "detail_button"
          });
        }

      }

      const summary = {
        agentId: id,
        sessionId: agent.sessionId,
        round: taskRound,
        turn,
        ok: true,
        requestId: recommendation.requestId,
        mode: recommendation.modes.at(-1) || "",
        message,
        recommendationCount: recommendation.recommendations.length,
        rating: decision?.rating ?? null,
        skippedEvaluation: recommendation.recommendations.length === 0,
        lowScore: decision ? decision.rating < 5 : false,
        lowScoreReasonProvided: Boolean(decision?.lowScoreReason),
        detailClickCount: decision?.detailClicks.length ?? 0,
        continueConversation: false,
        roundComplete: true,
        durationMs: Date.now() - startedAt
      };
      summaries.push(summary);
      await writeSummary(outPath, summary);

      console.log(
        `[agent ${id} round ${taskRound}] ${message} | recs=${summary.recommendationCount} ` +
          `rating=${summary.rating ?? "skip"} details=${summary.detailClickCount}`
      );
    } catch (error) {
      const summary = {
        agentId: id,
        sessionId: agent.sessionId,
        round: taskRound,
        turn,
        ok: false,
        error: error.message,
        durationMs: Date.now() - startedAt
      };
      summaries.push(summary);
      await writeSummary(outPath, summary);
      console.error(`[agent ${id} round ${taskRound}] failed: ${error.message}`);
      return summaries;
    }
  }

  return summaries;
}

function fallbackSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function printFinalSummary(allSummaries) {
  const turns = allSummaries.flat();
  const successful = turns.filter((item) => item.ok);
  const failed = turns.filter((item) => !item.ok);
  const ratings = successful.map((item) => item.rating).filter(Number.isFinite);
  const averageRating = ratings.length
    ? ratings.reduce((sum, item) => sum + item, 0) / ratings.length
    : 0;
  const detailClicks = successful.reduce((sum, item) => sum + (item.detailClickCount || 0), 0);
  const lowScores = successful.filter((item) => item.lowScore).length;
  const completedRounds = successful.filter((item) => item.roundComplete).length;
  const skippedEvaluations = successful.filter((item) => item.skippedEvaluation).length;

  console.log("");
  console.log("Simulation summary");
  console.log(`  completed rounds: ${completedRounds}`);
  console.log(`  conversation turns: ${turns.length}`);
  console.log(`  successful turns: ${successful.length}`);
  console.log(`  failed turns: ${failed.length}`);
  console.log(`  skipped evaluations: ${skippedEvaluations}`);
  console.log(`  average rating: ${averageRating.toFixed(2)}`);
  console.log(`  low scores: ${lowScores}`);
  console.log(`  product detail clicks: ${detailClicks}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  await loadLocalEnv();
  const config = modelConfig(args);
  assertQuestionCapacity(args);
  await preflight(args.baseUrl);

  const outPath = args.out ? path.resolve(args.out) : "";
  console.log(
    `Starting simulation: agents=${args.agents}, rounds=${args.rounds}, questions=${plannedQuestionCount(args)}/${questionBank.length}, maxTurnsPerRound=${MAX_TURNS_PER_ROUND}, baseUrl=${args.baseUrl}, model=${config.model}`
  );

  const allSummaries = await Promise.all(
    Array.from({ length: args.agents }, (_, index) =>
      runAgent({ id: index + 1, args, config, outPath })
    )
  );

  printFinalSummary(allSummaries);
  if (allSummaries.flat().some((item) => !item.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
