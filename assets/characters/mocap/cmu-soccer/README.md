# CMU 足球动捕候选

2026-09-25 获取，制作参考与单角色重定向候选。当前已将 10_01 重定向到 `striker-mocap.blend/.glb`，可在 motion-lab 原型页选择“真人足球动捕”。正式比赛保持原实现。

## 来源与许可

- 原始采集：[CMU Graphics Lab](https://mocap.cs.cmu.edu/)，[足球目录](https://mocap.cs.cmu.edu/search.php?maincat=4&subcat=7)。Subject 10 的 01/02/03/05/06，以及 Subject 11 的 01 为足球踢球；10_04 为走路。
- 下载镜像：[adventuring/mocap](https://github.com/adventuring/mocap)，提交 `f80c3e254b375ed1ce5aa47cdcf62c46fb52a7cf`，路径 `CMU/10.kick-soccer-ball`、`CMU/11.kick-soccer-ball`。
- 转换者 Bruce Hahne / cgspeed；随镜像的原始说明保存在 `CONVERSION-README.txt`。本批是 Daz-friendly、hip-corrected 版本，已经过 MotionBuilder 重定向，不能视作未经加工的原始骨架数据。
- CMU 官方允许研究和商业项目使用，禁止单独转售数据（包括转换格式）。转换者没有附加限制。采用 CMU 的数据使用条款，不将镜像仓库的概括性 MIT-alike 描述当作资产许可证。
- 致谢：The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.

## 文件验证

7 个 BVH，6 段踢球、1 段走路；每段 43 个命名关节、132 个通道，约 120 Hz。逐帧检查帧数、通道数与有限数值通过；Three.js BVHLoader 解析通过。SHA-256、体积和时长见 `inventory.json`。

| 片段 | 时长（秒） | 用途 |
| --- | ---: | --- |
| 10_01 | 6.675 | 踢球候选，优先检查完整助跑和收势 |
| 10_02 | 4.917 | 踢球候选 |
| 10_03 | 3.017 | 踢球候选 |
| 10_04 | 4.575 | 走路参考 |
| 10_05 | 3.633 | 踢球候选 |
| 10_06 | 4.767 | 踢球候选 |
| 11_01 | 4.975 | 第二位采集者的踢球候选 |

## 接入前检查

需在 Blender 预览、选片并重定向到现有角色。保留采集中的根位移、骨盆与肩膀配合、手臂反向平衡及随摆；根据片段标记支撑脚接地与触球帧，再对接现有物理事件。先按原速比较，不将所有片段强制压成旧的 3.55 秒。

转换说明明确提示可能有脚底滑动、关节翻转；手指并非真实采集。需检查比例、朝向、肩部映射、脚锁定和噪声，不能直接宣布动作质量达标。原始 BVH 只用于制作；浏览器继续加载筛选、烘焙和压缩后的 GLB。

## Inventory verification (2026-10-01)

The byte sizes and SHA-256 values in `inventory.json` were recomputed from the checked-in BVH files. The previous inventory values did not match these files (the same mismatch existed in commit `e8ce600`); no BVH data was modified as part of this correction. New retargeted-take metadata uses the checked-in source hashes.
