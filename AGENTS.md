# AGENTS.md - stock-ai-assistant

## 最高优先级

本仓库是 A 股智能分析助手的主项目。所有开发者使用 Codex 处理本项目任务前，必须先阅读：

1. `README.md`
2. `CONTRIBUTING.md`
3. `docs/Codex多人开发规范.md`
4. `docs/MVP方案.md`
5. `docs/项目整合记录.md`

## 项目规则

- 以 `weixiao012/stock-ai-assistant` 为唯一主仓库继续开发
- 不再把 `weixiao012/a-share-ai-assistant` 当作独立项目推进
- 开发任务从 `main` 拉分支，使用 PR 合并
- 不覆盖他人未合并改动
- 涉及产品定位、架构、任务或部署变化时，同步更新 `docs/`

## 金融安全边界

- 不承诺任何收益
- 不提供确定性荐股结论
- 不接真实交易下单
- AI 分析必须说明不确定性和风险
- 行情、预测、策略相关展示必须保留数据来源或计算依据

## 本机命令规则

本机 shell 命令优先使用 `rtk` 前缀。Windows 可用：

```powershell
C:\Users\22212\.local\bin\rtk.exe <command>
```

