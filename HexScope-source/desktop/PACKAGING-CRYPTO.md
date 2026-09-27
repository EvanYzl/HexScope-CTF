# 4.1 密码集成版的重建与打包

以下是开发流程。运行成品只需解压整个 Windows x64 便携目录并打开 `HexScope-CTF.exe`，无需安装任何开发环境。

开发需要 Windows x64、Node.js 22.13+、Python 3.11+（仅标准库），以及仅供测试的 jsdom 26.1.0 和 @napi-rs/canvas 1.0.9。从源码根目录开始：

```powershell
npm ci --ignore-scripts
node build.cjs
npm test
```

构建从当前 `src/template.html` 出发，输出上级目录的 `HexScope.html` 与 `HexScope.build.json`，并把密码模块全部内嵌。后者记录所有构建输入的 SHA-256，测试发现过期构建会直接失败。`npm test` 同样先构建，完整日志和 JSON 写入上级 `集成验证`。

打包前准备两个官方发行 ZIP；脚本拒绝哈希不一致的输入：

| 组件 | 下载地址 | SHA-256 |
|---|---|---|
| Electron 44.4.5 win32-x64 | https://github.com/electron/electron/releases/download/v44.4.5/electron-v44.4.5-win32-x64.zip | `11c395820a5aaa8ebcc0686b476d0ac98a730274ebfbdc8cf5538a7c2815cb5d` |
| The Sleuth Kit 4.15.0 win32 | https://github.com/sleuthkit/sleuthkit/releases/download/sleuthkit-4.15.0/sleuthkit-4.15.0-win32.zip | `c2ebab8105b893d97bd8ce35b88e01985e2a106efc97f03adf95840a631b20ce` |

```powershell
python desktop/package-portable.py --runtime-zip C:/build-inputs/electron-v44.4.5-win32-x64.zip --tsk-zip C:/build-inputs/sleuthkit-4.15.0-win32.zip --scratch C:/build-work
```

也可用 `npm run package:portable -- --runtime-zip ... --tsk-zip ...`。路径中有空格需加引号。`--node` 可指定开发用 Node 的绝对路径；`--output-dir` 可指定交付目录。所需说明、示例和单文件 HTML 默认在源码目录上一层，保持源码 ZIP 的目录结构即可。

打包默认先运行完整集成测试。可用 `--verified-report 上级/集成验证/自动化测试.json` 复用本次测试，但脚本必须逐项校验源码和 HTML 哈希；修改代码后无法复用旧报告。

打包脚本会：

1. 核对 Electron、TSK 发行包以及所用 24 个原生组件，确认 DLL 未变、EXE 机器代码未变；EXE 仅含原有 UTF-8 清单补丁。
2. 在全新临时目录复制完整运行组件、内嵌 HTML、镜像引擎、hash-wasm、密码组件许可证、题型说明和示例。
3. 使用包内 Electron 的 `ELECTRON_RUN_AS_NODE=1` 模式执行全部 78 个密码示例、3 个自动分析示例，以及真实 E01、源盘 / 文件哈希、文件推送、VHD 转换和 Windows 只读状态查询。PATH 仅保留 Windows 系统目录。
4. 检查 ZIP CRC、运行文件与源码一致性，生成便携 ZIP、源码 ZIP 和 `SHA256SUMS-4.1-GitHub.txt`。

它不申请 UAC、不分配真实盘符、不打开桌面窗口；这些项目不在自动验证结论中。临时构建目录保留供检查，不删除任何既有便携目录或其中的用户设置。两个交付 ZIP 使用固定新文件名；再次运行将更新这些 ZIP。

`runtime-smoke.cjs` 是开发校验脚本，未成为产品运行依赖。开发脚本、锁文件和测试在源码包中；用户成品不依赖 npm、Python、Java 或外部命令环境。

## 软件图标

`assets/icon-source.jpg` 是用户提供的原始图。`generate-icon.ps1` 只做保持全图的等比例尺寸与ICO/PNG格式转换；产物为九种尺寸的 `assets/hexscope.ico` 和用于HTML的 `assets/hexscope.png`。原图和产物摘要记录在 `assets/ICON_INFO.json`。

如需更换图片，替换原图，运行 `powershell -NoProfile -File desktop/generate-icon.ps1`，更新 `ICON_INFO.json` 的文件SHA-256，再构建和测试。正常重建直接使用随源码附带的图标，不需要图像处理软件。

正式打包时运行 `set-icon.ps1` 修改新发行目录内EXE的RT_ICON / RT_GROUP_ICON资源，逐字节读回复核，并让Windows解码全部九个尺寸，随后核对机器代码段未变。原有Electron发行ZIP保持原始状态。窗口由 `BrowserWindow.icon` 指向同一ICO；单文件HTML内嵌PNG favicon。

实现依据：[Microsoft资源文件格式](https://learn.microsoft.com/en-us/windows/win32/menurc/resource-file-formats)、[UpdateResourceW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-updateresourcew)、[Electron图标格式与尺寸](https://www.electronjs.org/docs/latest/api/native-image)。新EXE未重新签名。Windows可能缓存同一路径下旧图标；解压到新文件夹可避免沿用旧快捷方式的缓存。

## 文件预览增强版

同一打包入口现在同时编入 `preview/`。所有解析器、PDF Worker、CMap、字体及 WASM 已在 HTML 中；第三方许可和归档另外放在 `licenses-and-libraries/preview`。产物文件名为 `HexScope-CTF-4.1-GitHub-Windows-x64-Portable.zip` 和 `HexScope-CTF-4.1-GitHub-Source-and-Offline.zip`，校验文件为 `SHA256SUMS-4.1-GitHub.txt`。

验证入口在原有 425 项上增加预览回归；便携运行时冒烟额外调用 `preview/runtime-smoke.cjs`，只读取包内 HTML 和 `示例文件/12_文件预览`。它验证 DOCX、Excel 与 PDF 文本计算，不代表真实窗口已做人工验收。

## 署名与 GitHub 发布

`desktop/branding.json` 统一保存作者、署名及仓库地址，随桌面应用打包。首页、页脚、关于面板、窗口标题、构建清单与快速开始说明均保留署名。源码 ZIP 另含中文 README、作者与贡献说明、Windows CI 模板（未启用 Actions）及中文问题模板。

打包只收集明确列出的源码、文档和合成示例；不会收集工作目录根部的个人镜像或历史便携目录。发布时从源码 ZIP 单独建立仓库；软件 ZIP 通过 Releases 分发。
