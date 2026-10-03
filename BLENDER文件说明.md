# 当前人物制作文件

> A1安全入口：先看 [候选工具说明](tools/model-build/README.md) 与 [开发指南](docs/A1_DEVELOPER_GUIDE.md)。当前可编辑.blend是发布GLB的重建副本，不等于原始制作源。两个旧式原地rebuild已禁用；其他历史create_*脚本尚未迁入安全适配器，不要直接对正式assets运行。

浏览器验收统一使用 `http://localhost:5173/motion-lab.html`。

| 文件 | 用途 |
| --- | --- |
| `assets/characters/striker-mocap.blend` | 当前射手；60 fps，触球在第 111 帧 |
| `assets/characters/keeper-prototype.blend` | 当前门将；保留研究动作与修复后的肩部权重 |
| `assets/characters/striker-quaternius.blend` / `.json` | 射手生成脚本仍需读取的制作中间文件 |
| `assets/characters/striker-prototype-refined.json` | Quaternius 制作脚本仍需读取的资源元数据 |

对应 `striker-mocap.glb` 和 `keeper-prototype.glb` 为游戏实际加载资产。同名 JSON 记录骨骼、片段和预算信息。备用人物仍由 `src/character.js` 生成。

## 历史制作依赖（不是当前安全重建命令）

- `tools/blender/create_striker_prototype.py`：其余生成脚本使用的骨架与制作工具；保留供重建。
- `tools/blender/create_quaternius_striker.py` 与 `striker_body_motion.py`：生成射手所需的中间模型。
- `tools/mocap/sample-cmu.mjs` 与 `tools/blender/create_mocap_striker.py`：历史射手采样/生成来源；其默认输出与工具版本需要迁入候选适配器后才可用于当前发布。
- `tools/mocap/sample-keeper.mjs`、`tools/blender/create_keeper_prototype.py` 和 `repair_keeper_skin.py`：历史门将制作链；后者的原地rebuild已禁用，内存repair helper仍可用于隔离研究。

历史采样脚本默认输出到 `/tmp`；大型候选/验收产物应显式放在磁盘工作区，避免RAM-backed临时目录压力。Blender 脚本依赖 Blender 自带的 `bpy`。源人物、动作数据及许可保留在 `assets/characters/quaternius-source/` 和 `assets/characters/mocap/`。署名见 `public/character-credits.txt`。已清除被替代的模型成品与自动备份。

## 运行时变形与制作文件的边界

本分支没有重新标注或替换动作来源。GLB/Blend 仍保存原有 22 骨制作骨架和捕获片段；游戏会在每个人物实例上添加两个肩部变形辅助骨，并在运行时完成撑地腕角、恢复姿态和射手随摆/落步修饰。单独打开 Blender 源文件不会显示这些 JavaScript 修正。动作最终验收以共享 `GameCharacter` 为准，相关回归在 `tests/character-motion-quality.test.js` 和 `tests/keeper-shoulder.test.js`。
