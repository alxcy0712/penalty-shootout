# Blender 文件入口

所有制作文件均放在当前“点球大战”项目内，目录为 `assets/characters/`。

| 文件 | 用途 |
| --- | --- |
| [striker-mocap.blend](assets/characters/striker-mocap.blend) | **动捕原型**：CMU 10_01，原速助跑、踢球与随摆，接地及触球修正 |
| [striker-quaternius.blend](assets/characters/striker-quaternius.blend) | 程序动作版本：手掌缩小、肩肘腕联动、平滑步伐、前向承重收势 |
| [striker-quaternius-v2.blend](assets/characters/striker-quaternius-v2.blend) | 上一轮版本，本轮对比页左侧 |
| [striker-quaternius-before.blend](assets/characters/striker-quaternius-before.blend) | 最初接入的 CC0 人物版本 |
| [striker-prototype.blend](assets/characters/striker-prototype.blend) | 最早自制人物；已保存原 Blender 窗口中的未提交编辑 |
| [striker-prototype-disk-backup.blend](assets/characters/striker-prototype-disk-backup.blend) | 保存上述窗口之前的磁盘文件备份 |
| [striker-prototype-refined.blend](assets/characters/striker-prototype-refined.blend) | 早期自制人物修正版 |

浏览器检查：[motion-lab 原型对比](http://localhost:4173/motion-lab-prototype.html?asset=quaternius)。左侧为上一轮，右侧为当前版本。文件旁同名 GLB 为浏览器资产，JSON 为资源预算和接触事件信息。

本轮已实际将 Blender 切换到 `striker-quaternius.blend` 并放大人物视图。当前文件包含 0–213 帧动画，60 fps；触球在 114 帧。项目使用 Three.js AnimationMixer 播放其 GLB 动作。

复现制作：使用 Blender 后台运行 `tools/blender/create_quaternius_striker.py`，动作定义在 `tools/blender/striker_body_motion.py`。源资产及 CC0 许可位于 `assets/characters/quaternius-source/`。

## 足球动捕版本（2026-09-25）

[打开动捕对比](http://localhost:4173/motion-lab-prototype.html?asset=mocap)：左侧为之前的程序动作，右侧为 CMU 真人动捕。两侧同速播放；左侧从 0.05 秒开始，使两侧触球事件对齐。

`striker-mocap.blend` 保存 0–210 帧、60 fps 动作，触球标记为第 111 帧。运行 `node tools/mocap/sample-cmu.mjs`，再以 Blender 后台运行 `tools/blender/create_mocap_striker.py` 可复现。动捕来源与许可保存在 `assets/characters/mocap/cmu-soccer/README.md`。旧文件均保留。

## 门将扑救原型（2026-09-25）

`assets/characters/keeper-prototype.blend` 为新门将制作文件，保留已验收射门文件及所有旧版。包含 `Keeper_N05D`、`Keeper_O05E` 两个 120 fps 动作；在 Blender 的 Action Editor 中切换。浏览器入口：[门将原型](http://localhost:4173/keeper-motion-lab.html)。本轮使用 Blender 后台生成该文件，当前 GUI 窗口可能仍显示旧人物。

复现：先执行 `node tools/mocap/sample-keeper.mjs`，再用 Blender 后台运行 `tools/blender/create_keeper_prototype.py`。来源与改动说明：`assets/characters/mocap/keeper-research/README.md`。预览里的热身、起身、抱球等沿用现有程序姿态，作为骨骼映射检查。
