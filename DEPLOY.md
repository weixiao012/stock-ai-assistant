# 长期公网部署

推荐使用 Render Web Service 部署本项目。

## 部署参数

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Port: 使用平台自动注入的 `PORT`

## 注意

- 部署后会得到长期公网地址，例如 `https://stock-ai-assistant.onrender.com`。
- 免费服务可能会休眠，首次访问会慢一些。
- 当前预测记录存放在 `data/*.json`。如果平台重建实例，这些记录可能会丢失；后续应接入数据库持久化。
