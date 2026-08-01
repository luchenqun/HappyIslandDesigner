# Repository Guidelines

## Project Structure & Module Organization

应用源码位于 `app/`：入口是 `app/index.ts`，React 模态框集中在 `app/components/`，画布交互位于 `app/ui/` 与 `app/tools/`，通用函数放在 `app/helpers/`，翻译文件位于 `app/locales/`。图片、字体、SVG 和精灵图存放在 `static/`；`content/` 保存地图素材，`scripts/` 负责生成缓存。不要手工修改 `app/generated*Cache.ts`，应修改对应素材后运行生成脚本。构建产物写入 `dist/`，技术文档统一放在 `docs/`。

## Island Design Baseline

`origin-island.json` 是用户提供的原始岛屿，也是以后所有新岛屿设计的唯一基准。开始设计前必须完整读取并复制该文件，在副本上修改；不得从空白地图重建，不得覆盖原文件，除非用户明确要求。保持 `version: "v2"`、`112 × 96` 坐标系、原始海岸轮廓及所有固定设施。当前可直接校验的固定对象为服务处/广场 `amenities_townhallSprite: [53, 66]` 和码头 `amenities_dock: [104, 84]`。

每个完成的岛屿方案必须存放在 `design/`；目录不存在时先创建。文件采用从 `01` 开始的两位数字编号，并同时交付同名 JSON 和 PNG，例如 `design/01.json` 与 `design/01.png`。没有既有设计时使用 `01`，之后按现有最大编号加一；已有设计不得覆盖，编号超过 `99` 前先向用户确认新规则。JSON 必须是从 `origin-island.json` 派生的最终可加载数据，PNG 必须是在应用中加载该 JSON 后导出的对应成图，二者内容必须一致。不得只提交其中一个文件，也不得用界面截图代替地图导出图。

《集合啦！动物森友会》中，机场、服务处及广场、河流入海口、码头、海滩与海岸线、栈桥、半岛、秘密海滩和沿岸礁石不能通过岛屿创作家移动或改造。新方案必须原位保留这些元素。机场与河口在当前 JSON 中没有独立坐标字段，因此必须继承原始边界和河口端点，并通过加载渲染后的地图与原图对比确认；禁止猜测位置。内部河道、池塘和 `level1` 至 `level3` 地形可以重塑，但河流仍须连回原河口。其他住宅、商店、博物馆与露营地可重新规划。

设计时先锁定机场到服务处的入口视线，再划分住宅、商业、自然和活动区域。预留连续步道、建筑占地与操作空间；桥梁应跨越有效河道，坡道只连接相邻高度，避免无法步行到达的孤岛或高地。交付新岛屿前必须校验 JSON 可解析、固定对象坐标未变、河口与海岸未变，并在应用中加载检查通行性和设施重叠。

## Build, Test, and Development Commands

- `yarn`：安装锁定在 `yarn.lock` 中的依赖。
- `yarn dev`：先生成地图缓存，再启动 Webpack 开发服务器；访问 `http://localhost:8080/`。
- `yarn lint`：检查 `app/` 下的 JavaScript 和 TypeScript 文件。
- `yarn build`：重建缓存并生成生产包；提交前必须运行。
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
