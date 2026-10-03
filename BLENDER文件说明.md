# 当前人物制作文件

浏览器验收统一使用 `http://localhost:5173/motion-lab.html`。

| 文件 | 用途 |
| --- | --- |
| `assets/characters/striker-mocap.blend` | 当前射手；60 fps，触球在第 111 帧 |
| `assets/characters/keeper-prototype.blend` | 当前门将；保留研究动作与修复后的肩部权重 |
| `assets/characters/striker-quaternius.blend` / `.json` | 射手生成脚本仍需读取的制作中间文件 |
| `assets/characters/striker-prototype-refined.json` | Quaternius 制作脚本仍需读取的资源元数据 |

对应 `striker-mocap.glb` 和 `keeper-prototype.glb` 为游戏实际加载资产。同名 JSON 记录骨骼、片段和预算信息。备用人物仍由 `src/character.js` 生成。

## 制作依赖

- `tools/blender/create_striker_prototype.py`：其余生成脚本使用的骨架与制作工具；保留供重建。
- `tools/blender/create_quaternius_striker.py` 与 `striker_body_motion.py`：生成射手所需的中间模型。
- `node tools/mocap/sample-cmu.mjs`，随后用 Blender 后台执行 `tools/blender/create_mocap_striker.py`：生成当前射手。
- `node tools/mocap/sample-keeper.mjs`，随后执行 `tools/blender/create_keeper_prototype.py` 和 `repair_keeper_skin.py`：生成并修复当前门将。

采样文件输出到 `/tmp`，Blender 脚本依赖 Blender 自带的 `bpy`。源人物、动作数据及许可保留在 `assets/characters/quaternius-source/` 和 `assets/characters/mocap/`。署名见 `public/character-credits.txt`。已清除被替代的模型成品与自动备份。

## 运行时变形与制作文件的边界

本分支没有重新标注或替换动作来源。GLB/Blend 仍保存原有 22 骨制作骨架和捕获片段；游戏会在门将实例上添加两个肩部变形辅助骨，并在运行时完成撑地腕角、恢复姿态和射手随摆/落步修饰。单独打开 Blender 源文件不会显示这些 JavaScript 修正。动作最终验收以共享 `GameCharacter` 为准，相关回归在 `tests/character-motion-quality.test.js` 和 `tests/keeper-shoulder.test.js`。
