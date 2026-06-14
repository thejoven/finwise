/**
 * useEnsureCategory — 保证"任何时候都有且仅有一个真实分类被选中".
 *
 * 产品决定 (见 GOAL): 收件箱不再有"全部"视图. 用户必须始终停在某一个分类里, 以保持专注.
 * 为此本 hook 在分类列表就绪后做两件事:
 *
 *   1) 列表为空 (新用户 / 全部被归档) → 自动创建一个默认分类 "我的关注", 并选中它.
 *   2) 列表非空但当前 active 为 null / 指向已归档·已删除的分类 → 自动选中第一个可用分类.
 *
 * 设计要点:
 *   - 默认分类的创建用模块级 promise 兜重入: 即使本 hook 在 inbox / archive 两个
 *     masthead 同时挂载, 也只会发一次 POST (列表回填后条件不再成立, 不会重复建).
 *   - 乐观写入 react-query 缓存, 弱网下也能立刻让 UI 拿到新分类.
 *   - 只读 hydrated 后的 store, 避免启动瞬间把磁盘里存的 active 覆盖掉.
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { createProject, listProjects, type ProjectView } from "@/core/api/project";
import i18n from "@/core/i18n";

import { useActiveProject } from "./store";

// 模块级兜重入: 跨组件实例共享, 保证默认分类只创建一次.
let creatingDefault: Promise<ProjectView> | null = null;

export function useEnsureCategory() {
  const queryClient = useQueryClient();
  const hydrated = useActiveProject((s) => s.hydrated);
  const activeId = useActiveProject((s) => s.activeId);
  const setActive = useActiveProject((s) => s.setActive);

  const { data: projects, isSuccess } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });

  useEffect(() => {
    // 必须等 store 从磁盘恢复完, 否则会把上次记住的 active 误判成"无效"而改掉.
    if (!hydrated || !isSuccess || !projects) return;

    const usable = projects.filter((p) => !p.archived_at);

    // 情况 1: 一个可用分类都没有 → 建默认分类.
    if (usable.length === 0) {
      if (creatingDefault) return;
      // 新用户首次进入时自动建的分类名. 用户可随时改名 / 再建.
      creatingDefault = createProject({ name: i18n.t("project.defaultCategoryName") })
        .then(async (created) => {
          queryClient.setQueryData<ProjectView[]>(["projects"], (old) =>
            old ? [...old, created] : [created],
          );
          await setActive(created.id);
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          return created;
        })
        .finally(() => {
          creatingDefault = null;
        });
      return;
    }

    // 情况 2: active 为空 / 指向已不可用的分类 → 落到第一个可用分类.
    const activeStillValid = activeId != null && usable.some((p) => p.id === activeId);
    if (!activeStillValid) {
      void setActive(usable[0]!.id);
    }
  }, [hydrated, isSuccess, projects, activeId, setActive, queryClient]);
}
