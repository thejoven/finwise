# twtapi.com 真实响应样本 (P0 spike, 2026-06-09)

为 [推文订阅功能](../../技术文档/10_推文订阅_开发文档.md) 抓的真实响应, 给解析器开发 / 测试当 fixture。
账号: `@elonmusk` (高频、含视频媒体 + 转推 + 引用, 适合覆盖边界)。**API key 不在这些文件里**。

| 文件 | 端点 | 是否裁剪 | 说明 |
|---|---|---|---|
| `UsernameToUserId.sample.json` | `GET /UsernameToUserId?username=` | 原样 | 直接返 `{id, id_str}`, **无信封** |
| `UserTweets.sample.json` | `GET /UserTweets?user_id=` | **裁剪** | 原始 ≈180KB; 这里只留 3 个 entries (1 视频推 + 1 引用推 + 1 cursor), 结构完整 |
| `Search.sample.json` | `GET /Search?q=from:..&type=Latest` | **裁剪** | `_normalized.tweets` 留 2 条; 原始 `search_timeline` 已省 (解析走 `_normalized`) |
| `TweetDetail.sample.json` | `GET /TweetDetail?tweet_id=` | 原样 | 单条, `data.tweet_result.result` |
| `UserResultByScreenName.sample.json` | `GET /UserResultByScreenName?username=` | 原样 | 账号资料, `data.user_results.result` |

字段映射表 (从这些样本固化) 见开发文档 [§3.3](../../技术文档/10_推文订阅_开发文档.md)。

重抓完整响应:

```bash
curl -s "https://api.twtapi.com/api/v1/twitter/UserTweets?user_id=44196397" \
  -H "X-API-Key: $TWTAPI_API_KEY" | python3 -m json.tool
```
