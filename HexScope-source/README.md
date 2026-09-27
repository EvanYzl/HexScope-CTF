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

## 4.1 r4 队列与并发

`src/scan-pool.js` 是分析 Worker 复用池，`src/app.js` 按逻辑处理器数量与活动数据内存预算调度队列，并将列表限定为每页 200 项 DOM，不限制队列条目数。刷新合并为约 150 毫秒一次；停止、重试和清空使用代次隔离，防止旧结果写回。

`desktop/forensics.cjs` 的 `analyzeBatch` 在同一个服务任务锁内并行启动只读 icat 进程；`children` 集合让取消覆盖全部进程。`src/disk.js` 按并发数和单批活动字节预算连续提交，没有单次推送的总量截断。IPC 和 preload 明确暴露此操作，不增加任意文件读取或命令执行接口。

新增 `scan-pool.test.cjs`、`queue-performance.test.cjs` 与 `transfer-performance.test.cjs` 共 15 项验证。r4 完整回归为 487 项；打包入口仍校验全部源码输入和正式 HTML，并在包内运行时复核并行 E01 读取。运行依赖和许可保持内置。

## 4.1 r5 预览读取修复

`desktop/preview-read.cjs` 提供独立的只读预览通道，`preload.cjs` 从真实 File 对象取得路径，`main.cjs` 注册主框架 IPC。校验来源大小、修改时间与读取期间的文件身份；停止任务会中断后续分块读取并关闭句柄。`preview/ui.js` 为当前预览保留字节快照，减少对浏览器原文件引用的依赖；生成字节与独立 HTML 仍走原有 File API。

新增 `tests/preview-read.test.cjs` 共 14 项验证，完整回归为 501 项。正式打包包含新模块，并在包内运行时核对常见预览文件的读取哈希。实际桌面文件选择、拖放及用户报错的原始文件尚未复现验证；边界记录在上级 `验证记录.md`。

## 4.1 r6 E01 推送文件预览

`desktop/preview-snapshots.cjs` 为实际镜像提取字节创建独立会话快照，`disk-ipc.cjs` 将快照编号、大小和 SHA-256 随提取结果传回。编号绑定已注册副本，不接受页面传入文件路径。快照读写与镜像任务锁独立；关闭镜像不会释放队列快照，清空队列或正常退出才清理副本。异常退出可能在系统临时目录留下本次快照，不自动清理其他运行实例的目录。

`src/disk.js` 将快照标识关联到队列文件，`preview/ui.js` 优先按快照编号读取并采用快照大小，不再从该文件的浏览器 File 引用读取或获取本机路径。`src/app.js` 分批释放清空队列的快照。新模块已加入正式打包清单；临时磁盘空间不足会作为该文件的推送失败明确记录。

`tests/preview-snapshots.test.cjs` 新增 10 项回归，完整测试为 511 项。测试串联真实 E01、正式 IPC/preload 代码、真实构建页面与 Worker，受控破坏生成 File 的读取方法，确认快照预览、关闭镜像后重载及释放流程；Electron IPC 与窗口本身仍使用模拟。
