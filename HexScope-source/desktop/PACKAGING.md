# Windows portable packaging

The distributed Windows app includes Electron 44.4.5 win32-x64. End users need no Python, Node.js, npm, browser, or installer.

To rebuild the desktop package as a developer:

1. Run `node build.cjs` from the `HexScope-source` directory to create the sibling `HexScope.html`.
2. Download `electron-v44.4.5-win32-x64.zip` and `SHASUMS256.txt` from the [official Electron release](https://github.com/electron/electron/releases/tag/v44.4.5).
3. Check the ZIP SHA-256 against the published record. For the release used here the digest is `11c395820a5aaa8ebcc0686b476d0ac98a730274ebfbdc8cf5538a7c2815cb5d`.
4. Extract the entire runtime into a new distribution folder. Rename `electron.exe` to `HexScope-CTF.exe`.
5. Create `resources/app`. Copy `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/disk-ipc.cjs`, `desktop/forensics.cjs`, `desktop/hashing.cjs`, `desktop/vhd.cjs`, `desktop/windows-mount.cjs`, `desktop/mount-helper.ps1`, `desktop/vendor/` (including hash-wasm and licenses), `desktop/package.json`, and the built `HexScope.html` there.
6. Retain the Electron `LICENSE` and `LICENSES.chromium.html`. Copy application documentation and the vendored library licenses into the distribution.
7. ZIP the complete directory. Do not distribute just the `.exe`; it needs the adjacent runtime resources.

For version 4.1, also copy the `desktop/engines/tsk` directory to `resources/app/engines/tsk`, retaining all DLL dependencies recorded in `ENGINE_INFO.json`, licenses, and the engine record itself. The app only invokes seven fixed TSK commands: img_stat, img_cat, mmls, fls, icat, fsstat and istat, invoked without a shell. The separate drive-letter feature uses a fixed Windows PowerShell helper and the built-in Storage module. `engines/upstream-source` contains corresponding upstream source archives and their provenance.

The upstream TSK archive is `sleuthkit-4.15.0-win32.zip`, SHA-256 `c2ebab8105b893d97bd8ce35b88e01985e2a106efc97f03adf95840a631b20ce`, from the official GitHub release. Its x86 helper programs work under Windows x64. It contains libewf 20130416, libvhdi 20240303, libvmdk 20240529 and zlib 1.2.11. The programs used here have one packaging modification: `enable-utf8.ps1` adds the UTF-8 activeCodePage setting to their existing embedded manifests. Machine code and DLLs are unchanged. Both the upstream archive hash and final helper-file hashes are recorded. If replacing the engine, run this build-time patch on the seven executables before packaging. Supported target OS: Windows 10 1903+ or Windows 11 x64.

The renderer has no Node.js integration. The sandboxed preload exposes only bounded image operations; the main process validates the requesting top frame and its exact bundled file URL. Context isolation and sandboxing are enabled. External navigation, new windows, webviews, runtime network requests, and permission requests are denied. Image selection and export use explicit native file dialogs; individual analysis downloads retain the standard save dialog.

Developer verification: `npm ci`, `npm test`, and `npm run test:ui`. Native tests require Windows and use the packaged engine plus synthetic FAT16, RAW and split-E01 fixtures. jsdom tests exercise actual engine reads and the actual analysis worker with mocked UI surfaces. Set `HEXSCOPE_TEST_TMP` to an absolute scratch directory if desired. Fixture creation scripts under `tests` are development tools; Python is not a runtime dependency. Drive-letter mounting uses Windows PowerShell and Storage cmdlets supplied by Windows; no separate installation is needed.

The default profile directory is `portable-data` beside the executable. On a read-only volume, the program creates a temporary profile instead. No installer or file associations are required. Drive-letter assignment uses the Windows storage manager and requires administrator approval.

The custom application has not been code-signed. Automated tests cover core logic and mocked desktop configuration; a real desktop launch was not automated in the development session because the available browser automation policy blocked local HTML navigation. Verify window rendering, native file selection, drag-and-drop, worker startup and save dialogs on target systems before wider distribution.


Hash verification must also run under the actual Electron runtime. Its BoringSSL differs from development Node/OpenSSL. SHA-3, BLAKE2 and SM3 use the bundled incremental hash-wasm module, validated against independent Python vectors. Use `ELECTRON_RUN_AS_NODE=1` and `-e "require('./tests/hash.test.cjs')"` from the source directory; this checks the CLI backend and does not launch a GUI.

VHD conversion retains all acquired bytes and adds a 512-byte fixed-VHD footer. It supports 512-byte logical sectors and at most 2040 GiB. The system helper must always mount with `-Access ReadOnly -NoDriveLetter`, verify read-only state, and roll back newly attached images if assignment fails. Tests do not elevate privileges or mount actual disks. Windows `Get-DiskImage` recognition is tested without elevation.
