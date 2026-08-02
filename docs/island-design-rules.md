# 动森岛屿设计规则

本文区分游戏硬限制、Happy Island Designer 数据约定和审美建议。新设计必须先满足硬限制，再考虑主题与动线。

## 游戏硬限制

- 机场、服务处与广场、河流入海口、海滩轮廓、沿岸礁石、半岛、栈桥和秘密海滩在选岛后不能移动。内部河流、池塘和悬崖可以改造。
- 岛屿最多有四层高度，但第四层不可正常使用。上层悬崖外缘必须比下层至少内缩一格。
- 2.0 版本购买 Pro Construction License 后，桥梁和坡道分别最多十个；此前上限分别为八个。
- 桥面固定四格宽，可跨三至五格水面；沿河岸方向至少需要连续四格水面，两岸各需 `4×1` 的平行落脚区。桥梁可斜放，但边界周围和两座桥之间至少留一格。
- 坡道固定占地 `2×4`，其中上层 `2×1`、下层 `2×3`。坡道只能按上下左右方向放置，连接相邻高度；不能斜放、彼此紧贴、让入口或出口面向水面，也不能通向不可用的第四层。
- 道路可紧贴建筑，但不能进入建筑、广场、桥梁或坡道占地。树木正常生长需要周围八个方向各留一格，空地不能被水面、悬崖、建筑或其他树占用；花和灌木不妨碍树木生长。

## 项目数据约定

`origin-island.json` 是唯一基准。必须原样继承 `edgeTiles`、`drawing.level1[0]`、河口端点、`amenities_townhallSprite` 和 `amenities_dock`。机场和沿岸固定地形由 `edgeTiles` 编码，不能只检查对象列表。

对象坐标表示占地矩形左上角，不是中心点。镜像公式是 `112 - 对象宽度 - x`。项目工具定义的保守占地如下：

| 对象                        | 项目占地        |
| --------------------------- | --------------- |
| 服务处建筑 / 不可改造的广场 | `6×4` / `12×10` |
| 博物馆、商店                | `7×4`           |
| 服装店、玩家住宅            | `5×4`           |
| 露营地、村民住宅            | `4×4`           |

以上可移动建筑尺寸与游戏资料一致；服务处的 `12×10` 广场范围来自项目的 `extraObject()` 实现。生成与校验 JSON 时必须以 `app/tools/` 中的定义为准。

当前设计生成器使用 `6×4` 横桥精灵，因此桥位按四格宽河面加左右各一格落脚区校验。道路必须在桥梁完整占地外停止，不能铺在桥下河面或建筑下面。当前自动校验只接受横向四格水面的桥；采用其他方向或三、五格水面时，必须先扩展校验器。

## 交付检查

运行 `yarn validate-island-design -- origin-island.json design/NN.json design/NN.png`。自动校验覆盖固定边缘块、河口、地板水面重叠、悬崖内缩、完整建筑占地、树木生长空间、桥坡净空、坡道高度、数量上限及 PNG 内嵌 JSON。主题一致性、入口视线、区域用途和步行动线仍需通过导出图人工复核。

## 资料来源

- [Animal Crossing Wiki: Island customization](https://animalcrossing.fandom.com/wiki/Island_customization)
- [Nookipedia: Bridge](https://nookipedia.com/wiki/Bridge)
- [Nookipedia: Incline](https://nookipedia.com/wiki/Incline)
- [Game8: Bridge size and placement](https://game8.co/games/Animal-Crossing-New-Horizons/archives/284596)
- [Game8: Incline size and placement](https://game8.co/games/Animal-Crossing-New-Horizons/archives/286502)
- [Game8: Building and plot sizes](https://game8.co/games/Animal-Crossing-New-Horizons/archives/297396)
- [Game8: Cliff limitations](https://game8.co/games/Animal-Crossing-New-Horizons/archives/316295)
- [Game8: Tree spacing](https://game8.co/games/Animal-Crossing-New-Horizons/archives/287143)
- 项目实现：`app/tools/amenities.ts`、`app/tools/structure.ts`、`app/tools/construction.ts`、`app/tools/tree.ts`
