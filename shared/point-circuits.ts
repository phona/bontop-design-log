/**
 * 点位 → 回路 归属的单一派生（issue #98 第四阶段 S3，设计文档 §4.5/§4.8-S3）。
 *
 * 拓扑成员关系曾经有两处声明 + 一层间接：
 *   ① electrical-topology.yaml 的 `member_point_ids`（回路侧，权威）；
 *   ② 13 个电气点位自己的 `circuit` 字段（点位侧，且词汇是另一套：点位写 dining，
 *      回路叫 lighting_dining）；
 *   ③ `source_circuit_id` 间接层把两套词汇对上。
 * `shared/electrical-lint.ts` 的 `circuit_fact_mismatch` 是 ①② 两份手写声明之间的交叉
 * 校验，`shared/mep-takeoff.ts` 还把 ② 当第三条回落通道。两处各写一遍，就必须有一个
 * 校验盯着它们别漂——这正是双写的维护税。
 *
 * S3 起 ② 退役：**成员关系只住回路侧**（`member_point_ids`），点位侧不再声明回路。
 * 本函数是「点位 → 回路」的唯一解算，lint（covered / point_uncovered）、算量
 * （mep-takeoff 通道①②）、DXF 标注、派生文档全部调它，不各写一遍。
 *
 * 两条通道（与原 mep-takeoff 逐字同语义，只是搬到一处）：
 *   ① `member_point_ids` → 点位所属回路；
 *   ② controls 的 `switch_point_ids → target_point_ids`：双控/三控的开关本身不是回路
 *      成员（开关不是 powerable load），其回路归属从受控灯具反推。controls 保持独立
 *      （双控/三控是真实管理对象），但**反推逻辑只住本文件**。
 *
 * 交叉校验的接续（§6.1-4 停止条件的答复）：点位侧声明删除后，「两份声明互相漂移」这类
 * 错误按构造不可能再发生；检测能力由三处接住——① 成员完整性检查（悬空/重复/类型不符，
 * 仍在 electrical-lint，error 级）；② `point_uncovered` 去掉「点位上声明了 circuit 就
 * 不报」的抑制，任何不进回路的 powerable 点位都显形；③ 本函数对「受控灯具不在任何
 * 回路上」给出 diagnostic（否则开关的回路归属会静默落空——那正是旧 point.circuit 在
 * 控制目标点上意外承担的那半份校验）。另外 tests/server/electrical-lint.test.ts 把
 * 13 个退役点位的成员关系钉成显式断言，与旧 circuit_fact_mismatch 在同一道 CI 门禁上
 * 以 error 显形。
 */

/** 回路成员声明的最小视图（ElectricalTopologyCircuit 的定位相关子集）。 */
export interface CircuitMemberLike {
  id: string;
  member_point_ids?: string[];
}

/** 控制组的最小视图（ElectricalTopologyControl 的定位相关子集）。 */
export interface ControlLike {
  id?: string;
  switch_point_ids?: string[];
  target_point_ids?: string[];
}

/** 拓扑的最小视图：只取成员与控制两段，避免与 topology schema 强耦合。 */
export interface PointCircuitTopologyLike {
  circuits: readonly CircuitMemberLike[];
  controls?: readonly ControlLike[];
}

export interface PointCircuitDerivation {
  /** 通道①：`member_point_ids` → 点位所属回路（lint 的 covered 口径：开关不是成员）。 */
  memberCircuits: ReadonlyMap<string, string>;
  /** 通道① + 通道②：另含从 controls 反推出的开关 → 回路（算量/DXF 标注用）。 */
  pointCircuits: ReadonlyMap<string, string>;
  /** 反推 diagnostics：受控灯具不在任何回路成员里时，开关回路归属无从派生（交 lint 显形）。 */
  diagnostics: string[];
}

export function derivePointCircuits(topology: PointCircuitTopologyLike): PointCircuitDerivation {
  // ① 回路成员（重复成员时首个回路胜出，与历史口径一致；重复本身由 lint 的
  //   duplicate_member error 拦截，不在这里静默择优）。
  const memberCircuits = new Map<string, string>();
  for (const circuit of topology.circuits) {
    for (const member of circuit.member_point_ids ?? []) {
      if (!memberCircuits.has(member)) memberCircuits.set(member, circuit.id);
    }
  }
  // ② controls 反推：开关的回路 = 其受控灯具的回路（取首个可解析目标，历史口径）。
  const pointCircuits = new Map(memberCircuits);
  const diagnostics: string[] = [];
  for (const control of topology.controls ?? []) {
    const declaredTargets = control.target_point_ids ?? [];
    const targets = declaredTargets.map((id) => memberCircuits.get(id)).filter((value): value is string => value !== undefined);
    if (declaredTargets.length > 0 && targets.length === 0) {
      // 交叉校验（接续退役的 point.circuit）：受控灯具不在任何回路上时，开关的回路归属
      // 无从派生——旧口径里这类目标若写着 circuit 字段就会被 circuit_fact_mismatch 拦下。
      diagnostics.push(
        `控制组 ${control.id ?? '(无 id)'}: 受控点位 ${declaredTargets.join(', ')} 不在任何回路成员里，开关 ${(control.switch_point_ids ?? []).join(', ')} 的回路归属无法派生（把受控灯具加进 member_point_ids，或修正 target_point_ids）`,
      );
    }
    for (const switchId of control.switch_point_ids ?? []) {
      if (targets.length > 0 && !pointCircuits.has(switchId)) pointCircuits.set(switchId, targets[0]);
    }
  }
  return { memberCircuits, pointCircuits, diagnostics };
}
