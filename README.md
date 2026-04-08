# Codey CLI（TypeScript + Vite + Playwright）

这是一个单入口 CLI 项目：

- 单入口：`C:\Users\Summp\Desktop\codey\src\cli.ts`
- 构建：Vite
- 浏览器自动化：Playwright Library
- 邮箱管理：仅支持 Exchange

## 主要能力

- OpenAI / ChatGPT 页面流程校验
- Codex OAuth 授权码流
- 母号/子号注册
- 母号/子号登录
- Exchange 邮箱文件夹与邮件列表管理

## CLI 用法

```bash
codey flow openai-home
codey flow chatgpt-entry
codey exchange folders
codey exchange messages --maxItems 10 --unreadOnly true
```

开发态也可直接运行：

```bash
npm run dev -- flow openai-home
```

## 构建

```bash
npm run build
```

输出：

```text
C:\Users\Summp\Desktop\codey\dist\codey.js
```

## 配置

支持：

- `.env`
- `--config your-config.json`
- CLI flags 覆盖

示例配置文件：

```json
{
  "artifactsDir": "C:\\Users\\Summp\\Desktop\\codey\\artifacts",
  "browser": {
    "headless": false,
    "slowMo": 0,
    "defaultTimeoutMs": 15000,
    "navigationTimeoutMs": 30000,
    "browsersPath": "C:\\Users\\Summp\\Desktop\\codey\\.playwright-browsers"
  },
  "openai": {
    "baseUrl": "https://openai.com",
    "chatgptUrl": "https://chatgpt.com"
  },
  "exchange": {
    "endpoint": "https://mail.example.com/EWS/Exchange.asmx",
    "mailbox": "user@example.com",
    "auth": {
      "mode": "basic",
      "username": "user@example.com",
      "password": "secret"
    }
  }
}
```

## Exchange 模块

当前仅支持 Exchange Web Services（EWS）：

- 列出文件夹
- 列出邮件

CLI：

```bash
codey exchange folders --config exchange.json
codey exchange messages --config exchange.json --maxItems 20
```

环境变量：

- `EXCHANGE_ENDPOINT`
- `EXCHANGE_USERNAME`
- `EXCHANGE_PASSWORD`
- `EXCHANGE_MAILBOX`

## 项目结构

```text
src/
  cli.ts
  config.ts
  index.ts
  core/
  flows/
  modules/
    authorization/
    registration/
    login/
    exchange/
scripts/
  install-chromium.ts
vite.config.ts
```
