# pro.twitterdata.com 真实响应样本 (2026-06-16)

[推文订阅功能](../../技术文档/10_推文订阅_开发文档.md) 的**第二个 X 数据源** `xsource.Provider` 实现
(`server/internal/infra/twitterdata/`)。账号 `@elonmusk` (restId `44196397`)，与 twtapi 样本同账号便于比对。
**鉴权 token 走 query 参数，不在这些响应里**（token 只出现在请求 URL）。

解析已对齐这些样本并有 fixture 测试 (`twitterdata/parse_test.go`)；**信封与 twtapi 全异**，故各写各的解析。

| 文件 | 端点 | 裁剪 | 信封路径 |
|---|---|---|---|
| `UserByScreenName.sample.json` | `GET /UserByScreenName?screenName=` | 原样 | `data.user.result` (内层 user 与 twtapi 同构) |
| `UserTweets.sample.json` | `GET /UserTweets?restId=` | **裁剪** | `data.user.result.timeline.timeline.instructions[].entries[].content.itemContent.tweet_results.result`；留 1 引用推 + 1 转推 + Top/Bottom cursor |
| `TweetDetail.sample.json` | `GET /TweetDetail?restId=` | **裁剪** | `data.threaded_conversation_with_injections_v2.instructions[]`；留焦点推一条 |
| `tweet_with_video.sample.json` | (search `filter:videos` 抽出的单条 `<TWEET>`) | 单对象 | 测媒体解码：视频选最高码率 mp4 变体 + 封面 |

## 与 twtapi 的关键差异 (固化自样本)

- 信封是 **x.com 原生 camelCase** (`entryId` / `entryType` / `cursorType` / `itemContent`)；twtapi 是被代理改写过的 snake (`user_result_by_rest_id` / `profile_timeline_v2` / `cursor_type`)。
- 单条 `<TWEET>`: 浏览量在 **`views.count`** (twtapi 是 `view_count_info.count`)；引用原推在 **`quoted_status_result`** (twtapi 是 `quoted_tweet_results`)；作者只见 `core.user_results.result`。
- 翻页: bottom cursor 值取 `content.value` (`cursorType=Bottom`)，回传用 **`?cursor=<值>`** (已实测翻到更旧推)。
- 时间线里 `who-to-follow` 是 `TimelineTimelineModule`、墓碑推无 `legacy` —— 均跳过。

## 重抓 / 补样本

```bash
export TWITTERDATA_TOKEN=...   # 不要写进文件

curl -s "https://pro.twitterdata.com/UserByScreenName?screenName=elonmusk&token=$TWITTERDATA_TOKEN" | python3 -m json.tool
curl -s "https://pro.twitterdata.com/UserTweets?restId=44196397&token=$TWITTERDATA_TOKEN" | python3 -m json.tool
curl -s "https://pro.twitterdata.com/TweetDetail?restId=1897289524193214579&token=$TWITTERDATA_TOKEN" | python3 -m json.tool
```

媒体: 视频推已有 fixture (`tweet_with_video.sample.json`, search `filter:videos` 抽的)，覆盖"选最高
码率 mp4 变体 + 封面"路径；photo 是平凡分支 (URL=`media_url_https`)，未单独取样。`tweets.raw_payload` 留底。

## 启用本 provider

服务器 `.env` 设 `X_PROVIDER=twitterdata` + `TWITTERDATA_TOKEN=...`，重启 `alphax-api`。错误码映射
(402/429/404) 暂照搬 twtapi，只见过 200；真遇配额/限流/404 响应后到 `client.go` 的 `get()` 核对。
