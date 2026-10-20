# 客厅主灯现状归档（试灯前冻结）

## 目的

业主反馈当前客厅主灯造型“有点丑”，准备尝试其他灯具。本归档先保存当前 `light_living_dome` 十头乳白球泡半吸顶模型，供新候选对照或恢复；本轮没有改动活动配置、几何或渲染代码。

## 已归档内容

- `source/config/render/lighting.yaml`：当前整份灯具外观配置，包含 `light_living_dome` 的现状参数。
- `source/shared/render/MultiGlobeChandelierGeometry.ts`：十头灯具几何构造器。
- `source/shared/render/LightingFixtureBuilder.ts`、`source/app/src/render/InteriorLightingSystem.ts`：GLB/浏览器中的灯具接入与照明实现。
- `source/shared/types.ts`、`source/shared/project-render-facts-schema.ts`、`source/data/project-render-facts.json`：配置类型、校验结构和当前投影快照。
- `evidence/user-context.png`：本轮业主提供的客厅效果图。
- `evidence/r11-front.png`、`evidence/r11-underside.png`：工作区中留存的 R11 前视和仰视截图，作为历史对照图。
- `SHA256SUMS`：归档文件校验值。

## 验证边界

本轮 `npm run gate:visual` 因 `tsx` 在沙箱中创建临时 IPC 管道时遇到 `EPERM` 未能启动；改用 `node --import tsx` 后，门禁报告本地渲染服务不可达。为避免启动服务时触发项目已记录的 `presentation-state.json` 持久化副作用，本轮没有启动 dev server。

因此，这里保留的是当前工作区的源文件快照和已有截图；没有声称新截取的画面与源文件经过同版运行时核对。另，旧迭代目录 `archive/living-multi-globe-main-light-20261016/evidence/r5/context.runtime.json` 实际记录的是 R7 参数（例如吊杆 120mm、上层半径 0.22m），不能作为当前 R11 的运行时证据。

## 恢复提示

试灯时只切换 `light_living_dome` 的活动配置。若要恢复本版本，先对照归档里的完整配置，再恢复该灯具条目及所需几何分支；不要盲目覆盖之后可能更新的整份投影数据或其他灯具配置。恢复后应重新生成 render facts，并通过 `gate:visual` 确认当前客户端版本。
