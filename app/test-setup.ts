// vitest 全局环境 shim（issue #69，2026-11-04）：jsdom 不提供 ResizeObserver，而
// HouseScene 构造时会 new ResizeObserver 观察画布尺寸（app/src/render/HouseScene.ts:329）。
// 缺这个 shim，app/src/scene/HouseScene.test.ts 全部 45 条用例抛在构造期。
//
// 该 shim 2026-11-02 以文件级形式挂在 HouseScene.test.ts 里，只护住那一个文件；
// 现挪到 vitest setupFiles 与具体测试文件解绑。**它是承重墙**：删它 = 45 条用例
// 回到基线外新失败（存量红 3 条见 ci/baseline/test-app-failures.txt，与此无关）。
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// 写操作 token 认证（issue #64）：app/src/api-write.ts 的写 fetch 一律带
// x-bontop-token，本地无 token 时会弹页面内嵌输入框。给测试预置一个 token，
// 让既有写路径用例（StateSync / ScheduleDetailPanel / CeilingQuotePanel 等）
// 直接走 fetch mock、不弹框。api-write.test.ts 自行清理 localStorage，
// 覆盖「无 token → 弹框输入 → 自动重发」与「401 → 清栈重输」流程。
try {
  localStorage.setItem('bontop.write-token', 'test-write-token');
} catch {
  // 无 localStorage 的环境（node environment）下写路径用例本就跑不到
}
