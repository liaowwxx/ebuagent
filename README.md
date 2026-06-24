# 店铺智能推荐网页

一个面向顾客自助使用的对话式商品推荐智能体。页面左侧展示流式聊天分析，右侧展示由大模型生成的商品推荐卡片、推荐理由、价格规格和小程序二维码。

## 本地测试启动

```bash
npm run build
npm start
```

打开 http://localhost:4173

**本地鉴权：** 在 `.env` 中设置 `AUTH_USERNAME` 和 `AUTH_PASSWORD` 即可启用登录。留空则不启用鉴权。
这个.env没有上传到github，所以可以自己创建一个。
里面填写的内容类似如下：

```bash
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
OPENAI_API_KEY=your api key


AUTH_USERNAME=ciallo
AUTH_PASSWORD=forzahorizon6
AUTH_SECRET=9e96c350716659be7b820b1f9ee76cccde060ff44848ade9448b9be4484f3009
```

## 接入大模型

服务端读取 OpenAI-compatible 环境变量：

```bash
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=
```

没有配置 `OPENAI_API_KEY` 时，后端不会自动生成商品卡片，只会在主聊天窗口提示需要配置模型服务。

前端使用 `/api/recommend/stream` 接收 SSE 流式输出，并会携带最近几轮连续对话上下文。后端先让大模型正常聊天，并提供 `recommend_products` 工具；只有模型主动调用该工具时，后端才会进入推荐流程。推荐流程会先用当前商品库做覆盖性检查：如果用户要的品类或商品与商品库没有明确匹配，会直接在主聊天窗口说明暂无该类商品并询问是否查看现有类目，不生成右侧商品卡片；只有通过覆盖性检查后，才会从候选商品中生成推荐卡片和二维码。普通聊天、追问澄清或解释流程时只在主聊天窗口回复。

默认会向非 OpenAI 官方兼容接口发送禁用思考参数：

```json
{
  "enable_thinking": false,
  "thinking": { "type": "disabled" }
}
```

如果你的模型服务不接受这些参数，可以设置：

```bash
OPENAI_DISABLE_THINKING=false
```

## 对话记录与隐私声明

页面会在登录页和聊天区开始位置展示数据隐私声明：用户聊天可能会被记录，聊天数据仅用于课程学习、服务优化等类似用途。

本地 `npm start` 运行时，每轮用户提问和 AI 回复会自动追加保存到：

```text
logs/chat-conversations.jsonl
```

每一行是一条 JSON 记录。当前日志结构为 `schemaVersion: 2`，包含请求 ID、浏览器会话 ID、开始/结束时间、耗时、登录用户名（如已启用鉴权）、客户端信息、推荐模式、工具调用、商品库覆盖性检查、推荐请求、推荐商品明细和错误信息等。连续对话内容保存在 `conversation` 字段：

```json
{
  "conversation": {
    "history": [{ "role": "user", "content": "上一轮用户消息" }],
    "currentTurn": {
      "user": { "role": "user", "content": "本轮用户消息" },
      "assistant": { "role": "assistant", "content": "本轮 AI 回复" }
    },
    "messages": []
  }
}
```

其中 `messages` 会在本轮结束时写入完整上下文快照：历史消息 + 本轮用户消息 + 本轮 AI 回复。旧的 `dialogue` 字段暂时保留，用于兼容已有日志读取方式。`logs/` 已加入 `.gitignore`，避免误提交真实聊天数据。

Cloudflare Pages 运行时不能稳定写本地文件。如果需要线上持久化保存对话，请创建 KV Namespace 并绑定变量名：

```text
CHAT_LOGS
```

绑定后，每轮对话会以 `chat/YYYY-MM-DD/sessionId/requestId.json` 的 key 写入 KV；KV metadata 会包含 `schemaVersion`、`sessionId`、`status`、`mode`、`hasRecommendations` 和 `startedAt`。未绑定时会退回输出到 Cloudflare Functions 日志。

## 更新商品数据

当 `商品.xlsx` 或 `mini_qrcode_export/` 更新后，重新生成商品知识库：

```bash
python3 scripts/build-data.py
npm run prepare:public
```

`scripts/build-data.py` 需要 Python 环境里安装 `openpyxl`。Cloudflare Pages 部署时默认使用已提交的 `public/data/products.json`，不会在云端解析 Excel。

## 部署到 Cloudflare Pages

**本地运行没问题以后push代码到github，等几分钟会自动加载你的更改**

项目已包含 Cloudflare Pages Functions：

```text
functions/api/recommend/stream.js
functions/api/login.js
functions/api/check.js
```

Cloudflare Pages 构建设置：

```text
Framework preset: None
Build command: npm run build
Build output directory: public
```

在 Cloudflare Pages 的环境变量中配置：

```text
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
OPENAI_API_KEY=你的新 DeepSeek key
AUTH_USERNAME=你的登录账号
AUTH_PASSWORD=你的登录密码
AUTH_SECRET=一个随机字符串（用于签名会话令牌）
```

> `AUTH_SECRET` 可以用 `openssl rand -hex 32` 生成。

不要上传本地 `.env`。

如果使用 Wrangler 本地预览/部署：

```bash
npm run build
npx wrangler pages dev public
```

然后在另一个终端设置 Pages 项目的生产环境变量，或在 Cloudflare Dashboard 里配置。部署推荐走 GitHub 自动部署：提交代码后由 Cloudflare Pages 执行 `npm run build`。
