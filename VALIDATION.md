> 最新结构清理：[2026-10-04五轮行为保持清理](validation/CODE_CLEANUP_2026-10-04.md) — 五轮完成，578测试及固定669球/223接球完整门禁通过；分别报告生产/QA/测试与文档成本。

> 最新A2基础：[2026-10-04加载/图形恢复/测量与发布验收](validation/FOUNDATION_A2_2026-10-04.md) — 578测试和固定669球/223接球完整门禁通过，明确CPU成本、历史失败/传输中断及浏览器限制；父级最终独立578测试与构建也已通过并记录日志hash。

> 最新A1基础施工：[2026-10-03输入/存档/候选工具验收](validation/FOUNDATION_A1_2026-10-03.md) — 502项测试，统一校准、手势坐标生命周期、真实保存反馈与受限安全候选工作流；正式物理/模型未改。

> Latest ten model/motion rounds: [2026-10-03 ledger](validation/MODEL_MOTION_TEN_ROUNDS_2026-10-03.md) — 394 tests, uniform 669-shot / 223-catch acceptance, bounded thumb cup, cancelled-dive recovery and inspector metadata repairs, with measured CPU and retained visual limits.

> Latest grip and recovery refinement: [2026-10-02 validation](validation/GRIP_RECOVERY_2026-10-02.md) — 379 tests, unchanged 645-shot / 205-catch acceptance, cupped fingers, coupled wrist refinement, staged boot support, and measured CPU/upload tradeoffs.

> Latest ten additional rounds: [2026-10-02 ten-round audit](validation/TEN_ROUNDS_2026-10-02.md) — 369 tests, 645 shots / 205 catches, corrected frame-contact ordering and endpoint entry, exact-output reduction of handling-quality work, and explicit CPU/visual limits.

> Latest five-round validation: [2026-10-02 sequential audit](validation/FIVE_ROUNDS_2026-10-02.md) — 332 tests, uniform 525-shot/184-catch acceptance, rebound contact and interrupted mobile-input repairs, with measured CPU tradeoffs.

> Latest next-round camera pass: [2026-10-02 round handover](validation/ROUND_HANDOVER_2026-10-02.md) — 282 tests, immediate stable role cuts, interruption-safe resets and bounded static portrait framing across all four ready styles.

> Latest match recovery: [2026-10-02 central result validation](validation/MATCH_RECOVERY_2026-10-02.md) — 263 tests, exact first-result handover, supported central get-up, 40 held paths plus 51 central catch/miss paths, and measured CPU/load tradeoffs.

> Latest production motion/limb refinement: [2026-10-02 validation](validation/PRODUCTION_MOTION_2026-10-02.md) — 251 tests, combined 40-capture/1,400-pose gates, gradual captured finishes and measured gather CPU reuse.

> Latest body/garment and supported keeper pass: [2026-10-01 body and motion validation](validation/BODY_MOTION_2026-10-01.md) — 240 tests, 40-capture full-skin/continuity gate, exact budget and CPU/loading tradeoffs.

> Latest conservative clarity pass: [2026-10-01 image clarity](validation/IMAGE_CLARITY_2026-10-01.md) — 222 tests, unchanged DPR budget, bounded pitch filtering and physical-width paint.

> Latest low-cost presentation pass: [2026-10-01 validation](validation/LOW_COST_FIDELITY_2026-10-01.md) — 218 tests, source-normal net feedback, softer ball grounding, unchanged geometry and reduced structural draw candidates.

> 最新触控、双捕获与细化模型验收见 [本轮记录](validation/REFINEMENT_2026-10-01.md)。下方保留旧冻结版本的历史证据，不代表最新版的全部结果。

# 人物、动作与接触验收

日期：2026-10-01（UTC）  
分支：`feature/character-motion-refinement`  
运行时代码冻结：`29cde8257c15361b69962da932143148a3c79f3f`  
对比基线：`5fa6c72cab4a9c718822ac2915a1a3c9ac692f03`

本记录只使用上述冻结代码的结果；此前候选中出现的肩袖薄片、前臂穿胸、双小腿交叉及旧脚尖代理误差，不当作最终通过依据。后续提交仅补充这份说明和只读复现工具。未推送、部署或合并。

## 运行

```sh
npm ci
npm test
npm run build
npm run dev
```

正式游戏：`http://localhost:5173/`  
唯一动作检查入口：`http://localhost:5173/motion-lab.html`

受限 Linux 环境可使用 `npm ci --cache /tmp/penalty-npm-cache` 和 `npm run dev -- --host 127.0.0.1`，无需修改系统安全策略。

## 改动范围

- 同一个 `GameCharacter` 负责比赛与动作检查页；模型加载缓存、克隆隔离、失败备用人物、重复拖帧和注视恢复均有回归
- 肩肘按焊接拓扑平滑权重，不把材质缝拆开；两个肩部辅助骨保留抬臂体积，总计仍为 24 骨、每顶点最多四权重。未替换原 GLB 或冒充全新建模
- 跨体手臂绕过胸前，落地计入实际手套/肩袖厚度；起身先收下侧支撑脚，再让上侧脚越过落地，保留原起跳轨迹和固定骨长
- 手套接触使用真实三角面；肩袖和肘部混合蒙皮区使用同一骨架计算动态接触片，其余部位使用由当前网格生成的表面包络。保持擦边、近失、反弹入网和属性差异
- 收球使用一个无历史状态的双手/球联合路径，球落在掌心而不是腕口；主游戏、检查页和离屏导出调用相同函数
- 射手仍使用原有 CMU 动捕。真实鞋面接触时刻为 1.8467 秒，原素材标注约为 1.85 秒；低平/勺子/力度随摆和片段末尾收脚是程序修饰，不是新增动捕
- 动作检查页提供四方向、分屏、缩放、骨架/线框、关键帧、60 Hz 步进、变速和循环；短横屏、窄竖屏有对应布局

原素材许可与署名保留在 `public/character-credits.txt` 和资产目录。

## 冻结代码验证

### 自动测试与构建

- `npm test`：158 项通过，0 失败、0 跳过
- `npm run build`：成功，输出正式游戏及 motion-lab
- 构建警告保留：共享 rendering chunk 约 1.133 MB，gzip 约 306.7 KB，超过 Vite 的 500 KB 提示阈值。没有关闭警告，也不据此声称手机性能已通过
- 新回归包括真实表面接触、历史肩袖/腿部交叉三角对、蒙皮净空、连续性、骨长、模型克隆、射手落步、备用显示和检查页模拟 DOM
- 原来按虚拟脚尖判触球的两项检查改为更严格的真实鞋面 2 mm 门槛。没有放宽原膝盖/手腕连续性、骨数或接地门槛

### 实际蒙皮与碰撞矩阵

审计使用 Three.js 对生产 GLB 求出的真实变形三角面，不只是关节中心。离屏射手导出调用 `updateMatrixWorld`，与渲染器一样更新 attached bind inverse，避免根变换重复应用。

- 左右 × 低/中/高，300 个姿态，涵盖起扑密集帧、每种球高的实际落地窗口和完整恢复。新增非邻接交叉：前臂↔躯干、小腿↔躯干、肩袖↔躯干、肘内侧、左右脚/小腿，五类均为 0
- 另补 51 个中路姿态和 112 个真实收球姿态。没有前臂/小腿贯胸或左右腿交叉；局部肩袖衣料仍有最多约 3.9 mm 的有限三角分离量，单个肘内侧约 1.6 mm。对应画面未见黑缝、薄片或明显穿入，作为局部衣料接触记录，不声称是完整布料/软组织模拟
- 排除共享顶点/一环拓扑、切触和原资产已有静态交叉；这不是对任意连续时间和所有衣料接缝的数学零自交保证
- 28 组全周期地面检查，含左右/中路低中高、能力/伸展极值、热身和持球姿态，60 Hz 真实蒙皮；最低点约 -1.924 mm，草坪平面为 -14 mm，未穿入草坪
- 135 场固定种子射门全部结束，58 次人体接触。首次接触的球表面到真实蒙皮误差约 -0.008 至 +0.034 mm；反弹物理步末约 -2.91 至 +5.03 mm，后者包含接触后的剩余步长运动
- 36 次矩阵内接稳，加四个左右高低回归，共 40 条 2.8 秒接稳/落地/起身路径。球/手以 240 Hz、完整蒙皮以 60 Hz 检查；双掌贴合误差和最大身体重叠均小于 0.001 mm，捕获起点位移为 0
- 收球测试检查起止位置、有限差分一阶速度和掌面相对滑移。最快错误预判中球路径单帧移动约 4.41 cm/240 Hz；细化到 1/96000 秒后约 0.110 mm，没有保持有限幅度的跳变。该项是连续高速运动，不伪装成低速或仅凭单帧阈值判断
- 27 种射门方向/力度/类型：真实鞋面触球误差约 0.051 mm；支撑脚漂移约 0.53 mm；全蒙皮最低点约 -0.629 mm

### 覆盖与 CPU 成本

使用相同动作与 135 个固定种子配方，对比旧胶囊接触实现和新表面实现；三次预热后重复，报告中位数，极大值取全部三次的最大。模型覆盖没有通过扩大碰撞体来提升。

| 指标 | 旧胶囊 | 当前表面 |
| --- | ---: | ---: |
| 接触 / 扑出 / 接稳 | 58 / 56 / 33 | 58 / 52 / 36 |
| 进球 / 扑后入网 | 79 / 2 | 83 / 6 |
| 135 场总 CPU 时间 | 288.1 ms | 590.6 ms |
| 近门物理步 P95 / P99 | 0.029 / 0.115 ms | 0.597 / 1.025 ms |
| 近门步最大值 | 2.908 ms | 2.833 ms |
| AI 准备 P95 / 最大值 | 1.285 / 2.965 ms | 1.637 / 2.956 ms |

新表面接触有实际 CPU 代价；本机近门 P99 约 1.02 ms，但不能把云端 CPU 的余量当作手机 120 Hz 保证。

这些数据只代表此云端 Node CPU；没有代替实际浏览器渲染、手机 GPU、热量或电量验收。

### 离屏序列

采用冻结代码的实际蒙皮顶点，在 Blender 中使用简化材质渲染；不是生成概念图，也不是浏览器截图。

- 左右低、中、高：六条 3.5 秒序列
- 左右低、高真实接稳：四条 2.8 秒序列，包含真实球
- 普通、低平、勺子射门：三条 3.5 秒序列，并另导出精确触球关键帧
- 每条序列 12 fps、正/侧/背三视角；源文件、GLB、导出与渲染工具 SHA-256、动作参数、种子、捕获点都记录在 `poses.json`
- 画面审查着重看肩袖体积、腋下轮廓、手臂/胸、膝脚分离、着力顺序和球手跟随。低采样噪声与简化材质不作为正式美术效果

## 可复现补充审计

```sh
node tools/qa/audit-character.mjs matrix --out /tmp/penalty-audit
node tools/qa/audit-character.mjs hold --out /tmp/penalty-audit
node tools/qa/audit-character.mjs ground --out /tmp/penalty-audit
node tools/qa/audit-character.mjs performance --out /tmp/penalty-audit
# 在附带 Git 历史的克隆中比较旧/新接触实现：
node tools/qa/benchmark-contact.mjs /tmp/penalty-audit

ARTIFACT_DIR=/tmp/penalty-audit LANDING_SAMPLES=1 \
TIMES=.18,.19,.20,.21,.22,.23,.24,.25,.26,.27,.28,.29,.30,.45,.6,1,1.1,1.2,1.3,1.4,1.45,1.5,1.55,1.6,1.65,1.67,1.7,1.75,1.8,1.85,1.9,1.95,2,2.05,2.1,2.15,2.2,2.25,2.3,2.6,3,3.5 \
node tools/qa/audit-self-intersections.mjs
```

可再设置 `DIRECTIONS=0` 扫中路；`MOTION=gather` 扫真实左右高低及中路收球。

自交脚本在有交叉时输出实际 face/vertex 索引、有限三角 SAT 分离量和交线；无限平面的 straddle 值不当作整体穿透深度。脚本检查开始/结束哈希，源文件中途变化会报错。

```sh
node tools/qa/export-character-poses.mjs --direction -1 --height 2.3 \
  --duration 3.5 --fps 12 --out /tmp/keeper-review
blender -b -t 4 --python tools/qa/render-character-poses.py -- \
  --input /tmp/keeper-review --samples 12

node tools/qa/export-character-poses.mjs --motion gather --direction 1 \
  --height 2.1 --seed 1 --duration 2.8 --fps 12 --out /tmp/catch-review
node tools/qa/export-character-poses.mjs --actor striker --type normal \
  --time 1.8467 --out /tmp/contact-review
```

完整接稳配方：低球 `height=.3, target=direction*2, power=.55, seed=3`；高球 `height=2.1, target=direction*1.5, power=.55`，左侧 seed=2、右侧 seed=1；speed/reach 均为 95。脚本不制造接球；给定配方未实际接稳时会直接报错。

## 未完成的设备检查

本环境受控浏览器拒绝本地预览；独立 Chromium 也在启动阶段因不允许创建 socket 而退出。因此以下项目尚未验证：

- 实际 WebGL 最终贴图、着色与横竖屏排版
- 真机触屏操作和移动端持续帧率
- 浏览器真实网络失败后的备用显示、WebGL 上下文恢复

模拟 DOM、Node 加载失败回退、CPU 性能和离屏图均不能替代这些检查。可本地运行后按“左右高低扑救 → 中路扑救 → 接稳起身 → 三种射门 → 暂停反复拖帧 → 横竖屏 → 禁用 GLB 请求”的顺序完成设备验收。
