# 视频模型首尾帧测试报告（修正版）

## 测试时间：2026-05-26
## 测试方法：复用异步任务协议（submit → poll）

| 模型 | 首尾帧支持 | 首帧支持 | 推荐度 | 错误 |
|:---|:---|:---|:---|:---|
| MiniMax-Hailuo-02 | ✅ | ❌ | ⭐⭐⭐⭐⭐ | - |
| jimeng-video | ❌ | ❌ | ❌ | Jimeng 失败: XiaomiAPI 503: {"error":{"message":"分组 default 下模型 jimeng-videos 无可用渠道（distributor） (request id: 20260526094830862899971nTSRD4me)","type":"new_api_error"}} |

## 结论
- 完全支持首尾帧的模型：1 个
- 仅支持首帧的模型：0 个
- 完全不支持的模型：1 个

## 建议接入网站的模型
- `MiniMax-Hailuo-02` — 支持首尾帧

