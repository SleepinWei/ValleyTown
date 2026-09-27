# ValleyTown Agent pitch

12 页中文 16:9 Beamer 演示文稿，适合 8–10 分钟技术 pitch。内容快照：2026-09-27。

## 内容

1–6 页介绍 Agent 设计：Jev / DeepSeek / 本地 Harness 分工、单角色决策闭环、上下文边界、行动契约、对白校验与异步调度。

7–9 页介绍本项目真实 API 测试：将 Jev 职责替换成 DeepSeek 的系统对照、单个行为后端生效延迟、不同倍率下的压力测试。保留样本量、费用估算和统计口径限制；最高观测倍率不等于稳定性能极限。

10–12 页介绍已实现的行为、十种生活事件，以及约定、家庭、司法和天气带来的后续影响。

## 文件

- `valleytown.tex`：可编辑的正文、表格和版式。
- `figures/npc-agent-flow.tex`：第 3 页原生 TikZ 决策流程图。
- `assets/cover.png`：封面使用的项目截图。
- `speaker-notes.md`：逐页讲解、配时、事实范围及来源。
- `build.sh`：使用 XeLaTeX 编译两次。
- 最终 PDF：项目内 `output/slides/valleytown.pdf`。
- 源码包：项目内 `output/slides/valleytown-beamer-source.zip`。

旧版 21 页文稿和 PDF 保存在项目内 `output/slides/pre-pitch/`。

## 编译

需要 TeX Live / MacTeX，包含 XeLaTeX、ctex、beamer、Fandol、TeX Gyre、TikZ。无需专有中文字体、网络素材下载或 shell escape。

```sh
cd docs/slides
sh build.sh
```

默认生成 `build/valleytown.pdf`，也可指定输出目录：

```sh
sh build.sh /absolute/path/to/output
```

改动后检查编译日志中的 `Overfull`，并用 `pdftoppm -png -r 140 valleytown.pdf page` 渲染复核。正文和表格为可编辑 TeX，封面保持图像形式。

## 数据来源

性能数值取自 `docs/system-replacement-comparison.md`、`docs/current-system-live-measurement.md`、`docs/system-performance-limit.md` 及相应的 `output/system-measure/`、`output/system-stress/` 结果。本轮制稿没有重新调用付费 API。
