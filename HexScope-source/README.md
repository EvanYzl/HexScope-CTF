# HexScope CTF 4.1 source

**Created by 是羊羊羊呀** · [项目主页](https://github.com/EvanYzl/HexScope-CTF) · [中文项目说明](../README.md)

中文使用说明位于上级目录 `使用说明.md`。成品 `HexScope.html` 是可独立使用的离线文件，无运行时 npm 依赖。

- `src/core.js`：签名识别、格式解析、候选扫描、CRC、ZIP 打包/成员解压。可在 Node 中 `require()` 使用。
- `src/app.js`：批量队列、DOM 事件、十六进制与导出流程。
- `src/ctf.js` / `src/extra.js`：EXIF/GPS、编码、字符串、原始像素及 LSB 工具。
- `src/stego.js`：PNG CRC / 尺寸 / 调色板、ZIP 伪加密、零宽 / 空白 / Base64 填充位、图像运算。
- `src/audio.js`：原始整数 PCM WAV、FFT 频谱 / 波形、采样 LSB、DTMF、倒放与声道变换。
- `src/animation.js`：GIF / APNG 原始局部帧检查、导出及布局清单。
- `src/lab.js`：六类专项隐写的界面与结果 / 报告导出。
- `vendor/`：随成品内置的 exifr / fflate UMD 文件和原始许可证。
- `desktop/`：Windows 免安装版 Electron 启动配置；运行时不向页面暴露 Node.js。
- `src/worker.js`：耗时分析、打包和解压的 Web Worker。
- `src/template.html` / `src/style.css`：中文界面及样式。
- `build.cjs`：把代码及样式嵌入单个 HTML，无外部资源。
- `tests/core.test.cjs`：44 项解析与提取测试。
- `tests/ui.test.cjs`：32 项 DOM / 事件逻辑测试，模拟 Worker 消息及 Canvas API；不是浏览器渲染测试。
- `tests/ctf.test.cjs`：32 项编码、压缩、元数据、GPS 和像素检查。
- `tests/stego.test.cjs`：42 项专项算法与异常输入测试。
- `tests/desktop.test.cjs`：4 项桌面配置与屏幕边界测试。
- `tests/fixtures/`：为测试生成的无隐私图片、ZIP、文本、PCM WAV 和动图样本。

```sh
npm ci --ignore-scripts
node build.cjs
npm test
```

Node.js 22.13+；`jsdom` 和 `@napi-rs/canvas` 仅供开发测试。所有解析偏移都是绝对偏移，采用 `[start, end)`。`verified` 表示本工具实现的结构规则通过，不表示完整解码或隐写意图得到证明。


## 4.1 桌面模块

- `desktop/forensics.cjs`：只读镜像读取、目录推送与流式提取。
- `desktop/hashing.cjs`：12 种增量哈希；完整读取、字节数和来源变化校验。
- `desktop/vendor/`：hash-wasm 4.12.0 原始发行文件、MIT 许可、源码发行包及完整性记录。
- `desktop/vhd.cjs`：将解码数据写入固定 VHD，追加标准文件尾并复核。
- `desktop/windows-mount.cjs`、`mount-helper.ps1`：请求 Windows 管理员授权，只读挂载、分配盘符和卸载。
- `src/disk.js`、`hash.js`、`mount.js`：对应界面与任务互斥。
- `tests/hash.test.cjs`、`vhd.test.cjs`、`hash-mount-ui.test.cjs`：新增流程与原生组件回归；挂载脚本的存储操作使用模拟。

测试使用 Windows 上的原生组件。开发测试需 Node.js 22.13+ 和 jsdom；用户运行便携版不需安装这些环境。
盘符挂载使用 Windows 自带 Windows PowerShell 5.1 / Storage 模块，挂载与卸载需管理员授权；没有安装额外驱动。
图形渲染、真实 UAC 和真实盘符挂载未在此开发会话实测，详见上级目录 `验证记录.md`。

## 4.1 密码模块正式集成

`crypto/` 包含完整算法、启发式搜索、Worker、78 项工具目录、界面、第三方发行文件、锁文件、许可证和测试。构建入口已接入当前 4.1 模板，不依赖旧版生成页面。顶层 `HexApp.showWorkspace` 统一五个工作区的按钮、镜像拖入和程序跳转。

`npm test` 先构建，再执行原有 216 项、密码 197 项和集成 12 项测试，保存日志及输入 SHA-256。算法、Worker 和密码 UI 读取真实构建产物；测试辅助文件校验产物及源码是否一致。`npm run test:crypto` 可单独运行密码相关用例。

`test-all.cjs` 是可重复的完整验证入口。`desktop/package-portable.py` 是正式打包入口，文档见 `desktop/PACKAGING-CRYPTO.md`；脚本还在包内 Electron 中再次运行全部密码入口及原生镜像、哈希和 VHD 冒烟检查，然后生成 ZIP 与 SHA-256 清单。

便携包中的所有运行依赖均随包内置。仅开发重建需要 Node.js、jsdom 和用于打包的 Python 标准库。原始侧线程模块保留不变，历史验证位于 `crypto/history` 并明确不作为本次集成结论。

用户指定的软件图标在 `desktop/assets`，保留原图、九尺寸ICO、PNG及SHA-256记录。`desktop/generate-icon.ps1` 和 `desktop/set-icon.ps1` 提供资产转换及EXE资源更新，已接入正式打包流程；详见 `desktop/PACKAGING-CRYPTO.md`。

## 4.1 文件预览增强

正式源码位于 `preview/`，随主构建内嵌所有 Office / PDF 解析器、字体与解码资源。预览不要求用户安装 Office；接口、测试和供应商重建方法见 `preview/README.md`。

`npm test` 在原有 425 项基础上再运行预览测试，确切总数见生成的验证报告。`npm run test:preview` 单独运行预览验证。正式打包脚本生成 `4.1-GitHub` 便携与源码 ZIP，保留密码 78 项工具、自定义图标及原生镜像能力。

项目署名统一保存在 `desktop/branding.json`。HTML 构建、桌面窗口和便携包读取这一配置；`src/branding.css` 提供首页、页脚与关于面板的样式。源码 ZIP 包含 Windows CI 模板（`desktop/windows-test.example.yml`，当前未启用 Actions）及中文问题模板，便于后续维护。

## 4.1 r3 桌面布局

`src/shell.css` 是最后载入的工作台布局层，统一视口、工作区、列表和详情的滚动边界。`src/template.html` 采用紧凑导入与统计栏，并把队列大小/排序设置放入可展开区；相关筛选状态由 `src/app.js` 更新。窗口尺寸由 `desktop/main.cjs` 使用当前显示器工作区计算。布局测试采用 DOM 状态与桌面 API 模拟，没有声称真实窗口像素验收。
