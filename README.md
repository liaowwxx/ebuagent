# 店铺智能推荐网页

这是一个面向课程作业场景的对话式商品推荐系统。用户在主页面输入购物需求，系统会结合本地商品库和大模型能力，给出流式回复与商品推荐卡片；用户可以查看商品详情二维码，也可以对推荐结果进行评分。系统会保存对话、推荐、评分和商品详情点击等日志，便于后续分析推荐效果。

## 主要功能

- **对话式商品推荐**：用户用自然语言描述需求，例如“宿舍想囤点零食”“预算一百左右送朋友”，系统会判断是否进入推荐流程，并输出推荐理由。
- **商品卡片展示**：右侧展示推荐商品、价格、规格、推荐理由等信息。
- **商品详情点击**：二维码默认隐藏，用户点击商品详情后再展示二维码，并记录一次 `product_detail_click`。
- **评分反馈**：每次产生推荐后，页面角落会出现 1-10 分评分框；低分时可填写原因。
- **日志保存**：本地运行时写入 `logs/`；Cloudflare Pages 运行时可写入 `CHAT_LOGS` KV。
- **管理员页面**：主页面右上角有管理员入口，管理员登录后可查看、批量导出或删除 Cloudflare KV 中的日志。
- **本地模拟脚本**：可以用预设问题批量模拟用户访问，由模型判断评分和是否点击商品详情。

## 代码结构

```text
.
├── public/
│   ├── index.html          # 主聊天页面
│   ├── app.js              # 前端聊天、商品卡片、评分、详情点击逻辑
│   ├── styles.css          # 主页面样式
│   ├── admin.html          # 管理员页面
│   ├── admin.js            # 管理员登录、KV 列表、导出、删除逻辑
│   ├── admin.css           # 管理员页面样式
│   ├── data/products.json  # 商品知识库
│   └── mini_qrcode_export/ # 商品二维码图片
├── src/
│   ├── recommendation-core.js # 推荐主逻辑：意图判断、候选商品、模型调用、SSE 输出、日志生成
│   ├── log-events.js          # 评分、低分原因、商品详情点击等事件标准化与合并
│   ├── auth.js                # 通用签名 token 工具
│   ├── admin-auth.js          # 管理员登录与权限校验
│   └── rate-limiter.js        # 登录限流
├── functions/api/
│   ├── recommend/stream.js # Cloudflare Pages 推荐接口
│   ├── feedback.js         # Cloudflare Pages 反馈事件接口
│   ├── check.js            # 主页面访问检查
│   ├── login.js            # 旧主页面登录接口，当前主页面默认无需登录
│   └── admin/
│       ├── login.js        # 管理员登录
│       ├── check.js        # 管理员登录态检查
│       └── kv.js           # KV 列表、导出、删除
├── scripts/
│   ├── build-data.py          # 从 商品.xlsx 生成 products.json
│   ├── prepare-public.py      # 复制二维码到 public/
│   └── simulate-agents.mjs    # 本地批量模拟用户访问
├── logs/
│   ├── chat-conversations.jsonl # 本地对话与推荐日志
│   └── chat-events.jsonl        # 本地评分、低分原因、商品详情点击事件
├── server.js               # 本地开发服务器
├── wrangler.toml           # Cloudflare Pages 配置
├── package.json
└── 商品.xlsx
```

`src/` 中的共享模块会同时被 `server.js` 和 Cloudflare Pages Functions 使用，因此尽量保持为标准 ESM，避免依赖只在某一个运行环境存在的 API。

## 本地启动

先准备静态资源：

```bash
npm run build
```

启动本地服务器：

```bash
npm start
```

然后打开：

```text
http://localhost:4173
```

如果修改了 `商品.xlsx`，需要重新生成商品数据：

```bash
npm run build:data
npm run build
```

`scripts/build-data.py` 需要 Python 环境安装 `openpyxl`。

## 环境变量

本地可以创建 `.env` 文件，示例：

```bash
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
OPENAI_API_KEY=your_api_key

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_admin_password
ADMIN_SECRET=random_secret_for_admin_token
```

也支持小写管理员变量名：

```bash
admin_username=admin
admin_password=your_admin_password
admin_secret=random_secret_for_admin_token
```

说明：

- `OPENAI_API_KEY`：大模型 API Key。
- `OPENAI_BASE_URL`：OpenAI-compatible 接口地址。
- `OPENAI_MODEL`：使用的模型名。
- `OPENAI_DISABLE_THINKING=false`：如果模型服务不接受禁用思考参数，可以设置该项。
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`：管理员页面账号密码。
- `ADMIN_SECRET`：管理员登录 token 签名密钥；未配置时会退回使用 `AUTH_SECRET` 或管理员密码。

当前主页面默认无需登录。管理员页面单独使用管理员账号密码。

## 使用方式

### 普通用户

打开主页面后，直接在输入框描述需求即可，例如：

```text
预算一百左右，想买个送朋友的食品礼盒
```

系统会流式生成回复，并在右侧展示推荐商品。点击商品详情后，页面会展示对应小程序二维码，并记录商品详情点击事件。

### 用户评分

当本轮回答产生了推荐商品后，页面角落会出现评分框。用户可以给 1-10 分；如果分数低于 5，页面会询问低分原因。评分、低分原因和商品详情点击都会保存为日志事件。

### 管理员页面

主页面右上角点击“管理”，输入管理员账号密码后进入：

```text
http://localhost:4173/admin.html
```

本地开发服务没有 Cloudflare KV 绑定，因此管理员页面的批量 KV 下载/删除功能需要部署到 Cloudflare Pages 后使用。线上需要绑定 KV Namespace：

```text
CHAT_LOGS
```

管理员页支持：

- 按前缀查看 KV key。
- 批量导出日志为 JSONL。
- 批量删除选中的日志。
- 按前缀批量删除时需要输入 `DELETE` 确认。

## 日志说明

本地运行时会写入两个文件：

```text
logs/chat-conversations.jsonl
logs/chat-events.jsonl
```

`chat-conversations.jsonl` 保存每次用户请求与模型推荐结果，核心字段包括：

- `userInput`：用户本轮输入。
- `assistantText`：模型回复正文。
- `recommendations`：模型推荐的商品列表。
- `startedAt` / `endedAt`：请求时间。
- `requestId` / `sessionId`：用于关联反馈事件。
- `feedback`：评分和低分原因，线上 KV 中会合并进主日志。
- `interactionSummary`：商品详情点击汇总。

`chat-events.jsonl` 保存用户反馈事件，事件类型包括：

- `rating`：用户评分。
- `low_score_reason`：低分原因。
- `product_detail_click`：用户点击商品详情并查看二维码。

Cloudflare Pages 运行时，如果绑定了 `CHAT_LOGS`，主日志会写入类似：

```text
chat/YYYY-MM-DD/sessionId/requestId.json
```

反馈事件会尽量合并进对应主日志；如果主日志暂时不存在，会先作为 pending event 保存。

## 本地模拟脚本

脚本用于批量模拟真实用户访问。问题来自脚本内置问题池，按顺序依次分配，不随机抽取；评分和商品详情点击仍由模型 agent 判断。

运行示例：

```bash
npm run simulate -- --agents 3 --rounds 50 --base-url http://localhost:4173
```

含义：

- `--agents 3`：并行运行 3 个模拟用户。
- `--rounds 50`：每个模拟用户发送 50 个问题。
- 总请求数为 `3 x 50 = 150`。
- 每个问题只进行 1 轮对话。
- 如果没有产生推荐商品，则不会评分、不会填写低分原因、也不会点击商品详情。
- 如果问题数量超过内置问题池长度，脚本会直接报错，不会循环复用问题。

可选参数：

```bash
npm run simulate -- --agents 2 --rounds 20 --out logs/simulate-summary.jsonl
```

`--out` 会额外保存一份模拟摘要，但真实对话和反馈仍会像普通用户一样写入本地日志。

## 部署到 Cloudflare Pages

Cloudflare Pages 构建设置：

```text
Framework preset: None
Build command: npm run build
Build output directory: public
```

需要配置的环境变量：

```text
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
OPENAI_API_KEY=your_api_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_admin_password
ADMIN_SECRET=random_secret
```

如果需要线上保存和管理日志，需要在 Cloudflare Pages 中绑定 KV Namespace：

```text
CHAT_LOGS
```

本地预览 Cloudflare Pages：

```bash
npm run build
npx wrangler pages dev public
```

正常部署建议走 GitHub 自动部署：提交代码后由 Cloudflare Pages 执行 `npm run build` 并发布 `public/`。

## 注意事项

- 不要提交 `.env`。
- `logs/` 中可能包含真实用户输入和反馈，默认不应提交。
- 主页面当前无需密码访问；管理员页面需要单独账号密码。
- 二维码图片来自 `mini_qrcode_export/`，构建时复制到 `public/mini_qrcode_export/`。
- `npm run build` 当前只执行二维码静态资源准备；商品表变更后需要先运行 `npm run build:data`。
