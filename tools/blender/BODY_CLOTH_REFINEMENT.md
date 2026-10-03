# 身体与足球服装第二轮细化

本轮以已发布 `1b1230e` 的 v17 模型为输入，保留原动作与绑定。Blender 4.3.2 执行真实网格编辑，最终候选为 body-cloth-v18/candidate8。不是概念渲染，也没有运行时布料模拟。

## 形体与拓扑

- Blender 在焊接的工作网格上执行带局部权重的 Smooth 修改器（6 次、0.48 系数），平顺肩峰和上臂过渡。输出仍保留原资产的逐材质顶点顺序、原骨骼和原蒙皮权重。评审使用游戏现有肩部辅助骨之后的实际蒙皮，未调整其权重参数
- 缩减过厚胸廓，保持先前受保护的下胸/腰部走廊，避免重复失败的腰部外扩方案
- 短裤采用离线椭圆截面拟合形成较直的下垂外侧；不随大腿肌肉鼓起。裤脚上提 45 mm（按高度平滑衰减），大腿皮肤只沿高度续接，不跟随布料向外扩张
- 内侧 |x|≤0.09 m 不做径向布料外扩，0.09–0.14 m 平滑过渡，保护双腿交叉的内侧空间。中间候选曾增加内侧接触，最终已降低该最坏姿态的交叉量
- 原来贴在皮肤上的装饰裤边共 126 三角形被移除，改为 104 个真正连接外裤脚与内侧皮肤接缝的三角形。初版桥接中 64 个零面积面被剔除，最终每模型反而减少 22 个三角形。没有删除鞋面、手掌或鞋钉
- 新裤边顶点追加到 Shorts；原 Shorts 顶点编号保持不变。`*-stats.json` 的 hemBoundaryMap 逐点记录原裤脚、内皮肤与新桥接顶点。86 个接缝映射的原骨骼索引和权重均完全相同，可连续随动；内外裤口使用分离法线形成清晰边缘

## 最终预算与不变项

| 资产 | 三角形 | GLB 字节 |
| --- | ---: | ---: |
| keeper-prototype | 17,954 | 449,080 |
| striker-mocap | 17,924 | 446,308 |

两者均继续满足原 18,000 三角形、450,000 字节限制；不需要中间候选讨论过的 18,018 例外。六种材质、两张原贴图、22 个资产骨骼、24 个运行时骨骼、每顶点最多四权重不变。不增加绘制批次或运行时布料步骤。尚无真机 GPU 帧率结论。

二进制审计：原节点、原绑定、动作定义与全部动作/绑定采样值、贴图字节、原顶点权重完全不变。原手掌与鞋部接触顶点最大位移为 0 mm。改动坐标压缩最大误差 0.00763 mm；法线分量压缩最大误差 0.000489。

- keeper GLB SHA-256：`29b228bb40af114dd6cb427312102bd772fd1951c8754a27d87d718377e5e31a`
- striker GLB SHA-256：`aad3a3782a1e806b8fd596e6b9eeb62e47ebe4d729bb421d0ec4631a6fb76996`

可编辑 `.blend` 从最终标准解码 GLB 重建，保留 22 骨及原资产里的两个动作；以 gzip 9 / mtime=0 无损压缩，解压逐字节比较通过，并在 Blender 4.3.2 再次打开验证。射手的独立 10_03 动作仍由原 animation-only GLB 提供；游戏中的辅助肩骨和手臂避让属于运行时处理，不假称已烘入 Blender 文件。

## 几何检查与可见限制

同一冻结射手运行时、两段动捕共 71 个姿态：前臂/躯干、左右小腿、小腿/躯干关键交叉仍为零；膝部折叠累计 60 对与基线相同。新增内大腿分类揭示源模型原有交叉，不能声称人物全局无自交：

- 双侧大腿分类累计 676→602 对，最坏有限三角 SAT 分离量 10.835→10.149 mm，位于 10_03 游戏/原生时间 1.4 s 的交叉裤脚
- 同侧大腿局部折叠 217→213 对，最大约 4.044→4.051 mm
- 并非逐帧单调改善：10_01 游戏 2.2 s / 原生 2.4967 s 的内侧裤片局部量为 6.474→7.552 mm。已制作实际三角形标红的近景对照；前视下该处在交叉双腿后被遮挡，没有外露的皮肤破面。保留这一限制，不用总数降低代替局部说明
- 冻结最终 GLB 后，额外以 100 Hz 检查两个手臂风险窗口（121 + 61 姿态），两段前臂/球衣交叉都为零。局部上臂/球衣相邻接缝仍存在：10_01 最大全局 12.584 mm，10_03 为 11.497 mm；手臂修饰导致的逐帧增加最多约 0.909 / 0.296 mm，未将其冒称为全局无交叉
- 36 项重点解剖、捕获动作、肩部根坐标和手臂避让测试通过。后续门将动作软化的最终组合检查及完整测试以 `VALIDATION.md` 为准

模型变化需要重新生成门将接触缓存。旧缓存会有约 8 mm 偏差；在隔离环境重新生成后，135 场固定种子射门仍有 58 次接触、36 次接稳、0 未完成，首次实际网格接触偏差约 -0.008 至 +0.112 mm。最终组合运行时仍须重新验证。

渲染使用相同相机、光照、队色和真实 CPU 蒙皮数据。Blender 离屏材质简化图不是浏览器截图；同色静态三视图保留原贴图。中间候选 3/4 的鼓胀裤口已否决，候选 6 的波浪内侧裤边也未采用。

## 复现

不要覆盖已编辑资产后再当作输入。打包器只接受发布 v17 的两份确切 SHA。

```sh
mkdir -p /tmp/body-source /tmp/body-baseline /tmp/body-result
for name in keeper-prototype striker-mocap; do
  git show 1b1230e:assets/characters/$name.glb > /tmp/body-source/$name.glb
done
npm install --prefix /tmp/penalty-model-tools --cache /tmp/penalty-npm-cache meshoptimizer@0.24.0 --ignore-scripts
export MODEL_ENCODER=/tmp/penalty-model-tools/node_modules/meshoptimizer/index.module.js
for name in keeper-prototype striker-mocap; do
  node tools/blender/pack_blender_body_edit.mjs --source /tmp/body-source/$name.glb --out /tmp/body-baseline
  blender -b -t 4 --python tools/blender/sculpt_body_cloth.py -- \
    --input /tmp/body-baseline/$name-mesh.json --output /tmp/body-result/$name-edits.json
  node tools/blender/pack_blender_body_edit.mjs --source /tmp/body-source/$name.glb \
    --out /tmp/body-result --edits /tmp/body-result/$name-edits.json --hem true
  node tools/qa/audit-model-refinement.mjs /tmp/body-source/$name.glb /tmp/body-result/$name.glb
  blender -b --python tools/blender/save_editable_model.py -- \
    --input /tmp/body-result/$name-decoded.glb --output /tmp/body-result/$name.blend
  gzip -n -9 -c /tmp/body-result/$name.blend > /tmp/body-result/$name.blend.gz
done
```

gzip 的无损可重复压缩针对同一 `.blend` 字节；Blender 新保存文件可能含不同内部元数据，不承诺跨保存过程的 `.blend` SHA 相同。正式游戏仍读取压缩 GLB。原 CMU 10_03 校准来源与 SHA 保留历史值，本轮只验证它与新网格的兼容性，未重新宣称动作校准来源。

## 门将支撑动作历史快照验收（后续持球修复见下文）

本节早期组合快照为 anatomy SHA `6f33c01554ca024fdccbe5bfc4599b5e805382fd93c017cf95111152542fc11e`、keeper-contact SHA `f1955eb6f4d6ec2e075cef7ffef26b6a79ba0860766ad1d3e8ca36e81033ad45`。中间版本的视频不能代表此结果；最后已重新生成全部 16 个左右高低球关键姿态和三个完整序列，并逐份核对导出元数据中的源码 SHA。

- 自由扑救：236 个真实蒙皮姿态。前臂/躯干、小腿/躯干、肩部及辅助骨/躯干、左右脚小腿四类受保护交叉均为零。局部肘褶皱最坏 1.701 mm 出现在 0.1 s；已发布基线同姿态为 1.719 mm。其余落地后肘褶皱不超过 0.372 mm
- 接稳并持球起身：七种实际接球方案共 163 个姿态，前臂/躯干、小腿/躯干、左右脚小腿交叉为零。仍有局部肩袖折叠，最大 5.264 mm；肘部局部折叠最大 3.114 mm。计数是三角对，不是身体穿透体积
- 135 场射门全部结束，58 次接触、36 次接稳；重新生成接触数据后，首次实际网格接触偏差约 -0.0022 至 +0.1115 mm。原文前面的中间快照数字保留作迭代记录
- 独立支撑检查采用真正蒙皮后的中央掌面三角形，每侧选 136 面，排除指尖、拇指尖和腕口。稳定支撑阶段手套最低点约 5 mm、中央掌面最低约 7.04 mm、面积加权平均高度约 29.51 mm，掌面相对朝下方向约倾斜 26.7°。因此描述为局部掌根/掌面支撑，不声称整个手掌平贴在 5 mm 平面上。该检查是几何距离与方向测量，不是受力/平衡仿真

最终媒体位于 `character-qa/body-cloth-v18/combined/`：四张 `free-save-*-sheet.png`，以及 `sequence-low`、`sequence-high`、`sequence-gather-full` 的 `-comparison.mp4` / `-comparison-quarter-speed.mp4`。`final-render-manifest.json` 保存各导出与视频 SHA。旧的 `sequence-gather`（没有 `-full`）已过时，不应作为最终证明。离屏视频和 motion-lab 一样水平跟随角色根部，不能据此单独判断世界坐标中的脚底滑动。

`tools/qa/probe-keeper-support.mjs` 可复查实际掌面高度与朝向；`render-refined-poses.py --camera FILE` 可复用相同镜头，`--focus highlight` 可将已标记的具体交叉三角形放大检查。最终发布前的完整工程测试与构建由 `VALIDATION.md` 记录。

最后工程一致性修复将 anatomy SHA 更新为 `40a841de7cd387afa12ecab537bd686b6923f742421307037db7b0940a711a8a`。按原参数重新导出全部 19 组关键姿态/完整序列后，`poses.bin` 与实际渲染的 6f33 版全部逐字节相同，最大坐标差为 0；因此保留已渲染媒体并在清单记录兼容性验证，不冒称重新渲染。


## 最终持球约束修复与扩大覆盖

最终源码为 anatomy `40a841de7cd387afa12ecab537bd686b6923f742421307037db7b0940a711a8a`、keeper-contact `1c8ccc440c07643b455f1c0300fe5b17ec243c37f2b0584b1d34e47f9f2f260a`。前述 f195 七种接球方案的检查不能覆盖所有实接球：扩展后发现宽中球持球起身时前臂穿球、前臂穿下部球衣，并在镜像中央球发现肘部快速跳转。最终修复同时约束球、地面和躯干安全区域；保留这些失败快照作为回归证据，不将其描述为发布通过版本。

`node tools/qa/audit-held-body.mjs --check` 对 139 个物理输入中实际接住的全部 40 例检查真正蒙皮三角形。每例完整 2.8 秒以 10 Hz 采样；宽中球的 +0.2–0.7 秒、+0.95–1.4 秒和中央球 +0.12–0.25 秒增加 120 Hz 采样，共 1,400 姿态。前臂/躯干、小腿/躯干、对侧脚/小腿均为零交叉；全蒙皮最低高度 -1.924 mm，在原有 -5 mm 地面容差内。这是明确采样范围的证明，不是连续时间无交叉证明。球面距离和 240 Hz 连续性另由完整 40 例 canonical hold 检查验证，不用身体分类替代球检查。

仍有相邻关节折叠：肩袖/躯干最大有限三角分离量 6.217 mm（宽左球 +0.408333 秒，Kit 面 1410/1746），内肘 3.165 mm（低右球 +0.2 秒，Skin 面 209/262）。实渲染近景显示局部腋下接缝压折和肘弯褶皱，没有此前前臂穿出下部球衣的外露断面。中央球 +0.15–0.22 秒仍是明显迅速的收肘，属于游戏尺度的风格化快速接球，不宣称已达到缓慢自然的人体吸收动作。

本次细查渲染来自数值候选 5594；清理诊断代码后的最终 1c8 与其在全部 40 例 × 673 帧（240 Hz）共 26,920 份完整持球输出严格深度相等。证据位于 `combined/final-constraint-equality.json`。最终 19 组媒体参数重新导出后，18 组自由扑救姿态/序列与之前渲染字节一致；唯一发生变化的完整持球序列已用最终 1c8 重新渲染并重建前后对照视频。

重点媒体：`combined/wide-right-5594/` 的原速与四分之一速视频、`central-right-5594/` 的 120 Hz 近时段原速与慢速视频；`wide-right-5594-early`、`wide-right-5594-late`、`wide-left-5594-armpit`、`low-right-5594-elbow` 中的实际蒙皮双视角近景。前后完整媒体继续使用 `sequence-low`、`sequence-high`、`sequence-gather-full` 的 comparison 文件；清单已记录最终来源兼容性和更新的媒体 SHA。
