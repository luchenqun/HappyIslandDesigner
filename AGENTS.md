# Repository Guidelines

## Project Structure & Module Organization

应用源码位于 `app/`：入口是 `app/index.ts`，React 模态框集中在 `app/components/`，画布交互位于 `app/ui/` 与 `app/tools/`，通用函数放在 `app/helpers/`，翻译文件位于 `app/locales/`。图片、字体、SVG 和精灵图存放在 `static/`；`content/` 保存地图素材，`scripts/` 负责生成缓存。不要手工修改 `app/generated*Cache.ts`，应修改对应素材后运行生成脚本。构建产物写入 `dist/`，技术文档统一放在 `docs/`。

## Island Design Baseline

设计岛屿前必须完整阅读 `docs/island-design-rules.md`。`origin-island.json` 是以后所有新岛屿设计的唯一基准；先复制再修改，不得从空白地图重建或覆盖原文件。保持 `version: "v2"`、`112 × 96` 坐标系、原始 `edgeTiles`、海岸边缘、河口、机场、服务处/广场 `amenities_townhallSprite: [53, 66]` 和码头 `amenities_dock: [104, 84]`。

每个完成的岛屿方案必须存放在 `design/`；目录不存在时先创建。文件采用从 `01` 开始的两位数字编号，并同时交付同名 JSON 和 PNG，例如 `design/01.json` 与 `design/01.png`。没有既有设计时使用 `01`，之后按现有最大编号加一；已有设计不得覆盖，编号超过 `99` 前先向用户确认新规则。JSON 必须是从 `origin-island.json` 派生的最终可加载数据，PNG 必须按应用保存逻辑由该 JSON 直接导出，二者内容必须一致。不得只提交其中一个文件，也不得用界面截图代替地图导出图。

生成 PNG 时直接运行 `yarn render-island-design -- design/01.json design/01.png`。该命令复用项目的地形颜色、V2 边缘路径、网格、对象精灵和 PNG 隐写格式，通过无头 Chrome 将 JSON 直接渲染为图片；不要为导出启动 `yarn dev`，也不要自行绘制示意图。完成后运行 `yarn validate-island-design -- origin-island.json design/01.json design/01.png`，确认固定位置、图像内容和内嵌 JSON 一致。

《集合啦！动物森友会》中不可移动的沿岸元素由 `edgeTiles` 编码，必须整体继承；河口通过 `level1` 水域端点校验。内部河道、池塘和 `level1` 至 `level3` 地形可以重塑，但河流仍须连回原河口。对象坐标是占地矩形左上角，不是中心点；镜像对象必须按 `112 - 对象宽度 - x` 计算。

设计时先锁定机场到服务处的入口视线，再划分住宅、商业、自然和活动区域。四种道路图层必须位于陆地且避开建筑与桥坡占地；横桥必须覆盖连续 `4×4` 河面及两岸落脚区，坡道固定 `2×4` 并连接相邻高度。树木周围保留一格生长空间。交付前必须运行设计校验，并在导出图中人工检查通行性与主题布局。

## Build, Test, and Development Commands

- `yarn`：安装锁定在 `yarn.lock` 中的依赖。
- `yarn dev`：先生成地图缓存，再启动 Webpack 开发服务器；访问 `http://localhost:8080/`。
- `yarn lint`：检查 `app/` 下的 JavaScript 和 TypeScript 文件。
- `yarn build`：重建缓存并生成生产包；提交前必须运行。
- `yarn render-island-design -- design/01.json design/01.png`：无需 Web 服务，按应用保存格式将 JSON 直接导出为 PNG。
- `yarn validate-island-design -- origin-island.json design/01.json design/01.png`：校验固定设施、河口、PNG 与内嵌 JSON。
- `python -m http.server 8000`：从仓库根目录静态检查生产页面及相对资源路径。
- `yarn generate-tiles-cache` / `yarn generate-base-map-cache`：素材变化后单独刷新对应缓存。

## Coding Style & Naming Conventions

TypeScript/TSX 使用 2 空格缩进、单引号、尾随逗号和 ES module `import`/`export`；新增 JavaScript/TypeScript 脚本也只使用 ES module。遵循 ESLint 与仓库 `prettier` 配置。React 组件及文件使用 `PascalCase`，函数、变量和 helper 文件使用 `camelCase`，语言文件使用现有区域标签格式（如 `zh-CN.ts`）。避免顺带格式化无关代码。

## Testing Guidelines

仓库当前没有自动化测试框架或覆盖率门槛。每次变更至少运行 `yarn lint` 和 `yarn build`，并在开发服务器中手工验证受影响流程。画布、工具栏、地图保存/加载或响应式 UI 变更需覆盖桌面与移动尺寸；可见 UI 变化应在 PR 中附前后截图。

## Commit & Pull Request Guidelines

历史提交多为简短英文祈使句；新提交统一使用英文 Conventional Commits，例如 `fix: close settings modal on first click`。分支采用 `type/short-description`，例如 `feat/map-import-preview`。PR 标题和正文使用简短英文，说明行为变化、验证命令与关联 issue；涉及 UI、地图数据格式或生成资源时，注明兼容性影响并附截图或样例。

## Documentation & Agent Notes

新增文档优先放入 `docs/`，使用英文文件名和中文 Markdown 内容。路径说明优先写仓库相对路径。修改应聚焦当前任务，并保留工作区中无关的未提交文件。
