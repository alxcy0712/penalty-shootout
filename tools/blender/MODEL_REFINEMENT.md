# 足球人物建模细化与复现

2026-10-01，最终几何候选 v17。运行时对照基线为 `47af008`；模型最初来源及许可仍见 `public/character-credits.txt`、Quaternius 和 CMU 的原始说明。

这次确实修改了网格和服装细节，不是替换概念图，也不声称重新手工雕刻了完整人物。保留了原角色、原绑定和原动捕数据。

## 修改内容

- 门将：平顺球衣前片、减弱原超级英雄胸腹肌沟槽、填补过窄腰部轮廓；短裤增加少量布料体积，固定已有衣裤/皮肤接缝
- 头部：统一调整脸、眼睛和头发的宽高比例；短发冠部增加轻微偏向轮廓，保留原贴图
- 原方形领口按三角面重新裁切为圆领，增加真实领边、袖边、裤脚边及门将手套腕口网格
- 手套：保留原手掌、手指表面；使用顶点色区分白色掌面、深色手背和指背分段
- 球鞋：原鞋面和触球表面不动；区分后跟、侧面、鞋背色块，增加 12 个低矮三角形截面鞋钉。原鞋带没有被冒称为新鞋带造型
- 射手：保留捕获动作中前臂经过的下胸/腰部区域，避免增加原素材没有的碰撞；保留上胸、头部、领口和装备改动。门将和射手并非采用相同幅度的腰部外扩

新增颜色复用六种材质，不增加贴图。`Boots` 的基础颜色改为白色，再由 `COLOR_0` 提供原深色头发、深色鞋底和鞋面分区；运行时需保留 glTF 顶点色。队服仍是 `Kit` 材质，按游戏队色乘以顶点色。

## 不变项与预算

| 项目 | 门将 | 射手 |
| --- | ---: | ---: |
| 三角形 | 17,976 | 17,946 |
| GLB 字节 | 441,536 | 441,568 |
| 原始骨骼 | 22 | 22 |
| 运行时骨骼 | 24（含肩部辅助骨） | 24（含肩部辅助骨） |
| 最大蒙皮权重 | 4 | 4 |
| 材质 / 贴图 | 6 / 2 | 6 / 2 |
| 贴图尺寸 | 512²、128² | 512²、128² |
| 新顶点色原始属性字节 | 178,880 | 177,824 |

仍遵守每资产 18,000 三角形、450,000 字节上限。材质批次数和纹理数量没有增加，但顶点属性存在上述 GPU 内存成本；这不等于移动设备帧率或功耗通过。

二进制审计确认：原节点/骨架、逆绑定矩阵、动画采样值、原顶点蒙皮权重和两张图片字节不变。原手部和鞋部顶点的位置误差为 **0 mm**。新增领边和鞋钉属于附加几何，不计入“原顶点不变”。最终位置压缩对新建/编辑坐标的最大误差为 0.00763 mm；法线分量最大误差为 0.000489。

最终资产 SHA-256：

- keeper-prototype.glb: `af13951cda7f7655e98eed9fa5cdb0b903b73379f9e7260f5d8e67089fafbf19`
- striker-mocap.glb: `e0b3eb06d09d80135827c5f5e7e58ab26778a5dc0b8c3333be48a704603bfc3d`

## 验证结果

- 完整集成快照：188 项测试通过、0 失败；生产构建成功。保留约 1.169 MB rendering chunk 的 Vite 警告，不把构建成功解释为真机性能通过
- 门将真实蒙皮：302 个左右低/中/高扑救、落地及恢复姿态；前臂/躯干、小腿/躯干、肩袖/躯干、肘内侧、左右脚小腿五类受保护非邻接交叉均未新增
- 135 场固定种子射门全部结束；58 次身体接触、36 次接稳。首次接触到实际蒙皮误差约 -0.008 至 +0.034 mm，与原模型结果相同
- 28 组全周期地面检查维持原约 -1.92 mm 最低值，高于 -14 mm 草坪平面。新增鞋钉没有降低最坏落地点
- 两段真实捕获 CMU 10_01 / 10_03 共 71 个检查姿态：与原网格逐顶点签名对应，没有新增膝部折叠三角对、左右小腿交叉、小腿/躯干交叉或前臂/躯干交叉，也没有增加逐姿态最大有限三角分离量
- 实际离屏检查包括：抬臂、低扑、落地恢复、两段动作的触球和随摆。领边/袖口/裤脚随原绑定运动；未发现脱离身体的新增零件
- Blender 4.3 CPU 渲染，最终整身对比为同一 1920×1080 分辨率、前/侧/背方向、照明、镜头和蓝色队服。近景使用高采样；当前 Blender 构建不含去噪器，所以不称为“去噪图”

### 原素材问题与后续运行时修正

以下为细化网格、尚未叠加后续肩部/手臂修正的独立对照；不是最终游戏修正后的问题清单。没有将“没有新增交叉”写成“人物完全无自交”。原射手素材有局部折叠/接触：

- CMU 10_01，游戏时间 1.9 秒（原动捕时间 2.1967 秒）：前臂/躯干有限三角 SAT 分离量约 8.924 mm，原模型与最终模型完全相同
- CMU 10_03，0.7 秒：局部膝部折叠约 4.401 mm，原模型与最终模型完全相同
- 71 姿态中原膝部折叠三角对累计 60、最终也是 60；原前臂/躯干交叉累计 472、最终 471。计数不是穿透体积，有限三角分离量也不是整个身体的穿透深度

中间腰部外扩候选在 10_01 的游戏时间 3.1 秒增加过约 3.2 mm 的前臂接触，已被否决。最终候选保留射手该区域的原表面；该姿态回到 0 新交叉。设备 WebGL、实际触屏、持续移动 GPU 表现仍需独立检查。

随后对射手启用两枚已有类型的肩部辅助骨，并在角色根节点局部坐标系计算辅助骨，避免展示朝向或非均匀缩放导致的变形偏差。GLB 字节和原 22 骨的捕获采样仍不改写。局部坐标方案保持现有严格骨骼等值测试不变；新增两个专项测试覆盖原骨骼不变、辅助骨旋转/位置、实际肩部网格协变、重复调用、24 骨和四权重上限。手臂避让是按片段原生时间执行的运行时修饰，不当作新增捕获数据。最后采用的修饰窗口、逐片段交叉结果和集成测试计数，以仓库 `VALIDATION.md` 为准。

## 从原始网格重建

不要对已经细化的资产重复运行该脚本。脚本核对两份原 GLB 的 SHA 并会拒绝重复变形。原始输入可从本仓库历史恢复；这不会切换工作分支。

```sh
mkdir -p /tmp/penalty-model-base /tmp/penalty-model-tools /tmp/penalty-model-candidate
for name in keeper-prototype striker-mocap; do
  git show 47af008:assets/characters/$name.glb > /tmp/penalty-model-base/$name.glb
done
npm install --prefix /tmp/penalty-model-tools meshoptimizer@0.24.0
for name in keeper-prototype striker-mocap; do
  MODEL_ENCODER=/tmp/penalty-model-tools/node_modules/meshoptimizer/index.module.js \
    node tools/blender/refine_football_models.mjs \
    --source /tmp/penalty-model-base/$name.glb --out /tmp/penalty-model-candidate
  node tools/qa/audit-model-refinement.mjs \
    /tmp/penalty-model-base/$name.glb /tmp/penalty-model-candidate/$name.glb
done
```

输出包括正式压缩 GLB、标准未压缩 `*-decoded.glb` 和 JSON 审计信息。标准 GLB 与正式 GLB 解码后的坐标、法线和颜色一致，可供较旧 Blender 导入；不会把没有压缩的预览文件当作线上资产。

```sh
blender -b -t 4 --python tools/blender/render_refined_models.py -- \
  --input /tmp/penalty-model-candidate/keeper-prototype-decoded.glb \
  --output /tmp/penalty-model-candidate/keeper-review.png \
  --focus full --samples 96 \
  --save-model /tmp/penalty-model-candidate/keeper-prototype.blend
```

`--save-model` 在设置展示颜色、清除渲染动画和复制三视角之前保存，保留导入的真实动作与绑定。此编辑文件不包含游戏运行时辅助肩骨或手臂避让；原生 Blender 回放与经过运行时修饰的游戏画面不完全相同。提供的 `.blend` 已在 Blender 4.3.2 保存。它是从完整 GLB 重建的可编辑文件，原 5.2 动作数据仍可通过原资产历史取得；后续在 Blender 改模再导出，仍需重新验证蒙皮并生成碰撞数据。

## 集成与重复检查

仅在确认候选后替换两份 GLB 和可编辑 `.blend`，合并更新原 JSON 的三角形/字节数及建模说明，保留许可、源动作和事件时间。不要改动原预算来让候选通过。

```sh
node tools/generate-keeper-contact.mjs
npm test
npm run build
node tools/qa/audit-character.mjs matrix --out /tmp/model-audit
node tools/qa/audit-character.mjs ground --out /tmp/model-audit
ARTIFACT_DIR=/tmp/model-audit node tools/qa/audit-self-intersections.mjs
MODEL_ASSET=/tmp/penalty-model-candidate/striker-mocap.glb \
  ARTIFACT_DIR=/tmp/model-audit/captured node tools/qa/audit-refined-captures.mjs
```

`audit-refined-captures.mjs` 记录实际材质、三角顶点签名、接触帧和 SAT 数值，能够与原 GLB 再跑一次后做差分，不依赖已经改变的全局 face 编号。`render-refined-poses.py` 可保留装备顶点色；先用原 `export-character-poses.mjs` 导出，再以 `attach-model-pose-colors.mjs` 附上对应 decoded GLB 的颜色。它仍是实际几何的离屏简化材质检查，不是浏览器截图。

## Lossless editable-file transfer encoding

The delivered `keeper-prototype.blend` and `striker-mocap.blend` use Blender-supported gzip encoding, retaining the `.blend` extension. This changes serialization only: decompressing yields the exact previously validated Blender 4.3.2 file bytes. Both compressed files were reopened directly in Blender 4.3.2 and their object types, mesh vertex/polygon counts and coordinates/weights, rig bone counts, and action/keyframe inventories matched the uncompressed originals. Runtime GLBs are unchanged.

| File | Original bytes | Compressed bytes | Original SHA-256 | Compressed SHA-256 |
| --- | ---: | ---: | --- | --- |
| keeper-prototype.blend | 4391780 | 1072162 | 745e472568ec12e08d06d5efab74472846b9325d37a176061f4aa801603ba62a | 226b592957139d0bafe63199ee4aca76ba7ebe4bc3631abddd86bb2e7ae62a61 |
| striker-mocap.blend | 6120348 | 1382613 | c49271d3e519e5e2069f34e06f31195d747b75d92a5590599e55f4f356a50eed | 5c9136880c6b502054abfa71d9e4626ff369e66b96c448c4390ac849367888ef |

To encode a newly saved, uncompressed file deterministically, use Python `gzip.compress(original_bytes, compresslevel=9, mtime=0)`. Do not repeatedly wrap an already compressed file. The model regression test verifies the exact decoded source digests and a 2 MB compressed-file budget.
