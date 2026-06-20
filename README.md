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

没有配置 `OPENAI_API_KEY` 时，会自动使用本地规则推荐，仍然能返回商品和二维码。

前端使用 `/api/recommend/stream` 接收 SSE 流式输出；后端会先让大模型从候选商品里选择右侧推荐卡片，再让聊天区基于这些结果流式撰写中性、事实导向的推荐说明。

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
