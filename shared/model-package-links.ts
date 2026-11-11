import { z } from 'zod';

const SelectorSchema = z.object({
  all: z.boolean().optional(),
  kind: z.string().min(1).optional(),
  ids: z.array(z.string().min(1)).optional(),
  room_ids: z.array(z.string().min(1)).optional(),
  collections: z.array(z.string().min(1)).optional(),
  types: z.array(z.string().min(1)).optional(),
  layers: z.array(z.string().min(1)).optional(),
  plan_ids: z.array(z.string().min(1)).optional(),
  trade: z.array(z.string().min(1)).optional(),
}).strict().refine((selector) => Object.keys(selector).length > 0, 'selector must declare at least one field');

const ScopeRefSchema = z.object({
  source: z.string().min(1),
  select: SelectorSchema,
}).strict();

const ModelPackageLinkSchema = z.object({
  id: z.string().min(1),
  phase_id: z.string().min(1),
  budget_ref: z.object({ source: z.string().min(1), id: z.string().min(1) }).strict(),
  mapping_status: z.enum(['mapped', 'partial', 'not_modelled', 'project_scope']),
  scope: z.array(ScopeRefSchema).optional(),
  note: z.string().optional(),
}).strict().superRefine((link, ctx) => {
  if (link.mapping_status === 'not_modelled') {
    if (!link.note?.trim()) ctx.addIssue({ code: 'custom', path: ['note'], message: 'not_modelled links require a note' });
    if (link.scope?.length) ctx.addIssue({ code: 'custom', path: ['scope'], message: 'not_modelled links must not declare invented targets' });
  } else if (!link.scope?.length) {
    ctx.addIssue({ code: 'custom', path: ['scope'], message: 'mapped links require at least one scope reference' });
  }
});

export const ModelPackageLinksSchema = z.object({
  schema: z.literal('project.model-package-links/v1'),
  // issue #98 第三阶段 S1：authority 可指多个文件（overlay 拆为 envelope 三文件后，
  // 指纹与选择器校验都必须覆盖全部成员，漏一个就是新鲜性缺口）。
  authorities: z.record(z.string().min(1), z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])),
  links: z.array(ModelPackageLinkSchema),
}).strict();

/**
 * 登记表文件路径（2026-11-02 自装交互审批第一步从 server/model-package-links.ts
 * 迁到此处）：shared/schedule-state.ts 的指纹计算要用这个常量，而 shared/ 不得
 * 反向依赖 server/。server/model-package-links.ts 转发导出，既有 import 不变。
 */
export const MODEL_PACKAGE_LINKS_PATH = 'config/model-package-links.yaml';

export type ModelPackageLink = z.infer<typeof ModelPackageLinkSchema>;
export type ModelPackageLinks = z.infer<typeof ModelPackageLinksSchema>;
/** 单条 scope 引用（source + select）：服务端 assertSelector 用它取 selector 类型。 */
export type ModelPackageScopeRef = z.infer<typeof ScopeRefSchema>;

/**
 * 装载结果：schema 校验通过的登记表 + 逐链接的对象解析（issue #191）。
 *
 * `objectResolutions` 由 `server/model-package-links.ts` 在**非 enumerable** 属性上挂载，
 * 因此 `/api/model-package-links` 的 JSON 形状与旧版逐字相同（前端不需要这些摘要）；
 * `shared/schedule-state.ts` 与 verify:facts 直接读它建对象粒度指纹与契约数据集。
 */
export type LoadedModelPackageLinks = ModelPackageLinks & {
  readonly objectResolutions?: Readonly<Record<string, import('./package-objects.js').LinkObjectResolution>>;
};

/** authority 值的文件清单：单 key 可指多文件（overlay = envelope 三文件，issue #98 S1）。 */
export function authorityFilePaths(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}
