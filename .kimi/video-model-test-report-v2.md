# 视频模型测试报告 V2（修正版）

## 测试时间：2026-05-26T02:41:50.659Z
## 测试方法：POST /v1/video/create（Veo/即梦）+ /minimax/v1/video_generation（Hailuo）

| 模型 | 路由 | 测试模式 | 结果 | 耗时 | 错误 |
|:---|:---|:---|:---|:---|:---|
| veo3.1-fast | /v1/video/create | first-last | ❌ | - | Submit 503: {"error":{"message":"分组 default 下模型 veo3.1-fast 无可用渠道（distributor） (request id: 2026052610361689101286gCYDbuQf)","type":"new_api_error"}} |
| veo3.1-pro | /v1/video/create | first-last | ❌ | - | Submit 503: {"error":{"message":"分组 default 下模型 veo3.1-pro 无可用渠道（distributor） (request id: 20260526103629915695776rF2D3daA)","type":"new_api_error"}} |
| veo2-fast-frames | /v1/video/create | first-last | ❌ | - | Submit 503: {"error":{"message":"分组 default 下模型 veo2-fast-frames 无可用渠道（distributor） (request id: 20260526103647925570578m029SzxV)","type":"new_api_error"}} |
| jimeng-video-3.0 | /v1/video/create | first-last | ❌ | - | Submit 503: {"error":{"message":"分组 default 下模型 jimeng-video-3.0 无可用渠道（distributor） (request id: 20260526103701767761938RE9gb3ck)","type":"new_api_error"}} |
| jimeng-video-3.0 | /v1/video/create | first-only | ❌ | - | Submit 503: {"error":{"message":"分组 default 下模型 jimeng-video-3.0 无可用渠道（distributor） (request id: 20260526103713841874193ckI2cRRv)","type":"new_api_error"}} |
| MiniMax-Hailuo-02 | /minimax/v1/video_generation | first-last | ✅ | 270.3s | - |

## 结论
- 首尾帧支持：1 个
- 仅首帧支持：0 个
- 失败：5 个

## 建议接入的模型
- `MiniMax-Hailuo-02` — 支持首尾帧

