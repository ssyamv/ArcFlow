Gateway 向飞书群发送技术评审消息卡片，包含文档摘要和「通过/打回」快捷按钮。研发点击按钮后，飞书回调 Gateway 的 /webhook/feishu 端点，Gateway 根据结果更新 Plane Issue 状态或通知相关人员修改。
