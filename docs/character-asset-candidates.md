# 运动角色与动画候选（2026-09-25）

建议优先验证 **Quaternius 人物底模 + 通用运动动画 + CMU 足球射门动捕**。角色形状、步态与专项射门分别选择合适来源，再在 Blender 中统一骨架、服装和接触约束，导出 GLB。Quaternius 免费男性角色已加工并接入 motion-lab 单角色预览；原比赛继续使用现有角色，手机真机验收仍待完成。

| 候选 | 官方资料核实 | 本项目用途与仍需工作 |
| --- | --- | --- |
| [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) | CC0；Humanoid rig；动画友好拓扑；官方平均约 13k 三角面；FBX/glTF。完整产品描述包含 6 种体型与发型变体 | 首选风格化人体，适合现有球场；仍需球衣、短裤、球袜、鞋、号码和门将手套。免费 Standard 已核实含男女 Superhero 两种 FullBody；男性原网格 14,318 面、65 骨，适配数据见本轮检查记录 |
| [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) | CC0；含待机、8 方向移动、慢跑、冲刺等；有 root-motion 与 in-place 版本；产品共 120+ 动作，免费 Standard 只包含其中一部分 | 选待机/跑步/转向；足球触球、扑救、抱球仍需专门制作和修正 |
| [CMU 足球踢球动作目录](https://mocap.cs.cmu.edu/search.php?maincat=4&subcat=7) | Subject 10/11 明确列有 soccer-kick-ball；[官方使用条款](https://mocap.cs.cmu.edu/)允许在商业产品中使用，禁止单独转售数据（含转换格式） | 射门发力和重心节奏参考/重定向来源；ASF/AMC 骨架与比例需转换，手/脚趾噪声需清理。此项是可用动捕数据，许可区别于 CC0 |
| [Blender 官方 Human Base Meshes](https://www.blender.org/download/demo-files/) | v1.4.1、CC0、约 49 MB 的完整创作素材包；要求 Blender 4.2+ | 人体比例和拓扑备用方案；还需要衣服、骨架、权重、动作及游戏资源精简，制作量更大 |

## 免费版本边界

[Quaternius 作者下载页](https://quaternius.itch.io/universal-base-characters)明确提供免费 Standard（122 MB）；包含 `.blend` 源文件的 Source 为付费版本。已从作者公开下载接口获取免费 Standard 包，校验所选文件 CRC 并保留随包许可证；完成文件级面数、骨数和材质检查。没有付款、登录或上传项目文件。

[动画库作者页面](https://quaternius.itch.io/universal-animation-library)列出 Standard 15 MB，Pro/Source 为付费选项。120+ 是完整库的宣传总量，不能当作免费包实际动作数量。

完整素材压缩包大小用于制作阶段；最终浏览器只加载筛选、加工、压缩后的单角色 GLB、必要动作和贴图。可先沿用 18k 三角面、5 材质的原型上限；候选骨数与贴图预算应在文件实测后决定，不能套用当前自制原型的 22 骨/零贴图数据。

## 接入门槛

1. 单角色导入 motion-lab，统一身高、朝向、缩放和同机位；保留当前角色对照。
2. 建立髋/膝/踝/肩/肘/腕映射；视觉修正遵守固定骨长，球的物理与比赛规则继续使用原实现。
3. 核对脚接地、1.90 秒预览触球事件、球鞋接触点、随摆和中断连续性；测量压缩体积、绘制调用和帧时。
4. 用户确认可视原型后，再扩展到全部角色、门将与比赛。

已执行的单角色转换与验证见 [本轮检查记录](character-refinement-2026-09-25.md)。CMU 实际文件获取本次超时，现有候选动作由项目内制作，后续再评估动捕。
