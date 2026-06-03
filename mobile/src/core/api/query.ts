/**
 * React Query 小工具 —— 把各 feature hooks 里反复出现的"按 id 查单条"样板收口到一处.
 *
 * 约定: useX(id) 里 id 可能还没就绪(路由参数未到 / 上游未返回). 这套写法保证:
 *   - id 缺省 → enabled:false, 不发请求(否则 fetcher(undefined!) 会崩, 是个易漏的坑)
 *   - id 缺省 → queryKey 退化成 [...prefix, "none"] 占位, 避免 undefined 进 key 抖动
 *
 * 额外选项(refetchInterval / staleTime / 自定义 enabled 等)在调用处 spread 覆盖即可:
 *   useQuery(byIdQuery(["commitment"], id, getCommitment))
 *   useQuery({ ...byIdQuery(["research", "session"], sid, listBySession), staleTime: 5_000 })
 */
import type { QueryKey } from "@tanstack/react-query";

export function byIdQuery<T>(
  prefix: QueryKey,
  id: string | undefined,
  fetcher: (id: string) => Promise<T>,
) {
  return {
    queryKey: id ? [...prefix, id] : [...prefix, "none"],
    queryFn: () => fetcher(id!),
    enabled: !!id,
  };
}
