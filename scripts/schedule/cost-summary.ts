/**
 * 一期成本总表（硬装，含中央空调）——生成源。
 *
 * 为什么需要这张表：预算有正式总表（phase-1/budget.md + 计算器科目视图），成本没有。
 * 成本数字散在各包 estimated_need_cny、报价卡与计算器快照里，靠人誊抄拼表，已经造成
 * 严重误读（把科目视图的「承诺额」已定价小计当成硬装总价）。本模块把成本行逐行钉死
 * 到唯一权威来源，由 scripts/schedule/control.ts 在 render 时生成 phase-1/cost.md，
 * verify:schedule 用同一条流水线做时效校验（指纹 + 内容全等），禁止手改生成物。
 *
 * 业主口径（2026-10-23 裁定，违背即错）：
 *  1. 只列实际成本：planned_cny / 批准额不得作为任何一行的金额或垫数出现（本模块
 *     在计算上根本不读 planned_cny；测试以篡改 planned 全量不变断言防回归）。
 *  2. 硬装包含中央空调：hvac 池并入本表硬装板块，不拆开单列。
 *  3. 没有真实价格的行只标「未定价」、金额为 null，绝不按 0 计入合计；合计行固定
 *     写作「已知小计（不含未定价）」。
 *  4. 每行标注成色且不得拔高：已签约 / 报价卡实算 / 报价轮实算 / 定标目标 / 参考实付 /
 *     算量费率 / 候选价 / 定额暂估。推导在现有数据里追不到构成时，只许降格成色，
 *     不许编造拆解；构成分解与来源金额对不上时构建直接抛错（fail-closed），逼着先
 *     更新本映射表再出表。
 *  5. 小计必须分层（2026-10-23 评审 P1）：每行登记核实层级（tier）——已核实 =
 *     金额已锁定（签约）或由生效数据源完整实算（生效报价卡全行计价、无待报价行），
 *     且无未决去重/待报价标记；其余未锁价等级（封顶价、预算池、候选价、定标目标、
 *     参考实付、定额暂估，以及带未关闭 dedup 的实算行）一律暂估。汇总分三行呈现：
 *     已核实小计 + 暂估小计 = 已知合计；已知合计不得被表述为已核实成本。
 *     层级不是静态标签（2026-10-23 复核）：tier = verified 的行必须登记
 *     verifiedBasis 并过 assertVerifiedTierBasis 守卫。守卫查的是实际凭据、
 *     不是 control.yaml 的自报字段（2026-10-23 复审续）：合同行除断言
 *     contracted_cny 与轮次 contract_ref/locked 状态齐备外，还按 contract_ref
 *     （DEC id）回 docs/decisions/ 解析该 DEC 章节原文，核对原文载有与合同额
 *     一致的成交金额与成交/签约/合同语义，解析不到或金额对不上即抛错；
 *     报价卡行除断言生效卡 status ∈ 锁定类（contracted/locked；baseline/
 *     candidate/quoted 不许）外，还按卡 id 回 config/mep-quotes.yaml 原卡
 *     核对 status 与登记一致、承包商名与 quoted_at 非空。来源状态变未决即
 *     生成抛错。水电行即因此降层：生效卡 owner_baseline_40 是业主口径基线
 *     （status: baseline、费率多为 public_reference），且 COST-040-15 的
 *     interface_pending 未关闭，两点都写在该行 tierReason 里。
 *
 * ── 数据源映射裁定（每行唯一来源 + 防双算理由）────────────────────────────
 *  中央空调 36,000 ← control.yaml PKG-030 budget.contracted_cny（已转合同，
 *    QR-2026-10-03-24 locked_cny 同值、contract_ref DEC-2026-10-04-R1）。
 *    计算器 hvac 科目的 36,000 是同一笔钱的镜像，不另计。
 *  拆改 7,059 ← PKG-020 description 的同户型半包实付锚（拆砌人工 6,000 + 物业垃圾
 *    清运 1,059，程序从原文解析、解析不到即抛错）。科目 demolition 无计价行；
 *    QR-2026-10-03-01 的 3,000 是候选目标，不是价格，不采用。
 *  水电 ← compareMepQuotes 生效卡总额（shared/mep-takeoff.ts 算量 ×
 *    config/mep-quotes.yaml 生效卡单价，与 scripts/project/mep-takeoff.ts 同一条路）。
 *    科目 water_electric 的 6,218（人工一口价 5,000 + 候选 1,218）是同范围的旧科目
 *    口径，且其候选里混着热水器（属家电包）与开关插座占位价，不采用。
 *    层级只入暂估：生效卡是业主基线（baseline）而非锁价，且 COST-040-15 的
 *    施工界面未书面划清（interface_pending）——见该行 tierReason 与层级守卫。
 *  防水人工 366 ← 计算器科目 waterproof 的 actual。经核：该科目 verified/candidate/
 *    manual/auto 全为 0，366 纯粹是 computeLabor 的防水人工——base.json 费率 20 元/㎡ ×
 *    needs_waterproof 房间面积 18.286 ㎡。（曾被误读为「材料候选价」，以数据为准纠正：
 *    未定价的是防水**材料**，不是人工。）金额虽为费率实算，但 QR-2026-10-03-03 的
 *    dedup_rule 明文「若瓦工 18,500 元预算池已含防水人工，最终报价必须去重」且未关闭，
 *    本行可能已含于泥瓦行内——去重关闭前只入暂估层（评审 P1）。
 *  泥瓦 45,091 ← PKG-060 estimated_need_cny（构成：QR-2026-10-03-04/05/06 的
 *    20,000 + 18,500 + 4,000 = 42,500，加 DEC-2026-10-16-TILE-01 终核的墙砖主材
 *    × 70 元/㎡；墙砖量 2026-10-23 DEC-2026-10-23-R04 后 37.0186 ㎡ ≈ 2,591（原 36.7236 ㎡ ≈ 2,571）；
 *    代码断言构成和 == need）。
 *    科目 masonry 的人工 + 地砖候选与本行同范围，不另计。
 *  美缝 4,500 ← hard_finish_quote_rounds 的 QR-2026-10-03-07 登记定额
 *    （DEC-2026-08-22 暂估入账、price_type candidate、文件自述「暂估非算量」），
 *    成色只能给「定额暂估」。金额**不**取 PKG-065/130 的 planned_cny（500 + 4,000
 *    是这笔定额按 DEC-2026-10-22-R03 拆进预算的镜像，读它即违反口径 1）；
 *    config/tile-comparison.yaml grout_model 的干区实算 2,308 只作交叉核对（R04 后干区 115.404 ㎡）
 *    （仅干区：湿区约 56 m 按米成本无估值，该核对不构成全屋 ≤ 定额的证明，
 *    推导文本已按此限定，防读者误读为全屋定额已被验证）。
 *  吊顶 18,000 ← PKG-070 estimated_need_cny（DEC-2026-10-05-R3 定标目标
 *    13,500 + 4,500，断言构成和）。科目 carpentry 的 1,714 是吊顶板面人工
 *    （40 元/㎡ × ceiling_zones），与本行同范围，不另计；窗帘盒人工在科目侧
 *    待报价显形，已含在定标目标口径内。
 *  涂装 9,357 ← 计算器科目 painting：actual（人工，paint-scope 实算面积 × base.json
 *    费率 25 元/㎡）+ candidateActual（latex_paint_01 候选材料）。PKG-080 无
 *    estimated_need，包侧没有第二个数，不构成双算。
 *  洁具 14,798 ← PKG-100 estimated_need_cny（构成 5,598 + 3,500 + 1,300 + 1,100 +
 *    1,800 + 1,500，断言构成和；不含浴霸，见 need 注解）。科目 sanitary 的 1,600
 *    只是安装人工（200 元/件 × fixture_count），与本行同范围，不另计。
 *  橱柜 13,500 ← PKG-110 estimated_need_cny（构成 12,000 + 1,500，断言构成和）。
 *    科目 kitchen_cabinet 候选（cabinet + countertop 两 topic）与本行同范围，不另计。
 *  灯具 2,500 ← 计算器科目 lighting 的 candidateActual（lighting_01 选品候选价）。
 *    QR-2026-10-03-23 的 3,000 是询价目标、非价格，不采用。
 *  烟灶（油烟机）不设行（2026-10-23 复核 P2）：科目 range_hood 的候选价 1,200
 *    曾设为定价行，与本表范围自相矛盾——控制源将油烟机归家电包（PKG-160），
 *    本表口径明确排除家电。现只登记在文末防双算/范围外登记，不计入合计；
 *    其候选价在家电口径另行处理。
 *  未定价五项 ← 包侧 components 全部 planned_cny == null 的显形登记（PKG-005 物业
 *    手续 / PKG-050 防水材料 / PKG-090 室内门 / PKG-125 开关面板 / PKG-135 踢脚线
 *    收边保洁）。科目 smart_home 的 2,000 是一口价占位选品、无逐项构成，
 *    不足以给 PKG-125 定价；switch_socket 候选 ¥18 同为占位价，均不采用。
 *
 * ── 覆盖检查（2026-10-23 评审 P2）：清单不许手写，漏项必须出不了表 ──────────
 *  生成时全量扫描 control.yaml 全部工作包的 budget.components 与
 *  hard_finish_quote_rounds 全部记录。凡「未决」条目，必须在本模块的覆盖登记里
 *  有且至少一处归属：(a) 某定价行的 coversItems（计入该行）；(b) 未定价/待核
 *  条目的 coversItems；(c) 不计价登记 excludedItems（带理由）。无归属或登记指向
 *  不存在的条目 → 构建抛错、verify 失败。归属是集合语义：同一条目可以同时属
 *  两个分类，但多重归属必须在 DUAL_ATTRIBUTIONS 显式声明并附理由（现声明
 *  COST-030-02、COST-030-07、COST-040-15），未声明的多重归属或已腐烂的声明
 *  同样抛错；双归属上限为恰两个分类——同一条目出现在三个及以上分类必有
 *  重复计价或处置冲突，抛错。另有一道防重复计价：同一条目被两条不同定价行
 *  同时计入（同属 counted 分类、集合语义下看不见）必须抛错并点名两条行。
 *  覆盖计数按分类如实呈现、三类之和 = 未决总数 + 双归属数。本表范围外包
 *  （design_preparation / curtains / furniture / appliances 池）的组件按包登记
 *  排除理由，不逐项进本表。
 *  未决分类（按 control.yaml 实际数据摸全，代码内 assertCoverage 注释同步）：
 *  组件 status 除已决白名单 {ownership_resolved, deferred_to_phase_2,
 *  excluded_to_phase_2} 外全部按未决处理——含 *_pending / pending_* /
 *  duplication_check_required / alignment_required / candidate 等，未知新 status
 *  默认未决（fail-closed）；询价轮次 status ≠ locked 即未决（每条记录都带
 *  dedup_rule，记录未 locked 视为去重未关闭）。appliance_quote_register 属家电
 *  池、budget_reconciliation 无条目级状态，两者不在本表扫描内。
 *  miscellaneous 科目的 1,800（hardware_01 通用五金候选）与洁具行构成里的通用
 *    五金 1,500 同范围，不另计（防双算登记里显形）。
 * ────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { RuleEngine } from '../../server/rule-engine.js';
import {
  BudgetCalculator,
  loadMasonryTakeoff,
  loadPaintScopeAreaByRoom,
} from '../../server/budget-calculator.js';
import { loadPaintScopeInputs } from '../../server/paint-cost-comparison.js';
import {
  compareMepQuotes,
  loadMepQuotes,
  mepQuoteFallback,
  type MepQuoteComparison,
  type MepQuoteFallback,
} from '../../server/mep-quotes.js';
import {
  computeMepTakeoff,
  type MepTakeoff,
  type MepTakeoffRules,
} from '../../shared/mep-takeoff.js';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
} from '../../shared/mep-hvac-coordination-schema.js';
import type { BudgetCategory, CurrentScheme } from '../../shared/types.js';

type AnyRecord = Record<string, any>;

export const COST_SUMMARY_PATH = 'schedule/phase-1/cost.md';

/** 本表全部数据输入（指纹用；时效判定以 verify 时重算内容全等为准，此表决定报错时列哪些变更文件）。 */
export const COST_INPUT_PATHS: string[] = [
  'config/budget/base.json',
  'config/ceiling-quotes.yaml',
  'config/ceiling.yaml',
  'config/design-rules.yaml',
  'config/electrical-topology.yaml',
  'config/electrical.yaml',
  'config/house.yaml',
  'config/hvac.yaml',
  'config/layout/model-geometry.yaml',
  'config/layout/overlay.yaml',
  'config/masonry-labor.yaml',
  'config/materials.yaml',
  'config/mep-hvac-coordination.yaml',
  'config/mep-labor.yaml',
  'config/mep-quotes.yaml',
  'config/mep-takeoff.yaml',
  'config/plumbing.yaml',
  'config/tile-comparison.yaml',
  'data/current-scheme.json',
  'schedule/phase-1/control.yaml',
].sort();

/** 核实层级：verified = 已锁定或完整实算且无未决去重/待报价；provisional = 暂估（未锁价等级）。 */
export type CostTier = 'verified' | 'provisional';

/**
 * 已核实层的来源凭据（层级守卫的断言对象，见 assertVerifiedTierBasis）：
 *  - contract：合同行——control.yaml 里该包 contracted_cny 存在，且对应询价轮次
 *    status = locked、locked_cny 与合同额一致、contract_ref 非空；再按
 *    contract_ref 回仓库凭据原文核验（见 assertContractCredential）。
 *  - quote-card：报价卡行——生效卡 status 必须是锁定类（见
 *    LOCKED_QUOTE_CARD_STATUSES）；cardStatus 在构建时从比较结果原样捕获，
 *    不是登记处自填的字符串，且守卫会回原卡文件核对（见
 *    assertQuoteCardCredential）。
 */
export type VerifiedBasis =
  | { type: 'contract'; packageId: string; quoteRoundId: string }
  | { type: 'quote-card'; cardId: string; cardStatus: string };

/** 报价卡 status 的锁定类白名单（QuoteCardStatus 枚举）：contracted 才算锁定；baseline / candidate / quoted / rejected 一律不许支撑已核实层。另接受 locked（询价轮次口径）以防枚举扩展。 */
export const LOCKED_QUOTE_CARD_STATUSES: ReadonlySet<string> = new Set(['contracted', 'locked']);

/** DEC id 严格格式（AGENTS.md 口径）：DEC-YYYY-MM-DD-(三位序号 | R 序号）。 */
const DEC_ID_PATTERN = /^DEC-\d{4}-\d{2}-\d{2}-(?:\d{3}|R\d{1,3})$/;

/**
 * 按 DEC id 在 docs/decisions/*.md 中定位该决策的章节原文（从 `### <DEC id> …`
 * 标题行到下一个同级或更高级标题之前）。找不到返回 null。仓库现行 DEC 章节
 * 均为 ### 级标题；这里接受 ##–#### 级以防分卷调整。
 * 两道 fail-closed（自主扫描 G5/G6）：
 *  - decId 先按严格格式校验、再转义后拼进 RegExp——未校验未转义的原始拼
 *    接下，「R8|R7」式交替可劫持到别的章节、含括号的值会让 RegExp 构造抛
 *    裸 SyntaxError；非法 id 一律守卫式抛错点名，不进检索。
 *  - 全部匹配章节都收集：同 id 出现在 >1 处（跨文件或同文件两章）即章
 *    节歧义抛错并点名全部文件——旧实现首命中即返回，分卷重复时静默读
 *    错卷、用错凭据原文。
 * dir 参数仅供测试注入临时目录，生产路径不传、走 docs/decisions。
 */
export function findDecisionSection(decId: string, dir: string = 'docs/decisions'): { file: string; text: string } | null {
  if (!DEC_ID_PATTERN.test(decId)) {
    throw new Error(`cost summary: DEC id「${decId}」不符合严格格式 DEC-YYYY-MM-DD-(三位序号|R 序号）——contract_ref 只能是合法 DEC id，非法值不得拼进章节检索`);
  }
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  } catch {
    return null;
  }
  const escapedId = decId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingPattern = new RegExp(`^#{2,4}\\s+${escapedId}(\\s|$)`);
  const matches: Array<{ file: string; text: string }> = [];
  for (const name of names) {
    const lines = readFileSync(`${dir}/${name}`, 'utf8').split('\n');
    for (let start = 0; start < lines.length; start += 1) {
      if (!headingPattern.test(lines[start])) continue;
      const level = (lines[start].match(/^#+/) as RegExpMatchArray)[0].length;
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i += 1) {
        const heading = lines[i].match(/^(#{1,6})\s/);
        if (heading && heading[1].length <= level) {
          end = i;
          break;
        }
      }
      matches.push({ file: `${dir}/${name}`, text: lines.slice(start, end).join('\n') });
    }
  }
  if (matches.length > 1) {
    throw new Error(`cost summary: DEC ${decId} 有 ${matches.length} 个同名章节（${matches.map((match) => match.file).join('、')}）——章节歧义，无法判定哪一卷是凭据原文，须先消歧（合并或改名）再生成`);
  }
  return matches[0] ?? null;
}

/**
 * 合同凭据核验（2026-10-23 复审续）：contract_ref 在 control.yaml 里只是一个
 * 自报字符串，光「字段在位」不算凭据。本核验按 contract_ref（现行数据只支持
 * DEC id 形式）回 docs/decisions/ 解析对应 DEC 章节原文，断言：① 章节存在；
 * ② 章节原文载有与 contracted_cny 一致的金额（千分位格式，如 36,000），且
 * 辖域候选唯一（并存两价即歧义抛错，见 assertGovernedAmountsUnambiguous）；
 * ③ 章节原文带**正向**成交表述（定标成交 / 成交事实 / 已签约 / 签订 / 签
 * 约方 / 已成交；只有「合同/签约」字样、含否定式提及的不算，见
 * hasAffirmativeDealSemantics）。三者缺一即抛错。
 * ② 的命中口径是**全词精确命中 + 总价关键词辖域**（复审三轮收紧）：
 * includes() 子串查法会把「6,000」误认成「36,000」的子串（第一轮堵）；
 * 全词精确命中仍不够——DEC 章节正文同时载有**分项金额**（如 DEC-2026-10-04-R1
 * 章节内的外机 14,124 元、安装 8,400 元），同步误改成分项数照样通过（第二
 * 轮堵）；按「总价语境行」整行提取仍不够——标题行除 36,000 外还捎着 DEC
 * 编号与型号数字（2026、10、200 主机、6 台、R1 的 1），正文的总价论述行还
 * 捎着设备价（2,131 / 2,050 / 2,493）与百分比（35）等数字，整行提取会把
 * 它们全放进候选集，同步误改成 6 / 10 / 200 / 2,131 同样放行（第三轮堵）。
 * 故候选金额只从被总价关键词**直接辖制**的位置提取，两种形态：
 * (a) 关键词在前——（定标成交 / 合同总价 / 总金额 / 总价 / 合同额 / 成交价）
 * 之后只隔标点/空白即接金额，如标题「定标成交：36,000 元」；
 * (b) 金额在前——金额之后同小句近邻（间隔不含其他数字、不跨句号/分号、
 * 24 字内）出现总价词，如正文「36,000 为整包含价，换内机不改变总价」。
 * 形态 (b) 还须过**否定屏蔽**（第四轮堵）：「14,124 元不是总价；总价待定」
 * 里金额与「总价」之间只隔一个「不是」，无屏蔽时会把分项金额误认成被总
 * 价辖制。故 (b) 的每个关键词出现位置，若否定词（不是 / 并非 / 不属于）
 * 紧贴关键词构成**身份否定**，该出现作废。判定只认「否定词紧贴关键词」
 * 这一种形态，不按「句中出现不字」一刀切——「36,000 为整包含价，换内机
 * 不改变总价」中「不改变总价」的否定作用于动词「改变」而非总价身份，该
 * 句的真命中靠先行出现的「整包含价」成立，屏蔽不误伤（提取函数注释与测
 * 试均有逐字对照）。
 * 形态 (a) 同样要过否定屏蔽（第九轮堵）：「本项目非总价：14,124 元」里
 * 关键词「总价」紧邻前文是「非」，陈述的恰是「这不是总价」——(a) 的每个
 * 命中须查关键词紧邻前文是否以身份否定词（不是 / 并非 / 不属于 / 不属 /
 * 非）结尾，是则本次出现作废，与 (b) 同口径。
 * 实测现行 DEC-2026-10-04-R1：整行口径的候选集有 16 个 token，辖域口径下
 * 恰为 {36,000}（(a) 标题行、(b) 整包含价行各命中一次）。章节内无任何辖域
 * 位置载有该金额即抛错。「合计」刻意不入关键词集：合计行可能只是分项小
 * 计，宁可 fail-closed 误拦、不可误放；现行 36,000 不依赖合计行命中。
 * 强度边界（如实）：这是对仓库内决策原文的文本核验——能拦「引用不存在、
 * 金额被改、引用挂错决策」，拦不住「DEC 原文与纸质合同本身不符」（纸质合同
 * 不在仓库内，无从机读；DEC 是仓库内最接近合同的权威凭据）。
 */
/**
 * 总价关键词辖域提取（纯函数，与 assertContractCredential 共用、供测试直
 * 接喂合成章节）：从 DEC 章节原文提取被总价关键词直接辖制的金额 token
 * 集合（千分位格式字符串）。两种形态与否定屏蔽的依据见
 * assertContractCredential 头注；整行提取会把标题里的编号/型号/台数、正
 * 文论述行里的设备价等杂数字一并放行，故废止、只认辖域位置。
 */
export function extractGovernedTotalAmounts(sectionText: string): Set<string> {
  // 金额格式口径：token 须以千分位书写（成员比对的对象是
  // contracted.toLocaleString('en-US') 的千分位形式——无千分位书写如
  // 「36000」即使被提取也不会与之全等命中）；小数金额不命中（尾界排除
  // '.'，防「36,000.5」被截成「36,000」）。
  const amountPattern = String.raw`(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)(?![\d,.])`;
  const governed = new Set<string>();
  // (a) 关键词在前：关键词后只隔标点/空白、至多一个系词（为 / 是）即接金
  // 额（定标成交：36,000 元 / 合同总价为 36,000 元）。两层前文屏蔽：
  //  - 否定屏蔽（复审第九轮，与 (b) 对称）：关键词紧邻前文以身份否定词结
  //    尾（「本项目非总价：14,124 元」「并非定标成交：36,000 元」）时，该
  //    出现陈述的恰是「这不是总价/未成交」，其后金额不得认作总价候选；
  //  - 子类屏蔽（自主扫描 G1）：关键词「总价 / 总金额」无左界，「分项总
  //    价：14,124」会直接命中——紧邻前文为子类前缀（分项 / 安装 / 设备 /
  //    材料 / 单项 / 子项 / 预估 / 估算 / 预算）时该出现是分项小计、作废。
  //    正当总价短语不受影响：「合同总价」是独立关键词、「项目总价 / 工
  //    程总价」的前缀不在子类集内。
  const keywordFirst = new RegExp(`(定标成交|合同总价|总金额|总价|合同额|成交价)\\s*[:：]?\\s*(?:为|是)?\\s*${amountPattern}`, 'g');
  for (const match of sectionText.matchAll(keywordFirst)) {
    const before = sectionText.slice(0, match.index);
    if (/(?:不是|并非|不属于|不属|非)$/.test(before)) continue;
    if (
      (match[1] === '总价' || match[1] === '总金额')
      && /(?:分项|安装|设备|材料|单项|子项|预估|估算|预算)$/.test(before)
    ) continue;
    governed.add(match[2]);
  }
  // (b) 金额在前：同小句近邻出现总价词（36,000 为整包含价，…不改变总价），
  // 间隔不含其他数字、不跨句号/分号/逗号/顿号/换行（自主扫描 G2：窗口原
  // 可跨「，」与换行，隔着分句标点的金额也会被误认；真实命中「36,000 为
  // 整包含价」的关键词在首个逗号之前，收紧不误伤）
  const amountFirst = new RegExp(`${amountPattern}[^\\d。；\\n、，]{0,24}?(?:总价|整包含价)`, 'g');
  for (const match of sectionText.matchAll(amountFirst)) {
    // match[0] 以金额开头（amountPattern 的前后顾均为零宽断言）；金额之后
    // 的部分是间隔 + 关键词。否定屏蔽：否定词紧贴关键词（「不是总价」式
    // 身份否定）时本次出现作废；否定作用于动词的（「不改变总价」）不
    // 紧贴关键词、不作废。
    const tail = match[0].slice(match[1].length);
    if (/(?:不是|并非|不属于|不属)(?:总价|整包含价)/.test(tail)) continue;
    governed.add(match[1]);
  }
  return governed;
}

/**
 * 辖域候选唯一性（自主扫描 G3）：章节若并存两个被总价关键词辖制的金额
 * （如原文写 36,000、补充协议又写 35,500），成员判断会把**两个**都放行
 * ——同步误改成旧价照样过。故候选集含 >1 个不同金额即视为章节总价歧义、
 * 抛错并列出全部金额，须人工消歧，不得用任一旧价放行。现行真实 DEC 候
 * 选集恰为 {36,000}，本断言零影响。
 */
export function assertGovernedAmountsUnambiguous(governedAmounts: ReadonlySet<string>, contractRef: string): void {
  if (governedAmounts.size > 1) {
    throw new Error(`cost summary: ${contractRef} 章节的总价关键词辖域内出现 ${governedAmounts.size} 个不同金额（${[...governedAmounts].join('、')}）——章节总价歧义（新旧两价并存时无法判定哪个是现行合同额），须先人工消歧（删去失效的总价陈述或改走新的 contract_ref）再生成`);
  }
}

/**
 * 正向成交语义（自主扫描 G4）：旧检查 /(成交|签约|合同)/ 任中其一即过，
 * 「尚未签约…未成合同」的纯询价章节也能全过——否定式提及不算成交事实。
 * 改为正向成交表述集合：定标成交 / 成交事实 / 已签约 / 签订 / 签约方 /
 * 已成交，任一命中才算。实测覆盖（2026-10-23，docs/decisions 全部 271
 * 个 DEC 章节）：17 个章节命中旧正则但不命中本集合，逐一核对均为询价记
 * 录 / 合同外事项 / 否定式提及，无一是成交章节；现行唯一生产合同章节
 * DEC-2026-10-04-R1 同时命中定标成交、成交事实、签约方三项，通过有余量。
 */
const AFFIRMATIVE_DEAL_PATTERN = /(?:定标成交|成交事实|已签约|签订|签约方|已成交)/;

export function hasAffirmativeDealSemantics(sectionText: string): boolean {
  return AFFIRMATIVE_DEAL_PATTERN.test(sectionText);
}

function assertContractCredential(rowId: string, contractRef: string, contracted: number, packageId: string): void {
  const section = findDecisionSection(contractRef);
  if (!section) {
    throw new Error(`cost summary: 定价行 ${rowId} 的合同凭据无从核验：contract_ref ${contractRef} 在 docs/decisions/ 中解析不到对应的 DEC 章节——引用不存在，已核实层不成立`);
  }
  const amountText = contracted.toLocaleString('en-US');
  const governedAmounts = extractGovernedTotalAmounts(section.text);
  assertGovernedAmountsUnambiguous(governedAmounts, contractRef);
  if (!governedAmounts.has(amountText)) {
    throw new Error(`cost summary: 定价行 ${rowId} 的合同凭据金额对不上：${contractRef} 章节原文（${section.file}）的总价关键词辖域内（「定标成交：<金额>」式关键词直接辖制、或金额后同小句近邻总价词的形态）未载明金额 ${amountText}（须全词精确命中且被总价关键词直接辖制；子串、分项金额、标题内编号/型号/台数等杂数字、以及被身份否定（「…不是总价」式）的金额均不算），与 ${packageId} contracted_cny=${contracted} 不符。（措辞提示：DEC 原文的合同总价须以千分位书写、由总价关键词直接辖制，如「定标成交：36,000 元」「合同总价为 36,000 元」；无千分位、小数、带子类前缀（「分项总价」等）或被身份否定的金额均不命中。）`);
  }
  if (!hasAffirmativeDealSemantics(section.text)) {
    throw new Error(`cost summary: 定价行 ${rowId} 的合同凭据语义对不上：${contractRef} 章节原文（${section.file}）未见正向成交表述（定标成交 / 成交事实 / 已签约 / 签订 / 签约方 / 已成交）——只有「合同 / 签约」字样（含「尚未签约」「未成合同」式否定提及）不算成交凭据，该决策不是成交凭据`);
  }
}

/**
 * 报价卡凭据核验（2026-10-23 复审续）：在 status 锁定类断言之外，按卡 id 回
 * config/mep-quotes.yaml 原卡（经 loadMepQuotes 的规范解析路径）核对：
 * ① 原卡存在；② 原卡 status 与登记处捕获的 cardStatus 一致（口径如实：
 * 生产路径上捕获值与原卡同出一文件、同一 parser，本检查实际防的是「捕
 * 获 / 注入两份数据的口径不一致」——捕获链将来若改走独立来源，该漂移
 * 检查自动生效；在那之前不得把它称作防生产漂移）；③ 承包商名
 *（contractor）非空；④ 报价日期（quoted_at）非空；
 * ⑤ 证据等级必须为 written_quote（正向强制，见下）；⑥ 费率来源不得为公开
 * 参考价（第二层，见下）；⑦ 被引用卡必须为文件的 active 卡（生效绑定，
 * 自主扫描 D4）；⑧ evidence.currency 若声明必须为 CNY（自主扫描 D5）。
 * ⑤ 的来由（复审再续·凭据边界收紧）：早先版本只**拒**公开参考价来源——缺
 * 证据、或只有照片 / 业主转述的卡仍能过关，与证据分级口径不一致。
 * shared/quote-cards.ts 的 QuoteCardEvidenceKind 三级（photo /
 * owner_reported / written_quote）中，只有 written_quote（施工方/商家的书面
 * 报价单，可签字、可追溯）是一级证据、能放心比价，该系统自身的 comparable
 * 门禁同样以 `evidence.kind !== 'written_quote'` 判不可比。故本守卫正向强
 * 制：卡必须带结构化 evidence 且 kind === 'written_quote'，缺失或为 photo /
 * owner_reported 一律抛错点名。
 * ⑥ 费率来源：status=contracted 只证明登记状态，不证明费率是施工方真实报
 * 价——一张费率取自公开参考价的卡若被标成 contracted，公开参考价照样进已
 * 核实层。故逐行核验该卡 rates 的来源：任一行 scope_note 含
 * `public_reference` 标记、或行级 evidence.kind 为 public_reference 类，即
 * 视为公开参考价来源，抛错并点名行键（evidence.kind === 'written_quote' 的
 * 卡也过不了这一层）。两条如实边界（自主扫描 G7/G9）：(i) scope_note 的
 * public_reference 标记是卡作者的**自愿声明**——本检查只能拦已声明者，
 * 未声明的公开来源是数据纪律问题，不在守卫可核范围（与「纸质合同不在仓
 * 内」同级边界）；行级 evidence.kind 分支 2026-10-23 前因上游 parseRate
 * 静默丢弃行级 evidence 而在生产路径永假，现 parser 已同口径保留，且
 * kind='public_reference' 不在三级枚举内、会在解析期即被拒并点名行键，
 * 守卫侧判断保留为注入路径的第二道。(ii) evidence 的 status / source /
 * observed_at / quote_status 由 parser 透传、本守卫**不解读**（与上游
 * comparable 门禁同口径）——它们不构成凭据强度的一部分。
 * 作用域边界（如实）：本函数只在某行**声称已核实**（tier=verified 且凭据为
 * 报价卡）时被调用。现行 5 张 MEP 卡均无结构化 evidence 字段——按 ⑤，此后
 * 任何 MEP 卡在补登书面证据前**不得**支撑已核实层，这是刻意的 fail-closed；
 * 现行已核实行（签约空调）走合同凭据、不经本核验，不受影响；水电行在暂估
 * 层，生效卡 owner_baseline_40 不经本核验、其 public_reference 费率行不因
 * 此报错。强度边界：本守卫拦的是「凭据指向空卡/无名卡/状态漂移/证据等级
 * 不足/公开参考价冒充」，不证明报价的商业真实性本身。
 * 另一条边界（自主扫描 D4）：被引用卡「全行计价、无待报价行」的性质**不**
 * 在本守卫的断言范围——它由金额计算路径（computeActiveMepQuote 对生效卡
 * 的 total / pendingRows / 完整性断言）在出金额时保证；本守卫只核凭据本
 * 身（卡存在 / 状态 / 身份字段 / 生效绑定 / 证据等级 / 币种 / 费率来源）。
 * quotesFile 参数仅供测试注入合成卡文件；生产路径不传、走真实文件。
 */
function assertQuoteCardCredential(rowId: string, basis: { cardId: string; cardStatus: string }, quotesFile?: AnyRecord): void {
  const file = quotesFile ?? (loadMepQuotes() as unknown as AnyRecord);
  const card = ((file.quotes ?? []) as AnyRecord[]).find((quote) => quote.id === basis.cardId);
  if (card && card.status !== basis.cardStatus) {
    throw new Error(`cost summary: 定价行 ${rowId} 的报价卡凭据漂移：登记捕获的 ${basis.cardId} status=${basis.cardStatus}，与 config/mep-quotes.yaml 原卡 status=${card.status} 不一致——请重新生成捕获`);
  }
  if (!LOCKED_QUOTE_CARD_STATUSES.has(basis.cardStatus)) {
    throw new Error(`cost summary: 定价行 ${rowId} 声称已核实，但其依据的报价卡 ${basis.cardId} 的 status=${basis.cardStatus} 不是锁定类状态（仅 contracted/locked 可支撑已核实层；baseline/candidate/quoted/rejected 一律不许）——请把该行降为暂估层，或更换为锁定类生效卡`);
  }
  if (!card) {
    throw new Error(`cost summary: 定价行 ${rowId} 的报价卡凭据无从核验：config/mep-quotes.yaml 中找不到卡 ${basis.cardId}——凭据指向不存在的卡，已核实层不成立`);
  }
  if (typeof card.contractor !== 'string' || card.contractor.trim().length === 0) {
    throw new Error(`cost summary: 定价行 ${rowId} 的报价卡凭据不全：卡 ${basis.cardId} 在 config/mep-quotes.yaml 中缺承包商名（contractor）——无名报价不算凭据`);
  }
  if (typeof card.quoted_at !== 'string' || card.quoted_at.trim().length === 0) {
    throw new Error(`cost summary: 定价行 ${rowId} 的报价卡凭据不全：卡 ${basis.cardId} 在 config/mep-quotes.yaml 中缺报价日期（quoted_at）——无日期报价不算凭据`);
  }
  // ⑦ 生效卡绑定（自主扫描 D4）：被引用卡必须是文件里 active 的那张——引
  // 用一张非生效的 contracted 卡过守卫，等于让一张没在用的卡给已核实层
  // 背书。解析层（parseQuoteCards）保证 active 必在 quotes 内且恒有值；
  // 注入对象缺 active 视为未绑定，同样抛错。
  const activeCardId = (file as AnyRecord).active;
  if (activeCardId !== basis.cardId) {
    throw new Error(`cost summary: 定价行 ${rowId} 的报价卡凭据未绑定生效卡：引用的是 ${basis.cardId}，但报价文件当前 active 是 ${typeof activeCardId === 'string' ? activeCardId : '缺失'}——已核实层只能由生效卡支撑，请改引生效卡或先切换 active`);
  }
  // ⑤ 证据等级正向强制：已核实层只认一级证据 written_quote（书面报价单）；
  // 缺 evidence、或 kind 为 photo / owner_reported（照片判读 / 业主转述）一律
  // 不许——与 shared/quote-cards.ts 的证据分级及 comparable 门禁同口径。
  const cardEvidenceKind = (card.evidence as AnyRecord | undefined)?.kind;
  if (cardEvidenceKind !== 'written_quote') {
    throw new Error(`cost summary: 定价行 ${rowId} 的报价卡凭据证据不合格：卡 ${basis.cardId} 的 evidence.kind=${typeof cardEvidenceKind === 'string' ? cardEvidenceKind : '缺失'}，不是 written_quote（书面报价单）——照片判读（photo）/ 业主转述（owner_reported）/ 无证据的卡不得支撑已核实层，请补登书面证据或降为暂估层`);
  }
  // ⑧ 币种（自主扫描 D5）：evidence.currency 若声明必须为 CNY——本表金额
  // 一律按人民币入表，一张 USD 计价的 written_quote 卡不得静默按 ¥ 汇总。
  // 现行卡均无 evidence（已在 ⑤ 被拦下），本检查只在 evidence 存在且过
  // ⑤ 后生效。
  const cardCurrency = (card.evidence as AnyRecord | undefined)?.currency;
  if (cardCurrency !== undefined && cardCurrency !== 'CNY') {
    throw new Error(`cost summary: 定价行 ${rowId} 的报价卡凭据币种不合格：卡 ${basis.cardId} 的 evidence.currency=${cardCurrency}，不是 CNY——外币报价不得静默按人民币入表，请换算登记或降为暂估层`);
  }
  // ⑥ 费率来源核验（第二层）：公开参考价（public_reference）不是施工方报价，
  // 哪怕卡被标成 contracted、且 evidence 为 written_quote 也不许据此声称已核
  // 实。逐行查 rates 的 scope_note 标记与行级 evidence.kind，命中即点名行键。
  for (const [rateKey, rate] of Object.entries((card.rates ?? {}) as Record<string, AnyRecord>)) {
    const scopeNote = typeof rate?.scope_note === 'string' ? rate.scope_note : '';
    const rateEvidenceKind = (rate?.evidence as AnyRecord | undefined)?.kind;
    if (scopeNote.includes('public_reference') || rateEvidenceKind === 'public_reference') {
      throw new Error(`cost summary: 定价行 ${rowId} 的报价卡凭据来源不合格：卡 ${basis.cardId} 的费率行 ${rateKey} 来源为公开参考价（public_reference）——公开参考价不是施工方报价，不得支撑已核实层，请把该行降为暂估层或更换为施工方报价卡`);
    }
  }
}

/**
 * 层级守卫（2026-10-23 复核总评：层级不能是静态标记）：tier = verified 的行必须
 * 凭 verifiedBasis 过本断言——来源状态一旦变未决（生效卡被换成 baseline、
 * 合同额或 contract_ref 被删），生成直接抛错，而不是让旧层级静默通过。
 * 断言分两层：先对 control.yaml 内的字段一致性（合同额/轮次锁定/引用在位、
 * 卡状态锁定类），再回仓库凭据原文核验（合同 → DEC 章节；报价卡 → 原卡
 * 字段），字段自报对不上原文同样抛错。quotesFile 仅供测试注入。
 */
export function assertVerifiedTierBasis(rowId: string, basis: VerifiedBasis | undefined, control: AnyRecord, quotesFile?: AnyRecord): void {
  if (!basis) {
    throw new Error(`cost summary: 定价行 ${rowId} 声称已核实（tier=verified）但未登记来源凭据（verifiedBasis）——已核实层必须有可断言的锁定来源，请先在登记处补凭据或降为暂估层`);
  }
  if (basis.type === 'quote-card') {
    assertQuoteCardCredential(rowId, basis, quotesFile);
    return;
  }
  const pkg = pkgOf(control, basis.packageId);
  const contracted = pkg.budget?.contracted_cny;
  if (typeof contracted !== 'number' || contracted <= 0) {
    throw new Error(`cost summary: 定价行 ${rowId} 声称已核实（合同凭据），但 ${basis.packageId} 缺 contracted_cny——合同额不存在，已核实层不成立`);
  }
  const qr = qrOf(control, basis.quoteRoundId);
  if (typeof qr.contract_ref !== 'string' || qr.contract_ref.length === 0) {
    throw new Error(`cost summary: 定价行 ${rowId} 声称已核实（合同凭据），但询价轮次 ${basis.quoteRoundId} 缺 contract_ref——无合同引用，已核实层不成立`);
  }
  if (qr.status !== 'locked' || qr.locked_cny !== contracted) {
    throw new Error(`cost summary: 定价行 ${rowId} 的合同凭据对不上：${basis.quoteRoundId} status=${qr.status}、locked_cny=${qr.locked_cny}，与 ${basis.packageId} contracted_cny=${contracted} 不一致`);
  }
  // 主体绑定（自主扫描 G8）：轮次记录自带 pkg_id（如 QR-2026-10-03-24 的
  // pkg_id: PKG-030）——登记的 packageId 必须与轮次自己声明的归属包一
  // 致；否则包 A 的合同轮次能给包 B 的行背书（金额碰巧相等时其余检查全
  // 过）。缺失同样不许。
  if (qr.pkg_id !== basis.packageId) {
    throw new Error(`cost summary: 定价行 ${rowId} 的合同凭据主体对不上：询价轮次 ${basis.quoteRoundId} 自带 pkg_id=${typeof qr.pkg_id === 'string' ? qr.pkg_id : '缺失'}，与登记的 packageId=${basis.packageId} 不一致——轮次归属与行归属不是同一个包，已核实层不成立`);
  }
  assertContractCredential(rowId, qr.contract_ref, contracted, basis.packageId);
}

export interface CostRow {
  id: string;
  name: string;
  packageIds: string[];
  /** null = 未定价：不进合计、不按 0 显示。 */
  amountCny: number | null;
  grade: string;
  derivation: string;
  /**
   * 核实层级与理由：定价行必须在登记处显式裁定（数据驱动，渲染层不临时判断），
   * buildCostSummary 对缺失 tier 的定价行直接抛错；未定价行不入层级，留空。
   */
  tier?: CostTier;
  tierReason?: string;
  /** 已核实层的来源凭据：tier = verified 的行必填，由 assertVerifiedTierBasis 在构建时断言（层级守卫）。 */
  verifiedBasis?: VerifiedBasis;
  /** 覆盖登记：本行金额显式计入的未决条目 id（组件 COST-* / 询价轮次 QR-*）。 */
  coversItems?: string[];
}

/**
 * 待核条目的**计入状态**（2026-10-23 复审 P2）：这条待核事项所涉金额是否已在
 * 已知合计里。注意它与覆盖归属（counted/pending/excluded 三类登记）是两个不同
 * 的轴：覆盖归属管「未决条目在哪登记」，计入状态管「这条事项的钱在不在合计
 * 里」——如 COST-030-02 覆盖上是双归属，其待核条目登记的却是合同**外**增量
 * （钱不在合计里，计入状态为 uncounted）；防水去重覆盖上是 pending 登记，
 * 其 ¥366 却已在定价行里（计入状态为 counted）。
 *  - counted：金额已计入定价行，本条待确认/划界/去重核对——**不得作为新费用
 *    再往总额加一次**；但结案不是「只关事项、金额不动」：核对坐实后须对已计
 *    金额做修正（去重坐实则把重复部分扣回、确认未含则补计），可增可减；
 *  - uncounted：金额未计入任何定价行；本类含或然项（触发才发生）、待业主
 *    裁定项与范围未定项，只有在确认纳入一期、实际发生、且未被其他定价行
 *    包含后才计入并增加总额，未触发/未纳入/范围缩减的则不计；
 *  - uncertain：是否已含于某合同/报价未定，以确认结果为准，确认前不预断增减。
 * 每条待核条目必填（assertPendingClassifications 在构建时断言，缺失/非法即
 * 抛错）——早先 cost.md 总述笼统称「待核取得价格后会增加总额」，与已计入条目
 * 自相矛盾、会引导读者重复加算，本分类就是来堵这个口子的。
 */
export type PendingCountedStatus = 'counted' | 'uncounted' | 'uncertain';

/** 计入状态的渲染标签（待核清单逐条在状态列明示，防读者按总述误加）。 */
export const PENDING_COUNTED_STATUS_LABELS: Record<PendingCountedStatus, string> = {
  counted: '已计入 · 待确认',
  uncounted: '未计入 · 待定价',
  uncertain: '待确认是否已含',
};

const PENDING_COUNTED_STATUSES: ReadonlySet<string> = new Set(['counted', 'uncounted', 'uncertain']);

/** 待核分类完整性（fail-closed）：每条待核条目必须已裁定计入状态，缺失或非法值即抛错——不许渲染层默认、不许新条目裸奔进清单。 */
export function assertPendingClassifications(entries: PendingEntry[]): void {
  for (const entry of entries) {
    if (!entry.countedStatus || !PENDING_COUNTED_STATUSES.has(entry.countedStatus)) {
      throw new Error(`cost summary: 待核条目 ${entry.id} 缺计入状态分类（countedStatus 必须为 counted / uncounted / uncertain 之一，实际 ${entry.countedStatus ?? '缺失'}）——请先按其注脚事实裁定：金额已在定价行内 = counted，未计入 = uncounted，是否已含未定 = uncertain`);
    }
  }
}

/** 待核清单条目（本条自身不作定价行；所涉金额是否已在合计内逐条以 countedStatus 标注）。 */
export interface PendingEntry {
  id: string;
  name: string;
  packageIds: string[];
  /** 渲染用状态标签：数据里的实际 status + 中文短注。 */
  statusLabel: string;
  note: string;
  /** 计入状态分类（必填，见 PendingCountedStatus）：本条所涉金额是否已在已知合计里。 */
  countedStatus: PendingCountedStatus;
  /** 本条目承接的未决条目 id（组件 / 询价轮次）。 */
  coversItems: string[];
}

/** 不计价登记：未决条目经裁定不进本表（带理由）。 */
export interface ExcludedItem {
  item: string;
  label: string;
  reason: string;
}

export interface CoverageReport {
  scannedComponentCount: number;
  scannedQuoteRoundCount: number;
  /** 强制归属的未决条目数（本表范围组件未决 + 询价轮次未 locked）。 */
  unresolvedItemCount: number;
  countedItemCount: number;
  pendingItemCount: number;
  excludedItemCount: number;
  /** 显式声明的双归属条目数：同一条目在两个分类里各计一次（已含在上面分类计数内），故三类计数之和 = 未决总数 + 双归属数。 */
  dualAttributedItemCount: number;
  dualAttributedItemIds: string[];
  /** 范围外包（设计准备/窗帘/家具/家电）的组件数，按包登记排除。 */
  outOfScopeComponentCount: number;
}

export interface ExcludedFigure {
  label: string;
  amountCny: number;
  reason: string;
}

export interface CostSummaryData {
  rows: CostRow[];
  unpriced: CostRow[];
  /** 待核条目（去重/合同包含/范围对齐等未关闭事项），与 unpriced 同表呈现，计入状态逐条标注（已计入项的金额在定价行内）。 */
  pendingChecks: PendingEntry[];
  /** 未决条目的不计价登记（带理由）。 */
  excludedItems: ExcludedItem[];
  coverage: CoverageReport;
  notSeparate: Array<{ name: string; packageIds: string[]; note: string }>;
  excluded: ExcludedFigure[];
  /** 已核实层小计（tier = verified 的行）。 */
  verifiedSubtotalCny: number;
  /** 暂估层小计（tier = provisional 的行）。 */
  provisionalSubtotalCny: number;
  /** 已知合计 = 已核实 + 暂估；只是已定价行之和，不得读作已核实成本。 */
  knownSubtotalCny: number;
}

const yuan = (value: number) => `¥${Math.round(value).toLocaleString('zh-CN')}`;
const qty = (value: number, digits = 1) => {
  const text = value.toFixed(digits);
  return text.replace(/\.?0+$/, '') || '0';
};

function pkgOf(control: AnyRecord, id: string): AnyRecord {
  const pkg = (control.work_packages ?? []).find((item: AnyRecord) => item.id === id);
  if (!pkg) throw new Error(`cost summary: control.yaml 缺工作包 ${id}`);
  return pkg;
}

function qrOf(control: AnyRecord, id: string): AnyRecord {
  const record = (control.hard_finish_quote_rounds?.records ?? []).find((item: AnyRecord) => item.id === id);
  if (!record) throw new Error(`cost summary: control.yaml 缺询价轮次记录 ${id}`);
  return record;
}

function needOf(control: AnyRecord, id: string): number {
  const need = pkgOf(control, id).budget?.estimated_need_cny;
  if (typeof need !== 'number') throw new Error(`cost summary: ${id} 缺 estimated_need_cny，成本行无来源`);
  return need;
}

/** 构成分解必须与来源金额逐分对上；对不上说明映射表已过期，先更新映射再出表。 */
function assertDecomposition(rowId: string, parts: number[], total: number): void {
  const sum = parts.reduce((acc, part) => acc + part, 0);
  if (sum !== total) {
    throw new Error(`cost summary: ${rowId} 构成分解合计 ${sum} != 来源金额 ${total}——请先更新 scripts/schedule/cost-summary.ts 的映射与推导，再重新生成`);
  }
}

function categoryOf(categories: BudgetCategory[], key: string): BudgetCategory {
  const category = categories.find((item) => item.key === key);
  if (!category) throw new Error(`cost summary: 计算器快照缺科目 ${key}`);
  return category;
}

/** 与 scripts/project/mep-takeoff.ts 完全同一条装配路径（量只有一份，不许第二套）。 */
export function computeActiveMepQuote(): { comparison: MepQuoteComparison; takeoff: MepTakeoff; areaSqm: number } {
  const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules & { sources: Record<string, string> };
  const electrical = parseYaml(readFileSync(rules.sources.electrical_points, 'utf8')) as Parameters<typeof endpointSourcesFromFacts>[0]['electrical'];
  const plumbing = parseYaml(readFileSync(rules.sources.plumbing_points, 'utf8')) as Parameters<typeof endpointSourcesFromFacts>[0]['plumbing'];
  const ceiling = parseYaml(readFileSync(rules.sources.ceiling, 'utf8')) as unknown[];
  const hvac = parseYaml(readFileSync(rules.sources.hvac, 'utf8')) as { plans: unknown[] };
  const coordination = parseMepCoordination(readFileSync(rules.sources.routes, 'utf8'));
  const topology = parseYaml(readFileSync(rules.sources.circuits, 'utf8')) as {
    circuits: Parameters<typeof computeMepTakeoff>[0]['circuits'];
    controls?: Parameters<typeof computeMepTakeoff>[0]['controls'];
  };
  const sources = endpointSourcesFromFacts({
    electrical,
    plumbing,
    ceiling: ceiling as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['ceiling'],
    hvac: hvac as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['hvac'],
  });
  const takeoff = computeMepTakeoff({
    electrical: electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
    circuits: topology.circuits ?? [],
    controls: topology.controls ?? [],
    routes: coordination.routes,
    resolution: resolveMepRoutes(coordination, sources),
    rules,
  });
  const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { project?: { usable_area?: number } };
  const areaSqm = house.project?.usable_area;
  if (typeof areaSqm !== 'number' || !(areaSqm > 0)) {
    throw new Error('cost summary: config/house.yaml 的 project.usable_area 必须是正数（水电清包人工按㎡计价）');
  }
  const labor = parseYaml(readFileSync('config/mep-labor.yaml', 'utf8')) as Parameters<typeof mepQuoteFallback>[0];
  const fallback = mepQuoteFallback(labor);
  const comparisons = compareMepQuotes(loadMepQuotes(), takeoff, areaSqm, fallback);
  const comparison = comparisons.find((entry) => entry.active);
  if (!comparison) throw new Error('cost summary: config/mep-quotes.yaml 没有生效报价卡');
  if (comparison.total == null || comparison.pendingRows.length) {
    throw new Error(`cost summary: 生效水电报价卡 ${comparison.id} 存在待报价行（${comparison.pendingRows.join(', ')}），总额不可用`);
  }
  assertActiveMepQuoteIntegrity(comparison, fallback);
  return { comparison, takeoff, areaSqm };
}

/**
 * 生效水电报价卡的完整性断言（自主扫描 D1 / D2 / D6）：computeActiveMepQuote
 * 原只断言 total 非 null + pendingRows 为空，三条静默通道不在其内——
 * ① **fallback 顶替计价**（D1）：compareQuoteCards 对卡内**未声明**的费率
 * 行以 fallback 计价并标 rate_source（上游铁律「回落必须看得见」）；材料行
 * fallback 为 null（会进 pendingRows、安全），但 5 个人工行的 fallback 是
 * mep-labor.yaml 的真实费率——生效卡整行漏声明任一人工行时，总额照常算
 * 出、水电行推导却仍声称金额来自「生效卡单价」。本域实测细节：MEP 的
 * spec.fallbackLabel = 'mep-labor.yaml'，回落行的 rate_source 运行时值是
 * 回落源名而非字面 'fallback'，故断言以 `rate_source !== 'quote'` 判之
 * （任何非卡内声明的来源都算顶替）。本表口径：水电金额必须全部来自生效
 * 卡本身，顶替行必须显形为构建失败、点名行键。
 * ② **单位一致**（D2）：量纲在解析层只是非空字符串、从不校验——某行被改
 * 成不同量纲口径报价（如 panel 按 元/个 而非 元/模）时，per_unit 仍按原
 * 量纲的数量相乘、静默倍乘/漏乘。故每行 unit 须与 mepQuoteFallback 的规
 * 范单位表一致，不符抛错并点名行键与两个单位。
 * ③ **总额健全性**（D6）：本行原是全表唯一定价行没有正数断言的（合同行
 * 断言 contracted > 0、灯具行断言 amount > 0、美缝断言 target > 0）——算
 * 量整体归零会静默出 ¥0 行、NaN 会渲染成 ¥NaN 且全文全等校验因确定性输
 * 出而通过。故 total 必须有限且 > 0。
 * out_of_scope 行不参与以上三查（它们已被排除在总额外，处置走
 * assertMepOutOfScopeDispositions 的登记通道）。
 */
export function assertActiveMepQuoteIntegrity(
  comparison: MepQuoteComparison,
  fallback: MepQuoteFallback,
): void {
  if (typeof comparison.total !== 'number' || !Number.isFinite(comparison.total) || comparison.total <= 0) {
    throw new Error(`cost summary: 生效水电报价卡 ${comparison.id} 总额不健全（total=${comparison.total}）——总额必须是有限正数；算量整体归零或出现 NaN 时不得静默出 ¥0 / ¥NaN 水电行`);
  }
  for (const row of comparison.rows) {
    if (row.out_of_scope) continue;
    if (row.rate_source !== 'quote') {
      throw new Error(`cost summary: 生效水电报价卡 ${comparison.id} 的计价行 ${row.key} 未在卡内声明单价、由 fallback（${row.rate_source}）顶替计价——本表水电金额必须全部来自生效卡本身，请先在卡内补登该行单价（或标 out_of_scope 并登记处置）再生成`);
    }
    const canonicalUnit = fallback[row.key]?.unit;
    if (canonicalUnit && row.unit !== canonicalUnit) {
      throw new Error(`cost summary: 生效水电报价卡 ${comparison.id} 的计价行 ${row.key} 单位为「${row.unit}」，与规范单位「${canonicalUnit}」不一致——量纲对不上时 per_unit × 数量会静默倍乘/漏乘，请先对齐单位口径再生成`);
    }
  }
}

/**
 * 水电报价卡 out_of_scope 行处置登记（2026-10-23 复审再续 · P2）：
 * compareMepQuotes 把卡上标 out_of_scope 的行排除在 comparison.total 之外
 * （「这家不报这项」，见 shared/quote-cards.ts），这类行也不进 pendingRows
 * ——水电行推导若只核总额与待报价行，它们会被**静默少算**：总额不含、清单
 * 不显，覆盖检查对着 control.yaml 组件扫描、也看不见费率行这一层。故
 * fail-closed：生效卡每有一行 out_of_scope，必须在本表逐行登记处置（由哪条
 * 待核/哪张卡覆盖，或为何不计价），缺登记者构建抛错并点名行键。行键是 MEP
 * 费率行键（MEP_SPEC.keys，如 gas_alarm_kit），与 COST 组件 id 无自然对应，
 * 故走显式登记表而非 coversItems 归属。现行生效卡 owner_baseline_40 无
 * out_of_scope 行（其 comparability_notes 为空），本表为空——将来有行时先
 * 登记再生成，登记内容会随推导注脚在成本表表面显形。
 */
export const OUT_OF_SCOPE_DISPOSITIONS: Record<string, string> = {};

/** out_of_scope 处置校验（纯函数，可独立测试）：每个被排除行键必须有非空处置登记，缺一抛错并点名全部缺登行键。 */
export function assertMepOutOfScopeDispositions(
  outOfScopeRows: readonly string[],
  dispositions: Record<string, string> = OUT_OF_SCOPE_DISPOSITIONS,
): void {
  const unregistered = outOfScopeRows.filter((key) => !dispositions[key]?.trim());
  if (unregistered.length > 0) {
    throw new Error(`cost summary: 生效水电报价卡有 ${unregistered.length} 行被标为 out_of_scope（不在本家报价范围：${unregistered.join('、')}），但未在 OUT_OF_SCOPE_DISPOSITIONS 登记处置——这类行被排除在卡总额之外、也不是待报价行，不登记就会被静默少算；请逐行登记处置（由哪条待核/哪张卡覆盖，或为何不计价）后重新生成`);
  }
}

/**
 * out_of_scope 渲染注脚（纯函数）：无被排除行时为空串（现行渲染不变）；
 * 有则在水电行推导里显形行数与行键，并**逐行带上登记表中的处置全文**——
 * 只写「已登记处置」而理由不进表，读者仍须回生成器源码才知道这些钱去了
 * 哪（复审四轮点名）。处置缺登记时渲染占位（生产路径有
 * assertMepOutOfScopeDispositions 先行抛错，此形态只会出现在绕过守卫的
 * 直接调用里）。
 */
export function mepOutOfScopeFootnote(
  outOfScopeRows: readonly string[],
  dispositions: Record<string, string> = OUT_OF_SCOPE_DISPOSITIONS,
): string {
  if (outOfScopeRows.length === 0) return '';
  const details = outOfScopeRows
    .map((key) => `${key}：${dispositions[key]?.trim() || '（处置未登记）'}`)
    .join('；');
  return `；另有 ${outOfScopeRows.length} 行被生效卡标为不在本家报价范围，金额未计入本行，逐行处置（登记于生成器 OUT_OF_SCOPE_DISPOSITIONS）——${details}`;
}

/**
 * 水电行层级理由的事实绑定（自主扫描 D3）：cost-mep 的 tierReason 是写死
 * 生效卡身份的静态散文——卡 id（owner_baseline_40）、status（baseline）、
 * contractor（业主口径基线）、费率来源构成（多取 public_reference）与
 * COST-040-15 的 interface_pending 状态。本行金额与 verifiedBasis 都在构
 * 建时实时捕获，唯独理由是人写死的文本：生效卡切换或状态迁移后，金额跟
 * 随新卡、理由却继续描述旧卡，verify:schedule 只核产物与输入一致、照样
 * 绿灯。故构建时逐项断言理由所述事实此刻仍成立，任一不符抛错点名，迫使
 * 改卡/改状态时同步重写理由（与层级守卫同一 fail-closed 口径）。
 * 阈值按现行实测写死：生效卡共 32 行声明费率，其中 15 行 scope_note 带
 * public_reference 标记（≈47%，即理由所称「费率多取 public_reference
 * 公开参考价」）；公开参考价行数少于 15 即视为来源构成已变、理由失实。
 * contractor 实测全称以「业主口径基线」开头（「业主口径基线（伟星家装绿
 * + 远东 + …）」），理由里引的是其身份简称，故按前缀绑定。
 */
export function assertMepTierReasonFacts(
  comparison: { id: string; status: string; contractor: string },
  card: AnyRecord | undefined,
  cost04015Status: string | undefined,
): void {
  if (comparison.id !== 'owner_baseline_40') {
    throw new Error(`cost summary: 水电行 tierReason 绑定的是生效卡 owner_baseline_40，但当前生效卡是 ${comparison.id}——层级理由已失实，请先按新卡事实重写 tierReason 与本断言再生成`);
  }
  if (comparison.status !== 'baseline') {
    throw new Error(`cost summary: 水电行 tierReason 称生效卡 status 为 baseline，实际 ${comparison.status}——层级理由已失实，请先重写理由与层级裁定再生成`);
  }
  if (!comparison.contractor.startsWith('业主口径基线')) {
    throw new Error(`cost summary: 水电行 tierReason 称生效卡 contractor 为「业主口径基线」，实际「${comparison.contractor}」——层级理由已失实，请先重写理由与层级裁定再生成`);
  }
  if (!card) {
    throw new Error(`cost summary: 水电行 tierReason 事实无从核验：报价文件里找不到生效卡 ${comparison.id}`);
  }
  const rates = Object.values((card.rates ?? {}) as Record<string, AnyRecord>);
  const publicReferenceCount = rates.filter(
    (rate) => typeof rate?.scope_note === 'string' && rate.scope_note.includes('public_reference'),
  ).length;
  if (publicReferenceCount < 15) {
    throw new Error(`cost summary: 水电行 tierReason 称生效卡「费率多取 public_reference 公开参考价」，实测 ${rates.length} 行声明费率中只有 ${publicReferenceCount} 行带 public_reference 标记（绑定阈值 15，现行实测 15/32）——费率来源构成已变、理由失实，请先重写理由与本断言阈值再生成`);
  }
  if (cost04015Status !== 'interface_pending') {
    throw new Error(`cost summary: 水电行 tierReason 称 COST-040-15 状态为 interface_pending，实际 ${cost04015Status ?? '缺失'}——界面未决状态已变，请先重写理由（并同步待核清单与双归属登记）再生成`);
  }
}

/** 本表范围：硬装（hard_finish）+ 中央空调（hvac）两个预算池。范围外包的组件按包登记排除理由。 */
const IN_SCOPE_POOLS = new Set(['hard_finish', 'hvac']);
const OUT_OF_SCOPE_PACKAGE_REASONS: Record<string, string> = {
  'PKG-000': '设计准备池，不在本表硬装范围',
  'PKG-145': '窗帘池，不在本表范围',
  'PKG-150': '家具池，不在本表范围',
  'PKG-160': '家电池，不在本表范围',
};

/**
 * 组件已决状态白名单（按 control.yaml 实际数据摸全）：
 *  ownership_resolved = 归属已裁定（且已在洁具 need 构成内）；deferred_to_phase_2 /
 *  excluded_to_phase_2 = 已裁定移出的一期范围。其余全部 status 一律按未决处理：
 *  notice_pending / quote_pending / quantity_pending / selection_pending /
 *  site_measurement_pending / interface_pending / duplication_check_required /
 *  contract_scope_pending / risk_pending / vendor_written_confirmation_pending /
 *  equipment_parameters_pending / cap_pending_store_quote /
 *  budget_pool_confirmed_quote_pending / owner_decision_pending / alignment_required /
 *  quoted_pending_optimization / gas_requirement_pending /
 *  owner_selected_pending_verification / candidate_pending_quote / candidate /
 *  scope_schedule_pending / responsibility_pending（以上为本表范围内实际出现者）；
 *  status 缺失同样按未决处理——未知状态默认未决（fail-closed），新 status 不登记
 *  白名单就必须走覆盖归属。询价轮次 status ≠ locked 即未决（每条记录都带
 *  dedup_rule，记录未 locked 视为去重未关闭）。
 */
const RESOLVED_COMPONENT_STATUSES = new Set(['ownership_resolved', 'deferred_to_phase_2', 'excluded_to_phase_2']);

/** 覆盖归属的三个分类：定价行计入 / 未定价与待核 / 不计价登记。 */
export type AttributionKind = 'counted' | 'pending' | 'excluded';

/** 双归属声明：同一未决条目同时登记在两个分类的唯一合法通道（带理由，逐条裁定）。 */
export interface DualAttributionDeclaration {
  item: string;
  reason: string;
}

/**
 * 双归属登记（2026-10-23 复核 P2）：归属是集合语义——一条目可以同时属于两个
 * 分类，但多重归属必须在此显式声明并附理由；未声明的多重归属一律抛错，
 * 声明与实际归属不符（条目已不再多重归属）同样抛错（防登记腐烂）。
 *  COST-030-02：铜管主体金额计入空调签约行，其合同外增量（风口加长/复合风管/
 *    税，DEC-2026-10-04-R1/R2 核清不含于 36,000）另列待核——「已计金额」与
 *    「未决增量」是同一组件的两面。
 *  COST-030-07：线控器金额按业主 2026-10-12 口述计入空调签约行（含在 36,000
 *    内、增量 ¥0），但型号（须 KJRF-90RT/MW）/数量 6 只/安装对码责任/控制线
 *    芯数四项门店书面确认未闭，另列待核——金额归属与确认归属分离，只登记
 *    counted 会把 closure 夸大成「已全闭」。
 *  COST-040-15：封槽料与阴阳角网格布的金额已在水电报价卡辅材包干内计一次
 *    （水电行计入），但它与 PKG-080 基层修补的施工界面须书面划清
 *    （interface_pending，control 原文「防止两边都说含」）——金额归属与界面
 *    归属分离，只藏在水电行 coversItems 里则成本表表面看不见这件未决事。
 */
export const DUAL_ATTRIBUTIONS: DualAttributionDeclaration[] = [
  { item: 'COST-030-02', reason: '铜管主体计入空调签约行，合同外增量另列待核（已计金额与未决增量分属两类）' },
  { item: 'COST-030-07', reason: '线控器金额按业主口述计入空调签约行（增量 ¥0），型号/数量/对码责任/线芯数四项书面确认另列待核（金额归属与确认归属分离）' },
  { item: 'COST-040-15', reason: '封槽料金额已计入水电行（报价卡辅材包干），与 PKG-080 基层修补的书面界面划分另列待核（金额归属与界面归属分离）' },
];

/**
 * 双归属校验（纯函数，可独立测试）：claims 是条目 → 归属分类集合。
 * 双归属上限为**恰两个分类**：同一条目出现在三个及以上分类（counted +
 * pending + excluded 任意三路），无论是否已声明都抛错——三路登记必有重复
 * 计价或处置冲突（2026-10-23 复审续）。两个分类的多重归属必须命中显式
 * 声明，未声明抛错并点名 id；声明腐烂（声明的条目并非多重归属的未决
 * 条目）同样抛错。返回实际生效的双归属条目 id（排序后）。
 */
export function assertAttributionClaims(
  claims: ReadonlyMap<string, ReadonlySet<AttributionKind>>,
  declarations: readonly DualAttributionDeclaration[],
  unresolvedIds: ReadonlySet<string>,
): string[] {
  const declared = new Map(declarations.map((declaration) => [declaration.item, declaration]));
  const dualIds: string[] = [];
  for (const [id, kinds] of claims) {
    if (!unresolvedIds.has(id)) continue;
    if (kinds.size > 2) {
      throw new Error(`cost summary: 覆盖检查失败，条目 ${id} 被三重归属（${[...kinds].join(' + ')}）——双归属上限为恰两个分类，三路登记必有重复计价或处置冲突，请裁定唯一处置后重新生成`);
    }
    if (kinds.size <= 1) continue;
    if (!declared.has(id)) {
      throw new Error(`cost summary: 覆盖检查失败，条目 ${id} 被多重归属（${[...kinds].join(' + ')}）但未在 DUAL_ATTRIBUTIONS 显式声明双归属及理由——多重归属不许静默取首个分类，请先裁定并声明，再重新生成`);
    }
    dualIds.push(id);
  }
  for (const declaration of declarations) {
    const kinds = claims.get(declaration.item);
    if (!kinds || kinds.size <= 1 || !unresolvedIds.has(declaration.item)) {
      throw new Error(`cost summary: 双归属声明 ${declaration.item} 已腐烂——该条目当前并非「多重归属的未决条目」，请删除声明或修正归属登记`);
    }
  }
  return dualIds.sort();
}

/**
 * 重复计入校验（纯函数，可独立测试）：countedClaims 是条目 → 计入它的定价行
 * 标识列表。集合语义的归属收集只能看见「分类」，看不见「同属 counted 的两条
 * 不同定价行」——同一条目被两条定价行各计一次金额就是重复计价，必须抛错
 * 并点名条目与两条行（2026-10-23 复审续）。同一行内重复登记同一条目不算
 * （按行去重后判断）。
 */
export function assertNoDuplicateCountedClaims(
  countedClaims: ReadonlyMap<string, readonly string[]>,
): void {
  for (const [id, rowIds] of countedClaims) {
    const distinctRows = [...new Set(rowIds)];
    if (distinctRows.length > 1) {
      throw new Error(`cost summary: 覆盖检查失败，条目 ${id} 被多条定价行重复计入（${distinctRows.join('、')}）——同一条目的金额不许在两条定价行各计一次，请裁定唯一计入行，另一处改走未定价与待核或不计价登记`);
    }
  }
}

/**
 * 覆盖检查（fail-closed）：全量扫描 control.yaml 的组件与询价轮次，每个未决条目
 * 必须在覆盖登记里有归属（定价行 coversItems / 未定价与待核 coversItems / 不计价
 * 登记），登记指向不存在的条目同样报错。归属按集合语义收集：同一条目登记在
 * 多个分类时不取首个了事，必须命中 DUAL_ATTRIBUTIONS 的显式双归属声明
 * （见 assertAttributionClaims）；同属 counted 分类的两条不同定价行重复计入
 * 同一条目另由 assertNoDuplicateCountedClaims 拦截。清单因此不是手写名单：
 * 数据新增未决条目而登记未跟上时，生成直接失败、verify 报错。
 */
function assertCoverage(
  control: AnyRecord,
  rows: CostRow[],
  unpriced: CostRow[],
  pendingChecks: PendingEntry[],
  excludedItems: ExcludedItem[],
): CoverageReport {
  const claims = new Map<string, Set<AttributionKind>>();
  const claim = (id: string, kind: AttributionKind) => {
    const kinds = claims.get(id) ?? new Set<AttributionKind>();
    kinds.add(kind);
    claims.set(id, kinds);
  };
  // counted 归属另按行收集：集合语义看不见「两条不同定价行计入同一条目」，
  // 重复计入（重复计价）由 assertNoDuplicateCountedClaims 单独拦截并点名。
  const countedClaims = new Map<string, string[]>();
  for (const row of rows) {
    for (const id of row.coversItems ?? []) {
      claim(id, 'counted');
      countedClaims.set(id, [...(countedClaims.get(id) ?? []), `${row.id}（${row.name}）`]);
    }
  }
  assertNoDuplicateCountedClaims(countedClaims);
  for (const entry of unpriced) for (const id of entry.coversItems ?? []) claim(id, 'pending');
  for (const entry of pendingChecks) for (const id of entry.coversItems) claim(id, 'pending');
  for (const item of excludedItems) claim(item.item, 'excluded');

  const knownIds = new Set<string>();
  const unresolvedIds = new Set<string>();
  const missing: string[] = [];
  let scannedComponentCount = 0;
  let outOfScopeComponentCount = 0;
  const referencedPackages = new Set<string>();
  for (const list of [rows, unpriced]) for (const entry of list) for (const id of entry.packageIds) referencedPackages.add(id);
  for (const entry of pendingChecks) for (const id of entry.packageIds) referencedPackages.add(id);

  for (const pkg of control.work_packages ?? []) {
    const components: AnyRecord[] = pkg.budget?.components ?? [];
    const inScope = IN_SCOPE_POOLS.has(pkg.budget_pool);
    if (!inScope && !OUT_OF_SCOPE_PACKAGE_REASONS[pkg.id]) {
      missing.push(`${pkg.id}（范围外工作包未在 OUT_OF_SCOPE_PACKAGE_REASONS 登记）`);
    }
    if (inScope && components.length > 0 && !referencedPackages.has(pkg.id)) {
      missing.push(`${pkg.id}（带组件的本表范围工作包未被任何定价行/清单引用）`);
    }
    for (const component of components) {
      scannedComponentCount += 1;
      knownIds.add(component.id);
      if (!inScope) {
        outOfScopeComponentCount += 1;
        continue;
      }
      if (typeof component.status === 'string' && RESOLVED_COMPONENT_STATUSES.has(component.status)) continue;
      unresolvedIds.add(component.id);
      if (!claims.has(component.id)) {
        missing.push(`${component.id}（${pkg.id} 组件，status=${component.status ?? '缺失'}）`);
      }
    }
  }
  let scannedQuoteRoundCount = 0;
  for (const record of control.hard_finish_quote_rounds?.records ?? []) {
    scannedQuoteRoundCount += 1;
    knownIds.add(record.id);
    if (record.status === 'locked') continue;
    unresolvedIds.add(record.id);
    if (!claims.has(record.id)) {
      missing.push(`${record.id}（询价轮次，status=${record.status}）`);
    }
  }
  for (const id of claims.keys()) {
    if (!knownIds.has(id)) missing.push(`${id}（覆盖登记指向不存在的条目，登记已腐烂）`);
  }
  if (missing.length > 0) {
    throw new Error(`cost summary: 覆盖检查失败，下列未决条目未登记归属：${missing.join('；')}——请先在 scripts/schedule/cost-summary.ts 的覆盖登记中裁定（计入定价行 coversItems / 未定价与待核条目 / 不计价登记 excludedItems），再重新生成`);
  }
  // 双归属校验：多重归属必须命中显式声明（未声明或声明腐烂都在此抛错并点名）。
  const dualAttributedItemIds = assertAttributionClaims(claims, DUAL_ATTRIBUTIONS, unresolvedIds);
  // 计数按集合语义逐类统计：双归属条目在两个分类各计一次，故三类之和
  // = 未决总数 + 双归属数（渲染层与测试都按这个恒等式对账，不再假装互斥）。
  const hasKind = (id: string, kind: AttributionKind) => claims.get(id)?.has(kind) ?? false;
  const countedItemCount = [...unresolvedIds].filter((id) => hasKind(id, 'counted')).length;
  const pendingItemCount = [...unresolvedIds].filter((id) => hasKind(id, 'pending')).length;
  const excludedItemCount = [...unresolvedIds].filter((id) => hasKind(id, 'excluded')).length;
  return {
    scannedComponentCount,
    scannedQuoteRoundCount,
    unresolvedItemCount: unresolvedIds.size,
    countedItemCount,
    pendingItemCount,
    excludedItemCount,
    dualAttributedItemCount: dualAttributedItemIds.length,
    dualAttributedItemIds,
    outOfScopeComponentCount,
  };
}

export function buildCostSummary(control: AnyRecord): CostSummaryData {
  const catalog = ProjectCatalog.load('.');
  const rulesConfig = RuleEngine.load('config/design-rules.yaml').getConfig();
  const calculator = new BudgetCalculator(catalog, rulesConfig);
  const scheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
  const snapshot = calculator.calculate(scheme);
  const cat = (key: string) => categoryOf(snapshot.categories, key);
  /** 科目「已定价总额」口径：actual（已取证材料 + 人工）+ candidateActual（候选材料）。仅用于防双算登记与涂装行。 */
  const categoryTotal = (key: string) => Math.round(cat(key).actual + (cat(key).candidateActual ?? 0));

  const rows: CostRow[] = [];

  // ── 拆改（PKG-020）：同户型实付锚，从包说明原文解析，解析不到即抛错 ──
  {
    const description = String(pkgOf(control, 'PKG-020').description ?? '');
    const match = description.match(/拆砌人工([\d,]+)元\+物业垃圾清运([\d,]+)元/);
    if (!match) throw new Error('cost summary: PKG-020 说明里的同户型实付锚（拆砌人工+物业垃圾清运）解析失败');
    const labor = Number(match[1].replaceAll(',', ''));
    const haul = Number(match[2].replaceAll(',', ''));
    rows.push({
      id: 'cost-demolition',
      name: '拆改、墙体新建与清运',
      packageIds: ['PKG-020'],
      amountCny: labor + haul,
      grade: '参考实付',
      tier: 'provisional',
      tierReason: '同户型实付锚、非本户报价，未锁价',
      // 实付锚覆盖拆除/新建/清运三项范围；-04 清运核重是去重问题，另列待核。
      coversItems: ['COST-020-01', 'COST-020-02', 'COST-020-03', 'QR-2026-10-03-01'],
      derivation: `同户型半包实付锚（PKG-020 说明原文）：拆砌人工 ${yuan(labor)} + 物业垃圾清运 ${yuan(haul)}。非本户报价，本户金额待量房后按确认图纸复核；QR-2026-10-03-01 的 ${yuan(qrOf(control, 'QR-2026-10-03-01').owner_target_cny)} 是候选目标、非价格，不采用`,
    });
  }

  // ── 中央空调（PKG-030 + PKG-140）：合同额 ──
  {
    const contracted = pkgOf(control, 'PKG-030').budget?.contracted_cny;
    if (typeof contracted !== 'number') throw new Error('cost summary: PKG-030 缺 contracted_cny');
    const qr = qrOf(control, 'QR-2026-10-03-24');
    if (qr.locked_cny !== contracted) {
      throw new Error(`cost summary: QR-2026-10-03-24 locked_cny=${qr.locked_cny} 与 PKG-030 contracted_cny=${contracted} 不一致`);
    }
    rows.push({
      id: 'cost-hvac',
      name: '中央空调',
      packageIds: ['PKG-030', 'PKG-140'],
      amountCny: contracted,
      grade: '已签约',
      tier: 'verified',
      tierReason: '已转合同、成交价锁定（合同外不含项另在未定价与待核清单登记，不属本行金额）',
      verifiedBasis: { type: 'contract', packageId: 'PKG-030', quoteRoundId: 'QR-2026-10-03-24' },
      // 整包合同覆盖机组/管路主体/支架风口/两次安装/线控器本体（-07 金额按业主口述
      // 含在合同内、增量 ¥0，但型号/数量/对码责任/线芯数四项门店书面确认未闭，
      // 与待核清单双归属登记，见 DUAL_ATTRIBUTIONS）；
      // -02 的合同外增量与 -06 的可能增项另列待核，与本行并行登记（-02 同为双归属）。
      coversItems: ['COST-030-01', 'COST-030-02', 'COST-030-03', 'COST-030-04', 'COST-030-05', 'COST-030-07', 'QR-2026-10-03-24'],
      derivation: `合同额：QR-2026-10-03-24（${qr.item}）已转合同（contract_ref ${qr.contract_ref}），成交 ${yuan(contracted)}（含辅材；不含复合风管与风口加长、不含税）；本行金额 = PKG-030 的 contracted_cny。PKG-140 二次安装含在本包合同（included_in_other_package），不另计`,
    });
  }

  // ── 水电（PKG-040）：算量 × 生效报价卡 ──
  {
    const { comparison, takeoff, areaSqm } = computeActiveMepQuote();
    // out_of_scope 行 fail-closed（见 OUT_OF_SCOPE_DISPOSITIONS 头注）：被生效
    // 卡排除在总额之外的行既非待报价行、也不进总额，必须逐行登记处置，
    // 否则静默少算；有此行时推导口径同步改写并附注脚显形。
    const outOfScopeRows = comparison.outOfScopeRows;
    assertMepOutOfScopeDispositions(outOfScopeRows);
    // 层级理由事实绑定（见 assertMepTierReasonFacts）：理由是静态散文，
    // 生效卡身份/状态/费率来源构成与 COST-040-15 未决状态任一变化都必须
    // 先改理由再出表，不许金额跟新卡走、理由还停在旧卡。
    const mepCard = (loadMepQuotes().quotes as unknown as AnyRecord[]).find((quote) => quote.id === comparison.id);
    const cost04015Status = ((pkgOf(control, 'PKG-040').budget?.components ?? []) as AnyRecord[])
      .find((component) => component.id === 'COST-040-15')?.status as string | undefined;
    assertMepTierReasonFacts(comparison, mepCard, cost04015Status);
    const pricingNote = outOfScopeRows.length === 0
      ? `${comparison.rows.length} 行全部计价、无待报价行`
      : `${comparison.rows.length} 行中 ${comparison.rows.length - outOfScopeRows.length} 行计价、无待报价行${mepOutOfScopeFootnote(outOfScopeRows)}`;
    const total = comparison.total as number;
    const subtotalOf = (...keys: string[]) => comparison.rows
      .filter((row) => keys.includes(row.key))
      .reduce((sum, row) => sum + (row.subtotal ?? 0), 0);
    const laborPart = subtotalOf('labor_by_area');
    const laborRate = comparison.rows.find((row) => row.key === 'labor_by_area')?.per_unit;
    if (laborRate == null) throw new Error('cost summary: 生效水电报价卡缺清包人工单价');
    const wirePart = subtotalOf('wire_1_5', 'wire_2_5', 'wire_4_0', 'wire_trunk');
    const conduitPart = subtotalOf('conduit_20', 'conduit_25');
    const restPart = total - laborPart - wirePart - conduitPart;
    rows.push({
      id: 'cost-mep',
      name: '水电改造',
      packageIds: ['PKG-040'],
      amountCny: Math.round(total),
      grade: '报价卡实算',
      tier: 'provisional',
      tierReason: '生效卡 owner_baseline_40 是业主口径基线（contractor 为「业主口径基线」、status: baseline、费率多取 public_reference 公开参考价），属业主自建基线而非施工方书面报价或锁价；且 coversItems 中 COST-040-15 状态 interface_pending（封槽料与 PKG-080 基层修补的边界须书面划清、尚未关闭）——两点都与已核实口径（锁定或完整实算且无未决标记）不符，降暂估层（2026-10-23 复核 P1）',
      // 来源凭据照实登记（卡 id + 构建时捕获的 status）：本行现为暂估层不触发守卫；
      // 若将来把本行改回已核实，层级守卫会按此 status 断言、baseline 必抛错。
      verifiedBasis: { type: 'quote-card', cardId: comparison.id, cardStatus: comparison.status },
      // 报价卡逐行覆盖给排水/线路/器件：panel=强电箱、leb_kit+增项=等电位、gas_alarm_kit=报警器、
      // exhaust_duct_kit=排风、spd=浪涌、breaker=断路器、entry_valve_kit=阀件、hot_pipe_insulation=保温、
      // aux_lump 包干行与 -18 同名同范围、开孔/打压测试在增项行、封槽料与套管属辅材包干（金额已在
      // 卡内计一次）；其中 -15 封槽料与 PKG-080 基层修补的边界须书面划清（interface_pending），
      // 该未决事项另列待核清单与本行双归属登记（见 DUAL_ATTRIBUTIONS），不许只藏在本行里。
      // 只有 -09 燃气管道不在卡内，另列待核。
      coversItems: ['COST-040-01', 'COST-040-02', 'COST-040-03', 'COST-040-04', 'COST-040-05', 'COST-040-06', 'COST-040-07', 'COST-040-08', 'COST-040-10', 'COST-040-11', 'COST-040-12', 'COST-040-13', 'COST-040-14', 'COST-040-15', 'COST-040-16', 'COST-040-17', 'COST-040-18', 'COST-040-19', 'COST-040-20'],
      derivation: `算量 × 生效报价卡：shared/mep-takeoff.ts 按路由实算（强电计价管长 ${qty(takeoff.conduit.strongPowerTotalM)} m、导线 ${qty(takeoff.wire.totalWireM)} m，给排水与器件逐项），× config/mep-quotes.yaml 生效卡 ${comparison.id} 单价，${pricingNote}——清包人工 ${yuan(laborPart)}（${qty(areaSqm, 2)} ㎡ × ${yuan(laborRate)}/㎡）、导线 ${yuan(wirePart)}、线管 ${yuan(conduitPart)}、其余管材/器件/增项 ${yuan(restPart)}，卡总额 ${yuan(total)} 取整。算量口径含竖直段补计（DEC-2026-10-23-R01：计价基数 = 平面 union + 竖直段，PR #11 已合入）`,
    });
  }

  // ── 防水人工（PKG-050 的人工部分）：计算器科目 waterproof 的算量费率 ──
  {
    const waterproof = cat('waterproof');
    if ((waterproof.verifiedActual ?? 0) !== 0 || (waterproof.candidateActual ?? 0) !== 0 || waterproof.manualActual !== 0 || waterproof.autoActual !== 0) {
      throw new Error('cost summary: 科目 waterproof 出现材料金额——366 元「纯人工」口径已变化，请重新裁定防水行来源');
    }
    const baseRaw = JSON.parse(readFileSync('config/budget/base.json', 'utf8')) as AnyRecord;
    const wetRate = baseRaw.categories?.waterproof?.labor?.rate;
    if (typeof wetRate !== 'number') throw new Error('cost summary: base.json 的 waterproof.labor.rate 缺失');
    const wetArea = catalog.getRooms()
      .filter((room: AnyRecord) => room.needs_waterproof === true)
      .reduce((sum: number, room: AnyRecord) => sum + room.width * room.depth, 0);
    if (Math.abs(wetArea * wetRate - waterproof.actual) > 1) {
      throw new Error(`cost summary: 防水人工对不上（${qty(wetArea, 2)} ㎡ × ${wetRate} = ${qty(wetArea * wetRate, 2)}，科目 actual = ${waterproof.actual}）`);
    }
    rows.push({
      id: 'cost-waterproof-labor',
      name: '防水人工',
      packageIds: ['PKG-050'],
      amountCny: Math.round(waterproof.actual),
      grade: '算量费率',
      tier: 'provisional',
      tierReason: '费率实算，但 QR-2026-10-03-03 的 dedup_rule 未关闭——可能已含于瓦工预算池，去重确认前不入已核实层',
      derivation: `计算器科目 waterproof 的人工：费率 ${yuan(wetRate)}/㎡（config/budget/base.json 的 waterproof.labor）× 湿区面积 ${qty(wetArea, 2)} ㎡（needs_waterproof 房间——主卫、客卫、厨房、北阳台——面积合计）= ${yuan(waterproof.actual)}，仅人工；防水材料未定价（见未定价与待核清单）。**待去重确认**：QR-2026-10-03-03 的 dedup_rule 明文「若瓦工 ${yuan(18500)} 预算池已含防水人工，最终报价必须去重」，该去重尚未关闭，本行可能已含于泥瓦行的瓦工预算池内——去重关闭前只入暂估层`,
    });
  }

  // ── 泥瓦（PKG-060）：estimated_need，构成断言 ──
  {
    const need = needOf(control, 'PKG-060');
    const tileSqm = loadMasonryTakeoff(catalog).totalTileSqm;
    const wallTilePart = 2591; // R04：墙砖量 36.7236→37.0186 ㎡ ×70 ≈ 2,591（原 2,571）
    if (Math.abs(tileSqm * 70 - wallTilePart) > 1) {
      throw new Error(`cost summary: 墙砖主材对不上（${qty(tileSqm, 4)} ㎡ × 70 = ${qty(tileSqm * 70, 2)}，映射登记 ${wallTilePart}）`);
    }
    assertDecomposition('cost-masonry', [20000, 18500, 4000, wallTilePart], need);
    rows.push({
      id: 'cost-masonry',
      name: '泥瓦与铺贴',
      packageIds: ['PKG-060'],
      amountCny: need,
      grade: '报价轮实算',
      tier: 'provisional',
      tierReason: '构成含瓷砖封顶价、瓦工预算池（quote_pending）、待报价辅材与候选墙砖，均未锁价',
      // need 构成逐项对应：-01 主材封顶、-04 人工池、-02 辅材、-08 墙砖；其余四项不在构成内，另列待核。
      coversItems: ['COST-060-01', 'COST-060-02', 'COST-060-04', 'COST-060-08', 'QR-2026-10-03-04', 'QR-2026-10-03-05', 'QR-2026-10-03-06'],
      derivation: `业主询价轮次（QR-2026-10-03-04/05/06）：瓷砖主材封顶 ${yuan(20000)} + 瓦工人工预算池 ${yuan(18500)} + 辅材约 ${yuan(4000)} = ${yuan(42500)}；墙砖主材按 DEC-2026-10-16-TILE-01 终核另计：masonry-takeoff 全量 ${qty(tileSqm, 4)} ㎡ × wall_tile_01 候选 ${yuan(70)}/㎡ ≈ ${yuan(wallTilePart)}；合计 = PKG-060 的 estimated_need_cny ${yuan(need)}。COST-060-05 小砖条人工待书面报价、未计入 need（已登记在未定价与待核清单）`,
    });
  }

  // ── 美缝（PKG-065 + PKG-130）：询价轮次登记定额，暂估非算量 ──
  {
    const qr = qrOf(control, 'QR-2026-10-03-07');
    const target = qr.owner_target_cny;
    if (typeof target !== 'number' || target <= 0) throw new Error('cost summary: QR-2026-10-03-07 缺 owner_target_cny');
    const tileComparison = parseYaml(readFileSync('config/tile-comparison.yaml', 'utf8')) as AnyRecord;
    const grout = tileComparison.grout_model;
    const computed = grout?.pkg130_reconciliation?.computed_need_cny;
    if (grout?.pkg130_reconciliation?.owner_target_cny !== target || typeof computed !== 'number') {
      throw new Error('cost summary: tile-comparison.yaml 的 grout_model 对账与 QR-2026-10-03-07 定额不一致');
    }
    rows.push({
      id: 'cost-grout',
      name: '美缝（全屋）',
      packageIds: ['PKG-065', 'PKG-130'],
      amountCny: target,
      grade: '定额暂估',
      tier: 'provisional',
      tierReason: '定额暂估、pending_quote，门店按米终核未取得',
      coversItems: ['COST-065-01', 'COST-065-02', 'COST-130-01', 'COST-130-02', 'QR-2026-10-03-07'],
      derivation: `定额暂估：DEC-2026-08-22 环氧彩砂暂估入账，QR-2026-10-03-07 登记 ${yuan(target)}（price_type: candidate、pending_quote，暂估非算量）；DEC-2026-10-22-R03 按砖缝长度估算拆两包（湿区约 56 m → PKG-065、其余全屋约 750 m → PKG-130），本表合并一行，金额取 QR 登记定额、不取两包 planned_cny。交叉核对（仅干区）：干区实算 ${yuan(computed)}（115.404 ㎡ × ${yuan(20)}/㎡ 包工包料，业主口述、未确认；config/tile-comparison.yaml grout_model），未超定额；但本核对只覆盖干区——湿区约 56 m 的按米成本尚无任何估值，门店按米终核未取得前，不能据此证明全屋美缝 ≤ 定额 ${yuan(target)}`,
    });
  }

  // ── 吊顶（PKG-070）：estimated_need = 定标目标 ──
  {
    const need = needOf(control, 'PKG-070');
    assertDecomposition('cost-ceiling', [13500, 4500], need);
    rows.push({
      id: 'cost-ceiling',
      name: '吊顶',
      packageIds: ['PKG-070'],
      amountCny: need,
      grade: '定标目标',
      tier: 'provisional',
      tierReason: '定标目标价、非成交价，裸价重报未取得',
      // 定标目标覆盖面层/集成吊顶/边缘处理与两条来源轮次；-01 龙骨材料含否未明示，另列待核。
      coversItems: ['COST-070-02', 'COST-070-03', 'COST-070-04', 'QR-2026-10-03-08', 'QR-2026-10-03-09'],
      derivation: `业主定标后重算（DEC-2026-10-05-R3）：石膏板吊顶与窗帘盒目标 ${yuan(13500)} + 铝扣板裸价目标 ${yuan(4500)}（设备拆分后反推目标、非成交价，裸价重报待取得）= PKG-070 的 estimated_need_cny ${yuan(need)}；实际以生效报价卡 + COST-070 逐项报价为准`,
    });
  }

  // ── 涂装（PKG-080）：计算器科目 painting（人工算量费率 + 材料候选价） ──
  {
    const painting = cat('painting');
    if ((painting.verifiedActual ?? 0) !== 0 || painting.manualActual !== 0) {
      throw new Error('cost summary: 科目 painting 出现已取证/录入金额——涂装行构成已变化，请重新裁定');
    }
    const baseRaw = JSON.parse(readFileSync('config/budget/base.json', 'utf8')) as AnyRecord;
    const paintRate = baseRaw.categories?.painting?.labor?.rate;
    if (typeof paintRate !== 'number') throw new Error('cost summary: base.json 的 painting.labor.rate 缺失');
    const paintArea = [...loadPaintScopeAreaByRoom(catalog, loadPaintScopeInputs()).values()]
      .reduce((sum, area) => sum + area, 0);
    if (Math.abs(paintArea * paintRate - painting.actual) > 1) {
      throw new Error(`cost summary: 涂装人工对不上（${qty(paintArea, 2)} ㎡ × ${paintRate} = ${qty(paintArea * paintRate, 2)}，科目 actual = ${painting.actual}）`);
    }
    const paintItem = snapshot.lineItems.find((item) => item.topic === 'paint' && item.cost > 0);
    if (!paintItem) throw new Error('cost summary: 计算器快照缺 paint 材料行');
    const laborPart = Math.round(painting.actual);
    const materialPart = Math.round(painting.candidateActual ?? 0);
    rows.push({
      id: 'cost-painting',
      name: '墙顶面基层与涂装',
      packageIds: ['PKG-080'],
      amountCny: laborPart + materialPart,
      grade: '算量费率+候选价',
      tier: 'provisional',
      tierReason: '人工为静态费率、材料为候选价，均未锁价',
      coversItems: ['COST-080-01', 'COST-080-02', 'COST-080-03', 'COST-080-04'],
      derivation: `计算器科目 painting：人工 ${yuan(laborPart)} = 涂装净面积约 ${qty(paintArea, 1)} ㎡（shared/paint-scope.ts 按 overlay 的 paint_region 声明实算）× ${yuan(paintRate)}/㎡（config/budget/base.json 的 painting.labor）；材料 ${yuan(materialPart)} = 选品 ${paintItem.optionId} 候选价 ${yuan(paintItem.unitPrice)}/桶 ÷ ${qty(paintItem.coveragePerUnit)} ㎡/桶 × ${qty(paintItem.lossRate, 2)} 损耗 × 同面积`,
    });
  }

  // ── 洁具（PKG-100）：estimated_need，构成断言 ──
  {
    const need = needOf(control, 'PKG-100');
    assertDecomposition('cost-sanitary', [5598, 3500, 1300, 1100, 1800, 1500], need);
    rows.push({
      id: 'cost-sanitary',
      name: '洁具与五金',
      packageIds: ['PKG-100'],
      amountCny: need,
      grade: '报价轮实算',
      tier: 'provisional',
      tierReason: '报价轮构成含封顶价与候选项（马桶未锁定、浴室柜待报价），未锁价',
      // need 构成逐项对应 -01..-05 与六条来源轮次；-06 浴霸自购，不计价登记。
      coversItems: ['COST-100-01', 'COST-100-02', 'COST-100-03', 'COST-100-04', 'COST-100-05', 'QR-2026-10-03-14', 'QR-2026-10-03-15', 'QR-2026-10-03-16', 'QR-2026-10-03-17', 'QR-2026-10-03-18', 'QR-2026-10-03-19'],
      derivation: `业主询价轮次（2026-10-03）经 DEC-2026-10-05-R12、DEC-2026-10-07-R02 两次收口：智能马桶封顶 ${yuan(5598)}（九牧 ZQ6650 cap、未锁定）+ 浴室柜 ${yuan(3500)}（主卫 ${yuan(1500)} + 客卫 ${yuan(2000)}）+ 花洒 ${yuan(1300)} + 龙头下水角阀 ${yuan(1100)} + 固定玻璃屏 ${yuan(1800)} + 通用五金 ${yuan(1500)} = PKG-100 的 estimated_need_cny ${yuan(need)}。不含浴霸：COST-100-06 业主自购待决策（QR-2026-10-05-01 ${yuan(1362)}）未计入`,
    });
  }

  // ── 橱柜（PKG-110）：estimated_need，构成断言 ──
  {
    const need = needOf(control, 'PKG-110');
    assertDecomposition('cost-cabinet', [12000, 1500], need);
    rows.push({
      id: 'cost-cabinet',
      name: '橱柜及台面',
      packageIds: ['PKG-110'],
      amountCny: need,
      grade: '报价轮实算',
      tier: 'provisional',
      tierReason: '报价轮目标构成、两轮询价均 pending_quote，未锁价',
      coversItems: ['COST-110-01', 'COST-110-02', 'COST-110-03', 'COST-110-04', 'COST-110-05', 'QR-2026-10-03-20', 'QR-2026-10-03-21'],
      derivation: `业主询价轮次（QR-2026-10-03-20/21）：橱柜 + PET 柜门 + 20mm 石英石目标 ${yuan(12000)} + 水槽与厨房龙头约 ${yuan(1500)} = PKG-110 的 estimated_need_cny ${yuan(need)}`,
    });
  }

  // ── 灯具（PKG-120）：计算器科目 lighting 候选价 ──
  {
    const lighting = cat('lighting');
    if (lighting.actual !== 0 || (lighting.verifiedActual ?? 0) !== 0) {
      throw new Error('cost summary: 科目 lighting 构成已变化（出现 actual/已取证金额），请重新裁定灯具行');
    }
    const amount = Math.round(lighting.candidateActual ?? 0);
    if (amount <= 0) throw new Error('cost summary: 科目 lighting 无候选价，灯具行无来源');
    rows.push({
      id: 'cost-lighting',
      name: '基础灯具',
      packageIds: ['PKG-120'],
      amountCny: amount,
      grade: '候选价',
      tier: 'provisional',
      tierReason: '选品候选价、未取证未成交',
      // 本行只有灯具本体候选价；-02 安装人工的合同包含关系未确认，另列待核。
      coversItems: ['COST-120-01'],
      derivation: `选品候选价：config/materials.yaml 的 lighting_01 ${yuan(amount)} × 1 套（计算器科目 lighting 的 candidateActual）；QR-2026-10-03-23 的 ${yuan(qrOf(control, 'QR-2026-10-03-23').owner_target_cny)} 是询价目标、非价格，不采用`,
    });
  }

  // ── 烟灶（油烟机）不设行：控制源归家电包（PKG-160），本表范围排除家电 ──
  // 科目 range_hood 的候选价只登记在文末「防双算/范围外登记」，不计入合计
  // （2026-10-23 复核 P2：原定价行与本表范围说明自相矛盾，已移除）。

  const unpriced: CostRow[] = [
    {
      id: 'unpriced-property-fees',
      name: '物业手续与物业收费',
      packageIds: ['PKG-005'],
      amountCny: null,
      grade: '未定价',
      coversItems: ['COST-005-01', 'COST-005-02'],
      derivation: '量未建模：金额以物业收费通知与票据为准（COST-005-01/02 均为 notice_pending）；其中可退押金属临时现金占用、非最终成本，须与本表分开记账',
    },
    {
      id: 'unpriced-waterproof-material',
      name: '防水材料',
      packageIds: ['PKG-050'],
      amountCny: null,
      grade: '未定价',
      coversItems: ['COST-050-01', 'COST-050-02'],
      derivation: '量未建模：COST-050-01/02 待量房后按面积、高度、涂刷遍数报价（site_measurement_pending）；base.json 的 waterproof 无材料价、无对应选品 topic。人工已按算量费率计入定价行',
    },
    {
      id: 'unpriced-doors',
      name: '室内门及厨房门',
      packageIds: ['PKG-090'],
      amountCny: null,
      grade: '未定价',
      coversItems: ['COST-090-01', 'COST-090-02', 'COST-090-03', 'COST-090-04', 'QR-2026-10-03-11', 'QR-2026-10-03-12'],
      derivation: '量已声明：室内门 4 樘 + 卫生间门 2 樘 + 厨房联动玻璃推拉门 1 组（COST-090-01/02/03，quote_pending），门洞修正待复尺；门扇价格待询价（计算器 door_count 未接通家具清单、当前为 0，不构成价格）',
    },
    {
      id: 'unpriced-switch-panels',
      name: '开关插座面板与基础智能',
      packageIds: ['PKG-125'],
      amountCny: null,
      grade: '未定价',
      coversItems: ['COST-125-01', 'COST-125-02', 'QR-2026-10-03-22'],
      derivation: '量已算出：面板点位 17 只灯控 + 56 只插座 + 6 个网口面板（COST-125-01，quantity_pending），智能开关 11 只 + 无线 6 只 + 网关 0–1 台待选型（COST-125-02，selection_pending）；面板选品未定价。计算器 switch_socket 候选 ¥18 与 smart_home 一口价候选均为占位价、无逐项构成，不采用',
    },
    {
      id: 'unpriced-finishing',
      name: '踢脚线、收边与竣工保洁',
      packageIds: ['PKG-135'],
      amountCny: null,
      grade: '未定价',
      coversItems: ['COST-135-01', 'COST-135-02', 'COST-135-03', 'COST-135-04', 'QR-2026-10-03-13'],
      derivation: '量未算出：踢脚线长度待完成面复核（COST-135-01，quantity_pending）、收边位置清单未形成（COST-135-02，scope_schedule_pending）、验收缺陷修复待责任判定、竣工保洁按面积报价未取得（COST-135-04，quote_pending）',
    },
  ];

  // 待核清单：金额未定或归属未决的在册事项（去重 / 合同包含 / 范围对齐 / 待决策）。
  // 每条都由覆盖检查与 control.yaml 的扫描结果对齐——这里漏登任何一条在册未决
  // 条目，构建就会抛错（见 assertCoverage），不许靠人记得补。
  // 每条的 countedStatus 按注脚事实逐条裁定（复审 P2，口径见 PendingCountedStatus）：
  //  counted（4 条）——防水人工去重（¥366 已在防水人工行、待核对是否与瓦工池重叠）、
  //    封槽界面（封槽料金额已在水电卡辅材包干内、待核的只是与涂装的划界）、
  //    线控器确认（金额已按业主口述含于空调合同、待核的只是门店书面确认）、
  //    清运核重（¥1,059 已在拆改行实付锚内、待核对物业收费是否已含）；
  //  uncertain（3 条）——灯具安装人工、面板安装人工（是否已含于水电合同未
  //    定）、墙地面找平（是否含于瓦工人工预算池未明示——候选包含方是现行定
  //    价行内的瓦工池，按 uncertain 的自有定义「是否已含未定」改判，自主扫
  //    描 C1；与搬运退补区分：搬运的待决是未来施工合同的范围、无现行定价
  //    行可含，仍判 uncounted）；
  //  uncounted（9 条）——小砖条人工、燃气管道费、空调合同外增量（COST-030-02
  //    待核面）、空调可能增项、搬运退补、南阳台范围、吊顶龙骨、闭水责任、
  //    固定柜体：注脚均明示未计入任何定价行；其中含或然/待裁定/范围未定项，
  //    须确认纳入一期、实际发生且未被其他行包含后才进总额。
  const pendingChecks: PendingEntry[] = [
    {
      id: 'pending-sill-tile-labor',
      name: '窗边台小砖条等特殊铺贴人工',
      packageIds: ['PKG-060'],
      statusLabel: 'quote_pending · 待书面报价',
      countedStatus: 'uncounted',
      note: `未计入泥瓦行：低反坎约 29.84 m × ${yuan(20)}/m 名义约 ${yuan(597)}、本轮增量约 ${yuan(394)}（DEC-2026-10-07-R05/R11 登记费率锚点）；若瓦工按常规墙地砖人工一并报价则去重、不得双计，宽飘窗台面贴砖另案核价`,
      coversItems: ['COST-060-05'],
    },
    {
      id: 'pending-lighting-install-labor',
      name: '灯具安装和调试人工',
      packageIds: ['PKG-120'],
      statusLabel: 'duplication_check_required · 待确认合同包含',
      countedStatus: 'uncertain',
      note: '灯具行只有灯具本体候选价；本项待明确是否包含开孔、组装、安装和故障排查，避免与水电人工重复计取',
      coversItems: ['COST-120-02'],
    },
    {
      id: 'pending-panel-install-labor',
      name: '面板安装标识和调试人工',
      packageIds: ['PKG-125'],
      statusLabel: 'duplication_check_required · 待确认合同包含',
      countedStatus: 'uncertain',
      note: '待核对是否包含在水电合同中；面板本体在未定价清单内，本项只涉逐点安装、测试与配电箱回路标识人工',
      coversItems: ['COST-125-03'],
    },
    {
      id: 'pending-waterproof-dedup',
      name: '防水人工去重确认',
      packageIds: ['PKG-050', 'PKG-060'],
      statusLabel: 'dedup_rule 未关闭 · 待最终报价核对',
      countedStatus: 'counted',
      note: `QR-2026-10-03-03 的 dedup_rule 明文：若瓦工 ${yuan(18500)} 预算池已含防水人工，最终报价必须去重。关闭前防水人工 ${yuan(366)} 只入暂估层，且不得与泥瓦行重复主张`,
      coversItems: ['QR-2026-10-03-03'],
    },
    {
      id: 'pending-gas-piping',
      name: '燃气管道改造或移位费',
      packageIds: ['PKG-040'],
      statusLabel: 'quote_pending · 燃气公司单独结算',
      countedStatus: 'uncounted',
      note: `须由燃气公司或其授权单位施工、单独报价单独结算，不在水电报价卡范围内，未计入水电行；参考同类实付约 ${yuan(570)}，以燃气公司书面报价为准`,
      coversItems: ['COST-040-09'],
    },
    {
      id: 'pending-mep-paint-interface',
      name: '封槽料与基层修补的界面划分（水电/涂装）',
      packageIds: ['PKG-040', 'PKG-080'],
      statusLabel: 'interface_pending · 待书面划清',
      countedStatus: 'counted',
      note: 'COST-040-15（封槽料与阴阳角网格布）金额已在水电报价卡辅材包干内计一次（水电行在册），本条待核的不是金额而是界面：它属水电开槽后的收口，与 PKG-080 基层修补的边界须书面划清（control 原文），防两边都说含或两边都不含。与水电行双归属登记（DUAL_ATTRIBUTIONS 已声明）：金额在水电行、界面事项在本清单',
      coversItems: ['COST-040-15'],
    },
    {
      id: 'pending-hvac-excluded-extras',
      name: '空调合同明确不含项（风口加长/复合风管/税）',
      packageIds: ['PKG-030'],
      statusLabel: 'site_measurement_pending · 合同外增量',
      countedStatus: 'uncounted',
      note: `合同附件已核清：风口加长 ${yuan(100)}/米、复合风管、不含税均不含于 ${yuan(36000)} 合同额（DEC-2026-10-04-R1/R2）；铜管主体在签约行内，本项只登记合同外增量，金额待最终风口布置图核定`,
      coversItems: ['COST-030-02'],
    },
    {
      id: 'pending-hvac-risk-extras',
      name: '空调可能增项（运输/高空/超长管等）',
      packageIds: ['PKG-030'],
      statusLabel: 'risk_pending · 触发条件未定',
      countedStatus: 'uncounted',
      note: '可能增加费用的触发条件和单价必须在合同中写明，现未计入任何行',
      coversItems: ['COST-030-06'],
    },
    {
      id: 'pending-hvac-controller-confirmation',
      name: '空调线控器书面确认（型号/数量/对码/线芯数）',
      packageIds: ['PKG-030'],
      statusLabel: 'vendor_written_confirmation_pending · 待门店书面确认',
      countedStatus: 'counted',
      note: `金额已按业主 2026-10-12 口述含于空调行（路径 A：含在 ${yuan(36000)} 内、增量 ¥0），本条待核的不是金额而是门店书面确认四项：① 型号须 KJRF-90RT/MW（错配驱动不了双出风摆风与水泵功能）② 数量 6 只 ③ 安装对码责任与是否另收费 ④ 控制线芯数（同族 2/4/5 芯未定，封槽后不可逆）。与签约行双归属登记（DUAL_ATTRIBUTIONS 已声明）：钱在合同行、确认事项在本清单，口述不等于书面闭环`,
      coversItems: ['COST-030-07'],
    },
    {
      id: 'pending-masonry-leveling',
      name: '墙地面找平',
      packageIds: ['PKG-060'],
      statusLabel: 'site_measurement_pending · 待量房',
      countedStatus: 'uncertain',
      note: '待现场测量平整度，超厚找平的触发条件和单价另列；是否含于瓦工人工预算池未明示，未计入泥瓦行构成——因「是否已含」未定，本条计入状态按定义判「待确认是否已含」：确认含于池则不另计，未含则按实测另计',
      coversItems: ['COST-060-03'],
    },
    {
      id: 'pending-masonry-logistics',
      name: '搬运上楼和材料退补',
      packageIds: ['PKG-060'],
      statusLabel: 'contract_scope_pending · 待合同说明',
      countedStatus: 'uncounted',
      note: '电梯搬运上楼费及剩余材料处理待合同说明，未计入泥瓦行构成',
      coversItems: ['COST-060-06'],
    },
    {
      id: 'pending-south-balcony-tiling',
      name: '南阳台铺贴范围',
      packageIds: ['PKG-060'],
      statusLabel: 'alignment_required · 范围待对齐',
      countedStatus: 'uncounted',
      note: '铺贴范围待对齐；范围变化会改变泥瓦算量与 estimated_need，现状按未含处理',
      coversItems: ['COST-060-07'],
    },
    {
      id: 'pending-ceiling-keel',
      name: '吊顶龙骨材料',
      packageIds: ['PKG-070'],
      statusLabel: 'quantity_pending · 含否待确认',
      countedStatus: 'uncounted',
      note: 'QR-2026-10-03-09 的 dedup_rule 称龙骨材料（COST-070-01）未含在本项；吊顶定标目标是否含龙骨待拆项报价确认，未单独计入吊顶行构成',
      coversItems: ['COST-070-01'],
    },
    {
      id: 'pending-flood-test-liability',
      name: '闭水试验及问题重做责任',
      packageIds: ['PKG-050'],
      statusLabel: 'contract_scope_pending · 待防水合同写明',
      countedStatus: 'uncounted',
      note: '测试时长、楼下检查和不合格后的返工责任待防水合同写清；防水行现只计涂刷人工，闭水人工未单独计价',
      coversItems: ['COST-050-03'],
    },
    {
      id: 'pending-demolition-haulage-dedup',
      name: '物业垃圾清运费核重',
      packageIds: ['PKG-020', 'PKG-005'],
      statusLabel: 'duplication_check_required · 待票据核对',
      countedStatus: 'counted',
      note: `如果物业收费中已含垃圾清运费，拆改行实付锚中的 ${yuan(1059)} 不得重复支付，以物业票据和施工合同核对为准`,
      coversItems: ['COST-020-04'],
    },
    {
      id: 'pending-fixed-cabinetry',
      name: '固定柜体（衣柜/玄关柜等扩展硬装）',
      packageIds: [],
      statusLabel: 'pending_decision · 业主待决策',
      countedStatus: 'uncounted',
      note: `QR-2026-10-03-26 登记的扩展硬装询价，目标 ${yuan(18000)} 是目标非价格；是否纳入一期硬装待业主决策，未计入任何行（橱柜行只是厨房橱柜）`,
      coversItems: ['QR-2026-10-03-26'],
    },
  ];

  // 不计价登记：未决条目经裁定不进本表（业主自购 / 同范围未采用 / 合同包含），逐条带理由。
  const bathHeaterQr = qrOf(control, 'QR-2026-10-05-01');
  const excludedItems: ExcludedItem[] = [
    { item: 'COST-100-06', label: '卫生间取暖换气设备（浴霸 ×2）', reason: `业主定标自购（DEC-2026-10-05-R3），不属施工成本支出口径，未计入；与 QR-2026-10-05-01 同项，洁具行推导已显形` },
    { item: 'QR-2026-10-05-01', label: '奥普 S2-Air 浴霸询价登记', reason: `与 COST-100-06 同项：业主自购待决策，当前观察价 ${yuan(bathHeaterQr.owner_current_cny)}（非成交价），未计入` },
    { item: 'QR-2026-10-03-02', label: '水电改造打包询价', reason: '同范围未采用：本表水电以生效报价卡实算为准；本轮回价后须与卡对账去重，不得叠加' },
    { item: 'QR-2026-10-03-10', label: '墙顶面涂装询价', reason: `同范围未采用：涂装行以科目算量费率 + 候选价计价；本轮目标 ${yuan(11000)} 非价格` },
    { item: 'QR-2026-10-03-23', label: '基础灯具询价', reason: `目标 ${yuan(3000)} 非价格，未采用：灯具行以选品候选价计价（推导已注明）` },
    { item: 'QR-2026-10-03-25', label: '成品保护/垃圾清运/零星修补询价', reason: 'PKG-010 拟包含在施工合同中（contract_inclusion_pending），目标为待拆分候选、非价格，见「不单独计价」' },
  ];

  const excluded: ExcludedFigure[] = [
    { label: '科目 masonry（人工 + 地砖/墙砖候选）', amountCny: categoryTotal('masonry'), reason: '与泥瓦行同范围：包口径 estimated_need 为业主轮次口径，优先' },
    { label: '科目 water_electric（人工一口价 + 候选）', amountCny: categoryTotal('water_electric'), reason: '与水电行同范围：报价卡实算优先；且其候选混有热水器（属家电包）与开关插座占位价' },
    { label: '科目 kitchen_cabinet（柜体 + 台面候选）', amountCny: categoryTotal('kitchen_cabinet'), reason: '与橱柜行同范围：包口径 estimated_need 优先' },
    { label: '科目 sanitary（洁具安装人工）', amountCny: categoryTotal('sanitary'), reason: '只是安装人工（200 元/件 × 点位数），洁具本体在洁具行内' },
    { label: '科目 carpentry（吊顶板面人工）', amountCny: categoryTotal('carpentry'), reason: '与吊顶行同范围：只是板面人工，吊顶行是定标全包目标' },
    { label: '科目 miscellaneous（通用五金候选）', amountCny: categoryTotal('miscellaneous'), reason: 'hardware_01 候选与洁具行构成里的通用五金同范围' },
    { label: '科目 smart_home（一口价候选）', amountCny: categoryTotal('smart_home'), reason: '占位选品、无逐项构成；PKG-125 组件口径为未定价，不足以据此定价' },
    { label: '科目 hvac（选品镜像）', amountCny: categoryTotal('hvac'), reason: '与空调合同同额：来源以 control.yaml 的 contracted_cny 为准，科目侧只是镜像' },
    { label: '科目 range_hood（油烟机候选价）', amountCny: categoryTotal('range_hood'), reason: '范围外：油烟机在控制源归家电包（PKG-160），本表口径说明明确排除家电；其候选价在家电口径另行处理，不计入硬装合计' },
  ];

  // 待核分类完整性：每条待核条目必须已裁定计入状态（countedStatus），缺失即抛错
  // （复审 P2：总述与清单按此分类表述，分类缺位会让读者无从判断该不该往总额加）。
  assertPendingClassifications(pendingChecks);
  // 层级完整性：每条定价行必须已在登记处裁定 tier 与理由，缺失即抛错（不许渲染层猜）；
  // 声称已核实的行还要过层级守卫——凭 verifiedBasis 断言来源此刻仍是锁定状态，
  // 来源状态变未决（生效卡换成 baseline、合同凭据缺失）时生成失败，不许静默沿用旧层级。
  for (const row of rows) {
    if (!row.tier || !row.tierReason) {
      throw new Error(`cost summary: 定价行 ${row.id} 缺核实层级裁定（tier/tierReason）——请先在 cost-summary.ts 登记处裁定，再重新生成`);
    }
    if (row.tier === 'verified') assertVerifiedTierBasis(row.id, row.verifiedBasis, control);
  }
  const coverage = assertCoverage(control, rows, unpriced, pendingChecks, excludedItems);
  const verifiedSubtotalCny = rows.filter((row) => row.tier === 'verified').reduce((sum, row) => sum + (row.amountCny ?? 0), 0);
  const provisionalSubtotalCny = rows.filter((row) => row.tier === 'provisional').reduce((sum, row) => sum + (row.amountCny ?? 0), 0);
  const knownSubtotalCny = verifiedSubtotalCny + provisionalSubtotalCny;
  return {
    rows,
    unpriced,
    pendingChecks,
    excludedItems,
    coverage,
    notSeparate: [
      { name: '施工现场保护与施工位置标记', packageIds: ['PKG-010'], note: 'funding_status 为 contract_inclusion_pending：拟包含在施工合同中，未落实为合同条款前不计价（QR-2026-10-03-25 的目标为待拆分候选、非价格）' },
      { name: '中央空调第二次安装与调试', packageIds: ['PKG-140'], note: '含在中央空调行（PKG-030 合同，included_in_other_package），不另计' },
      { name: '基础硬装后的临时入住放行', packageIds: ['PKG-142'], note: '流程放行包，无独立成本' },
      { name: '竣工联合验收、整改与资料移交', packageIds: ['PKG-170'], note: '验收流程包，无独立成本' },
      { name: '硬装预备金', packageIds: ['PKG-900'], note: '预算储备，不是成本，按本表口径不列' },
    ],
    excluded,
    verifiedSubtotalCny,
    provisionalSubtotalCny,
    knownSubtotalCny,
  };
}

export function renderCostSummary(data: CostSummaryData, headerText: string): string {
  const escapeCell = (value: unknown) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', '<br>');
  let markdown = headerText;
  markdown += '本表是**成本**总表，不是预算表：每一行都是按当前数据实际算出或已有来源的价格，并标注成色与推导；没有真实价格的项目只登记为「未定价」、金额或归属未决的登记为「待核」——未定价与待核条目本身都不填金额；但待核中标注「已计入」的，所涉金额已含在定价行里（不重复计，计入状态见下「未定价与待核」），其余待核与未定价一样不计入合计。\n\n';
  markdown += '## 口径说明\n\n';
  markdown += '- **范围**：一期硬装，**含中央空调**（hvac 池并入本表，不单列）。家具、家电、窗帘、设计准备等其他预算池不在本表。\n';
  markdown += '- **无预算数**：本表任何一行都不取 planned_cny / 批准额；预算口径见 [一期预算控制表](budget.md)。\n';
  markdown += '- **小计分三层**：**已核实小计** = 金额已锁定且无未决去重/待报价标记的行——合同行须有 contracted_cny 与询价轮次 contract_ref（轮次 status 须 locked），且生成器按 contract_ref 回决策记录核对原文在总价关键词辖域内（「定标成交：36,000 元」式、由总价/合同额/定标成交等关键词直接辖制的金额）载有成交金额与成交事实——分项金额与编号/型号/台数等杂数字不算；报价卡行须生效卡 status 为锁定类（contracted）且全行计价、无待报价行，生成器另回原卡核对承包商名、报价日期与书面报价证据（evidence.kind 须为 written_quote，费率不得取自公开参考价）；**暂估小计** = 其余未锁价等级的行（封顶价、预算池、候选价、定标目标、参考实付、定额暂估、业主基线卡实算，以及带未关闭去重规则的实算行）；**已知合计** = 两者之和，只是已定价行的总和，**不得读作已核实成本**。层级不是静态标签：生成器逐行凭来源凭据断言（合同额/决策原文/原卡凭据在构建时读取核对），来源状态变未决即生成失败；每行的层级与理由登记在生成器中，逐行可查。\n';
  const pendingCountedN = data.pendingChecks.filter((entry) => entry.countedStatus === 'counted').length;
  const pendingUncountedN = data.pendingChecks.filter((entry) => entry.countedStatus === 'uncounted').length;
  const pendingUncertainN = data.pendingChecks.filter((entry) => entry.countedStatus === 'uncertain').length;
  // 未定价概述不得把可退押金笼统称作必花项（复审四轮）：未定价条目中承接
  // COST-005-02（可退装修押金）的条数由登记生成，在概述里单列说明——押金
  // 是临时现金占用、不是最终成本（control.yaml 该组件名本身即此口径）。
  const depositBearingUnpricedN = data.unpriced.filter((row) => (row.coversItems ?? []).includes('COST-005-02')).length;
  const depositNote = depositBearingUnpricedN > 0
    ? `，但其中 ${depositBearingUnpricedN} 项（物业手续与物业收费）内含可退装修押金（COST-005-02）——押金是临时现金占用、验收后退回，不是最终成本，该项不得整体读作必花支出`
    : '';
  markdown += `- 未定价与待核对总额的影响必须按**计入状态**分别看（下列条数由清单登记生成）：**未计入**的（未定价 ${data.unpriced.length} 项 + 待核未计入 ${pendingUncountedN} 项）尚未计入合计：未定价的以必花项为主、取得价格后计入${depositNote}；待核未计入的含或然项（触发条件成立才发生，如空调可能增项）、待业主裁定项（如固定柜体是否纳入一期）与范围未定项（如南阳台铺贴范围可能缩小），只有在**确认纳入一期、实际发生、且未被其他定价行包含**后才计入并增加总额，未触发、裁定不纳入或范围缩减的则不计；**已计入**的（待核 ${pendingCountedN} 项）金额已经在定价行里，只是界面划分、书面确认或去重核对尚未关闭——**不得再把它们作为新费用往总额上加一遍**；事项关闭时以核对结果对已计金额做修正（去重坐实则扣回、确认未含则补计），已计金额可增可减；**待确认是否已含**的（待核 ${pendingUncertainN} 项）以确认结果为准，确认前不预断增减。同时，已知合计含未锁定的暂估金额（结算时可能调减），个别款项还是可退押金性质（如物业可退装修押金，只是临时现金占用、不是最终成本）——真实总成本以正式报价与结算为准，不必然高于、也不必然低于已知合计。\n`;
  markdown += '- **覆盖检查**：生成时全量扫描 `schedule/phase-1/control.yaml` 的成本组件与询价轮次登记，凡状态未决或去重未关闭的条目必须登记归属（计入定价行 / 未定价与待核 / 不计价登记），缺一即生成失败——未定价与待核清单不是手写名单。同一条目同时属两个分类（双归属）必须在生成器中显式声明并附理由，未声明的多重归属、出现在三个及以上分类、或被两条定价行重复计入，同样使生成失败。\n';
  markdown += '- **成色定义**：已签约 = 已转合同的成交价；报价卡实算 = 算量引擎实算量 × 生效报价卡单价；报价轮实算 = 业主询价轮次逐项构成的实算目标；定标目标 = 业主定标时裁定的目标价、非成交价；参考实付 = 同户型已发生的实付锚、非本户报价；算量费率 = 算量面积 × 静态费率（人工）；候选价 = 当前选品的候选价、未取证未成交；定额暂估 = 按定额登记的暂估额、非算量非报价。\n';
  markdown += '- **数据源**：`schedule/phase-1/control.yaml`（合同额、estimated_need、询价轮次）、`server/budget-calculator.ts` 科目快照（量 × 选品价）、`shared/mep-takeoff.ts` 算量 × `config/mep-quotes.yaml` 生效报价卡。映射裁定与防双算理由固化在 `scripts/schedule/cost-summary.ts` 文件头。\n\n';
  markdown += '## 硬装成本（含中央空调）\n\n';
  markdown += '| 项目 | 归属工作包 | 成本 | 成色 | 推导 |\n|---|---|---:|---|---|\n';
  for (const row of data.rows) {
    markdown += `| ${escapeCell(row.name)} | ${row.packageIds.join('、') || '—'} | ${row.amountCny == null ? '—' : yuan(row.amountCny)} | ${escapeCell(row.grade)} | ${escapeCell(row.derivation)} |\n`;
  }
  markdown += `| **已核实小计** | | **${yuan(data.verifiedSubtotalCny)}** | | 金额已锁定且无未决去重/待报价标记的行之和（已核实口径见上「小计分三层」） |\n`;
  markdown += `| **暂估小计** | | **${yuan(data.provisionalSubtotalCny)}** | | 未锁价等级的行之和（封顶/预算池/候选/目标/参考/暂估/待去重） |\n`;
  markdown += `| **已知合计（不含未定价）** | | **${yuan(data.knownSubtotalCny)}** | | 已核实 + 暂估，共 ${data.rows.length} 行；未定价 ${data.unpriced.length} 项不在内；待核 ${data.pendingChecks.length} 项不在本表逐行列示，其中已计入 ${pendingCountedN} 项的金额已含于定价行，本行不是已核实成本 |\n`;
  markdown += '\n## 未定价与待核（计入状态逐条标注）\n\n';
  markdown += '「未定价」= 尚无真实价格（以必花项为主；物业手续与物业收费一条内含可退装修押金，属临时现金占用、非最终成本，见该条推导）；「待核」= 金额或归属未决（去重未关闭、合同包含未确认、范围未对齐、待决策）。待核条目逐条标注**计入状态**：「已计入 · 待确认」= 金额已在定价行内、不得作为新费用再加，事项关闭时按核对结果修正已计金额（可增可减）；「未计入 · 待定价」= 金额不在合计内，确认纳入一期、实际发生且未被其他定价行包含后才计入并增加总额（或然项未触发、裁定不纳入、范围缩减的则不计）；「待确认是否已含」= 是否已含于合同未定、以确认为准。本清单由覆盖检查对着 control.yaml 全量扫描生成，漏登在册未决条目时本表生成失败（见文末覆盖登记）。\n\n';
  markdown += '| 项目 | 归属工作包 | 成本 | 状态与现状 |\n|---|---|---|---|\n';
  for (const row of data.unpriced) {
    markdown += `| ${escapeCell(row.name)} | ${row.packageIds.join('、') || '—'} | 未定价 | ${escapeCell(row.derivation)} |\n`;
  }
  for (const entry of data.pendingChecks) {
    markdown += `| ${escapeCell(entry.name)} | ${entry.packageIds.join('、') || '—'} | 待核 | ${PENDING_COUNTED_STATUS_LABELS[entry.countedStatus]}｜${escapeCell(entry.statusLabel)}：${escapeCell(entry.note)} |\n`;
  }
  markdown += '\n## 不单独计价\n\n';
  for (const item of data.notSeparate) {
    markdown += `- **${escapeCell(item.name)}**（${item.packageIds.join('、')}）：${escapeCell(item.note)}。\n`;
  }
  markdown += '\n## 防双算与范围外登记（科目侧数字，未采用）\n\n';
  markdown += '计算器科目视图与本表是同一所房子的两套切分：下列科目数字与上表行同范围、或属本表范围外，一律不计入合计，只登记备查。\n\n';
  markdown += '| 科目侧数字 | 金额 | 不采用理由 |\n|---|---:|---|\n';
  for (const figure of data.excluded) {
    markdown += `| ${escapeCell(figure.label)} | ${yuan(figure.amountCny)} | ${escapeCell(figure.reason)} |\n`;
  }
  markdown += '\n## 不计价登记（未决条目的排除归属）\n\n';
  markdown += '下列在册未决条目经裁定不进本表金额，逐条带理由；与「未定价与待核」的区别是：它们已有明确处置（自购/未采用/合同包含），不是悬而未决。\n\n';
  markdown += '| 条目 | 内容 | 不计价理由 |\n|---|---|---|\n';
  for (const item of data.excludedItems) {
    markdown += `| ${escapeCell(item.item)} | ${escapeCell(item.label)} | ${escapeCell(item.reason)} |\n`;
  }
  markdown += `\n覆盖扫描：control.yaml 共 ${data.coverage.scannedComponentCount} 个成本组件、${data.coverage.scannedQuoteRoundCount} 条询价轮次登记；其中未决条目 ${data.coverage.unresolvedItemCount} 个已全部登记归属（计入定价行 ${data.coverage.countedItemCount} / 未定价与待核 ${data.coverage.pendingItemCount} / 不计价登记 ${data.coverage.excludedItemCount}）；其中双归属条目 ${data.coverage.dualAttributedItemCount} 个（${data.coverage.dualAttributedItemIds.join('、')}）同时登记在两个分类、在两类各计一次，故三类计数之和 = 未决总数 + 双归属数；范围外工作包（PKG-000 设计准备、PKG-145 窗帘、PKG-150 家具、PKG-160 家电）的 ${data.coverage.outOfScopeComponentCount} 个组件不属本表硬装范围，按包排除。（本段计数按条目计；上「未定价与待核」清单按归并条目行列示，共 ${data.unpriced.length + data.pendingChecks.length} 行——行数与条目数不相等是计数口径不同，不是漏登。）\n`;
  return markdown;
}
