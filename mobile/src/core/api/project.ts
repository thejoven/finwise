/**
 * /v1/projects 客户端封装. 与 server/internal/module/project 对齐.
 *
 * project = 用户自定义的"分类/项目", 比如 "泡泡玛特". 每个 signal capture 时
 * 可绑定一个 project, 统计页按 project_id 过滤数据分析.
 */

import { z } from "zod";
import { api } from "./client";

export const ProjectView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string().nullable().optional(),
  emoji: z.string().nullable().optional(),
  sort_order: z.number().int(),
  guidance: z.string().nullable().optional(), // 分析指引: 喂给该分类下的 LLM
  archived_at: z.string().nullable().optional(),
  created_at: z.string(),
});
export type ProjectView = z.infer<typeof ProjectView>;

const ProjectList = z.object({
  projects: z.array(ProjectView),
});
export type ProjectList = z.infer<typeof ProjectList>;

export interface CreateProjectInput {
  name: string;
  color?: string;
  emoji?: string;
  sort_order?: number;
  guidance?: string;
}

export interface UpdateProjectInput {
  name?: string;
  color?: string;
  emoji?: string;
  sort_order?: number;
  guidance?: string;
}

export async function listProjects(): Promise<ProjectView[]> {
  const json = await api.get("v1/projects").json();
  return ProjectList.parse(json).projects;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectView> {
  const json = await api.post("v1/projects", { json: input }).json();
  return ProjectView.parse(json);
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<ProjectView> {
  const json = await api.patch(`v1/projects/${id}`, { json: input }).json();
  return ProjectView.parse(json);
}

export async function archiveProject(id: string): Promise<void> {
  await api.delete(`v1/projects/${id}`);
}
