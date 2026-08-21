// 卧室房间 id，镜像 config/design-rules.yaml 的 bedroom_floor applyRooms。
// 若卧室划分变更，须同步此处与 design-rules。
// 独立零依赖模块：HouseScene 等渲染层引用它时不会连带加载 designData
// （designData 模块加载即生成程序化贴图，jsdom 测试环境无 canvas 2d 会崩）。
export const BEDROOM_ROOM_IDS = ['master_bedroom', 'study', 'bedroom_nw', 'bedroom_se'];
