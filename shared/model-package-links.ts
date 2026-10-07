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
  authorities: z.record(z.string().min(1), z.string().min(1)),
  links: z.array(ModelPackageLinkSchema),
}).strict();

export type ModelPackageLink = z.infer<typeof ModelPackageLinkSchema>;
export type ModelPackageLinks = z.infer<typeof ModelPackageLinksSchema>;
/** 单条 scope 引用（source + select）：服务端 assertSelector 用它取 selector 类型。 */
export type ModelPackageScopeRef = z.infer<typeof ScopeRefSchema>;
