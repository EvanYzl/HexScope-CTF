"""Rebuild, verify and package HexScope 4.1 including the offline crypto module.

Developer tool only. End users run the included EXE without Python or Node.
All paths are explicit or relative to this source tree; no old HTML base is used.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, struct, subprocess, tempfile, zipfile

SOURCE = Path(__file__).resolve().parents[1]
LOCK = {
    'electron': {'version': '44.4.5', 'sha256': '11c395820a5aaa8ebcc0686b476d0ac98a730274ebfbdc8cf5538a7c2815cb5d',
                 'url': 'https://github.com/electron/electron/releases/download/v44.4.5/electron-v44.4.5-win32-x64.zip'},
    'tsk': {'version': '4.15.0', 'sha256': 'c2ebab8105b893d97bd8ce35b88e01985e2a106efc97f03adf95840a631b20ce',
            'url': 'https://github.com/sleuthkit/sleuthkit/releases/download/sleuthkit-4.15.0/sleuthkit-4.15.0-win32.zip'}
}
DOCS = ['使用说明.md', '镜像功能说明.md', '哈希与盘符挂载说明.md', '新增题型与示例.md', '验证记录.md',
        'THIRD_PARTY_NOTICES.md', '密码分析使用说明.md', '题型覆盖与限制.md', '密码模块第三方许可.md', '4.1密码模块更新说明.md',
        '文件预览说明.md', '4.1文件预览更新说明.md', '文件预览第三方许可.md',
        'README.md', 'AUTHORS.md', 'CONTRIBUTING.md', 'CHANGELOG.md']
APP_FILES = ['main.cjs', 'preload.cjs', 'disk-ipc.cjs', 'preview-read.cjs', 'forensics.cjs', 'hashing.cjs', 'vhd.cjs',
             'windows-mount.cjs', 'mount-helper.ps1', 'package.json', 'branding.json', 'enable-utf8.ps1']
REPO_FILES = ['.gitignore', '.gitattributes',
              '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml']
VERIFICATION_FILES = {'自动化测试.json', '自动化测试.log', '便携运行时验证.json', '便携运行时验证.log',
                      '图标资源验证.log', '源码保留核对.json', '预览源码保留核对.json'}

def digest(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def code_sections(data):
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    n = struct.unpack_from('<H', data, pe + 6)[0]
    off = pe + 24 + struct.unpack_from('<H', data, pe + 20)[0]
    sections = {}
    for i in range(n):
        p = off + i * 40
        if struct.unpack_from('<I', data, p + 36)[0] & 0x20:
            length, start = struct.unpack_from('<II', data, p + 16)
            sections[data[p:p + 8]] = data[start:start + length]
    return sections

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-zip', type=Path, required=True)
    parser.add_argument('--tsk-zip', type=Path, required=True)
    parser.add_argument('--node', default=shutil.which('node') or 'node')
    parser.add_argument('--output-dir', type=Path, default=SOURCE.parent)
    parser.add_argument('--scratch', type=Path)
    parser.add_argument('--verified-report', type=Path, help='Reuse a successful test-all.cjs report only if every recorded input still matches')
    args = parser.parse_args()
    require(os.name == 'nt', 'The full native validation and this release target require Windows x64.')
    out = args.output_dir.resolve(); out.mkdir(parents=True, exist_ok=True)
    docs_root = SOURCE.parent
    for p, key in [(args.runtime_zip, 'electron'), (args.tsk_zip, 'tsk')]:
        require(digest(p) == LOCK[key]['sha256'], 'Unexpected archive: ' + str(p))
    if args.scratch:
        args.scratch.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix='hexscope-4.1-github-', dir=args.scratch)).resolve()
    verification = out / '集成验证'; verification.mkdir(exist_ok=True)
    env = dict(os.environ, HEXSCOPE_TEST_TMP=str(scratch / 'tests'), PYTHONIOENCODING='utf-8')
    if args.verified_report:
        report_path = args.verified_report.resolve()
    else:
        subprocess.run([args.node, str(SOURCE / 'test-all.cjs'), str(verification)], cwd=SOURCE, env=env, check=True)
        report_path = verification / '自动化测试.json'
    report = json.loads(report_path.read_text(encoding='utf8'))
    require(report['version'] == '4.1.0' and report['edition'] == 'crypto-integrated', 'Wrong build was tested')
    require(report['tests'] == report['passed'] and report['tests'] >= 461 and not any(report[k] for k in ['failed','cancelled','skipped']), 'Incomplete integration tests')
    html = docs_root / 'HexScope.html'
    require(report['htmlSHA256'] == digest(html), 'Tested HTML differs; run tests again')
    for name, expected in report['inputs'].items():
        require(digest(SOURCE / name) == expected, 'Source changed after verification: ' + name)
    if report_path != verification / '自动化测试.json':
        shutil.copy2(report_path, verification / '自动化测试.json')
        shutil.copy2(report_path.with_name('自动化测试.log'), verification / '自动化测试.log')

    engines = SOURCE / 'desktop/engines'
    record = json.loads((engines / 'tsk/ENGINE_INFO.json').read_text(encoding='utf8')); keep = set(record['checkedFiles'])
    with zipfile.ZipFile(args.tsk_zip) as z:
        for name, meta in record['checkedFiles'].items():
            p = next(x for x in (engines / 'tsk/bin').iterdir() if x.name.lower() == name)
            data = p.read_bytes(); require(digest(p) == meta['sha256'], 'Native component changed: ' + name)
            original = z.read('sleuthkit-4.15.0-win32/bin/' + p.name)
            require(original == data if name.endswith('.dll') else code_sections(original) == code_sections(data), 'Native code differs from upstream: ' + name)
    def ship_engine(relative):
        if relative.parts[:2] == ('tsk', 'bin'): return relative.name.lower() in keep
        return relative.parts[:2] != ('tsk', 'lib')

    branding = json.loads((SOURCE / 'desktop/branding.json').read_text(encoding='utf8'))
    name = 'HexScope-CTF-4.1-GitHub-Windows-x64'; target = scratch / name; target.mkdir()
    with zipfile.ZipFile(args.runtime_zip) as z:
        for member in z.namelist():
            require((target / member).resolve().is_relative_to(target), 'Unsafe archive member')
        z.extractall(target)
    (target / 'electron.exe').rename(target / 'HexScope-CTF.exe')
    binary = (target / 'HexScope-CTF.exe').read_bytes(); pe = struct.unpack_from('<I', binary, 0x3c)[0]
    require(binary[pe:pe+4] == b'PE\0\0' and struct.unpack_from('<H', binary, pe+4)[0] == 0x8664, 'Runtime is not Windows x64')
    assets = SOURCE / 'desktop/assets'
    icon_record = json.loads((assets / 'ICON_INFO.json').read_text(encoding='utf8'))
    for asset, expected in icon_record['files'].items():
        require(digest(assets / asset) == expected, 'Icon asset differs from its provenance: ' + asset)
    powershell = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    icon_update = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        str(SOURCE / 'desktop/set-icon.ps1'), '-Executable', str(target / 'HexScope-CTF.exe'), '-Icon', str(assets / 'hexscope.ico')],
        capture_output=True, encoding='utf8', errors='replace', creationflags=0x08000000, timeout=60)
    (verification / '图标资源验证.log').write_text(icon_update.stdout + icon_update.stderr, encoding='utf8')
    require(icon_update.returncode == 0, 'Executable icon update failed: ' + icon_update.stderr)
    require(code_sections(binary) == code_sections((target / 'HexScope-CTF.exe').read_bytes()), 'Icon update altered runtime machine code')
    app = target / 'resources/app'; app.mkdir(parents=True, exist_ok=True)
    for item in APP_FILES: shutil.copy2(SOURCE / 'desktop' / item, app / item)
    shutil.copy2(html, app / 'HexScope.html'); shutil.copy2(docs_root / 'HexScope.build.json', app / 'HexScope.build.json')
    shutil.copytree(SOURCE / 'desktop/vendor', app / 'vendor')
    shutil.copytree(assets, app / 'assets')
    for p in engines.rglob('*'):
        if p.is_file() and ship_engine(p.relative_to(engines)):
            dest = app / 'engines' / p.relative_to(engines); dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(p, dest)
    for item in DOCS: shutil.copy2(docs_root / item, target / item)
    # The portable archive has runtime files, while the full source is a separate download.
    readme = (target / 'README.md').read_text(encoding='utf8')
    readme = readme.replace('src="HexScope-source/desktop/assets/hexscope.png"', 'src="resources/app/assets/hexscope.png"')
    readme = readme.replace('](HexScope-source/', '](' + branding['repository'] + '/blob/main/HexScope-source/')
    (target / 'README.md').write_text(readme, encoding='utf8')
    shutil.copytree(SOURCE / 'vendor', target / 'licenses-and-libraries')
    shutil.copytree(SOURCE / 'crypto/vendor', target / 'licenses-and-libraries/crypto/vendor')
    shutil.copy2(SOURCE / 'crypto/THIRD_PARTY_NOTICES.md', target / 'licenses-and-libraries/crypto/THIRD_PARTY_NOTICES.md')
    shutil.copytree(SOURCE / 'preview/vendor', target / 'licenses-and-libraries/preview/vendor')
    shutil.copy2(SOURCE / 'preview/THIRD_PARTY_NOTICES.md', target / 'licenses-and-libraries/preview/THIRD_PARTY_NOTICES.md')
    shutil.copytree(docs_root / '示例文件', target / '示例文件')
    (target / '快速开始.txt').write_text(
        'HexScope CTF 4.1 · 文件预览增强版（含 78 项密码工具）\n'
        + branding['credit'] + '\n' + branding['repository'] + '\n\n解压整个目录后双击 HexScope-CTF.exe。移动时复制整个文件夹。\n'
        '适用 Windows 10 1903+ / Windows 11 x64，无需安装 Python、Node.js、Java 或额外运行环境。\n'
        '密码分析：78 个工具入口、有限预算多层分析、转换路径、停止、报告和原始字节回送。全部本地离线运行。\n'
        '文件预览：在文件分析里选择文件，点击「文件预览」。支持 DOCX、Excel、PDF、图片、文本及部分音视频。无需安装 Office。\n'
        '镜像提取与密码分析恢复的文件同样可预览；Office/PDF 格式范围、预览大小限制见文件预览说明.md。\n'
        '保留文件分析、EXIF/GPS、文件树与大小筛选、E01 浏览、12 种源盘/单文件哈希、VHD 转换和只读盘符流程。\n'
        'VHD 转换需要接近源盘容量的空间，挂载/卸载请求 Windows 管理员授权。未安装额外驱动。\n'
        '自动候选分不是正确率；现代密码和高级题型需要密钥或样本，详见题型覆盖与限制.md。\n'
        '真实桌面渲染、UAC 和实际分配盘符尚未实测，详见验证记录.md。\n'
        '设置保存在 portable-data；目标目录不可写时回退到系统临时目录。\n', encoding='utf-8-sig')

    # Exercise only packaged assets with the packaged Electron; no external Node/Python in PATH.
    smoke_output = verification / '便携运行时验证.json'
    code = 'require(' + json.dumps(str(SOURCE / 'desktop/runtime-smoke.cjs')) + ').main(' + json.dumps({
        'directory': str(target), 'scratch': str(scratch / 'runtime-smoke'), 'output': str(smoke_output)
    }) + ').catch(e=>{console.error(e);process.exitCode=1;});'
    smoke_env = dict(env, ELECTRON_RUN_AS_NODE='1', PATH=os.environ['WINDIR'] + r'\System32;' + os.environ['WINDIR'])
    smoke = subprocess.run([str(target / 'HexScope-CTF.exe'), '-e', code], env=smoke_env, capture_output=True, encoding='utf8', errors='replace', timeout=120)
    (verification / '便携运行时验证.log').write_text(smoke.stdout + smoke.stderr, encoding='utf8')
    require(smoke.returncode == 0 and smoke_output.exists(), 'Packaged runtime failed:\n' + smoke.stdout + smoke.stderr)
    runtime_result = json.loads(smoke_output.read_text(encoding='utf8'))
    require(runtime_result['htmlSHA256'] == digest(html), 'Wrong runtime HTML')
    public_verification = docs_root / '验证'; public_verification.mkdir(exist_ok=True)
    for report_name in ['自动化测试.json', '便携运行时验证.json']:
        shutil.copy2(verification / report_name, public_verification / report_name)
    shutil.copytree(public_verification, target / '验证')
    (target / '集成验证').mkdir()
    for p in verification.iterdir():
        if p.is_file() and p.name in VERIFICATION_FILES:shutil.copy2(p,target/'集成验证'/p.name)
    info = {'application': 'HexScope CTF', 'version': '4.1.0', 'edition': 'crypto-integrated', 'cryptoTools':78, 'filePreview':True,
            'author':branding['author'], 'credit':branding['credit'], 'repository':branding['repository'],
            'platform':'Windows 10 1903+ / Windows 11 x64', 'archives':LOCK, 'htmlSHA256':digest(html),
            'tests':{k:report[k] for k in ['tests','passed','failed','cancelled','skipped']},
            'nativeFilesDependencyAudited':len(keep), 'nativeCodeAndDLLsMatchUpstream':True,
            'applicationIcon':icon_record, 'executableSHA256':digest(target / 'HexScope-CTF.exe'),
            'executableModification':'User-provided icon resources replaced; runtime machine code unchanged; no custom signing.',
            'runtimeVerification':runtime_result, 'customAppDigitallySigned':False}
    (target / 'BUILD_INFO.json').write_text(json.dumps(info, ensure_ascii=False, indent=2)+'\n', encoding='utf8')

    portable = out / (name + '-Portable.zip')
    with zipfile.ZipFile(portable, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(target.rglob('*')):
            if p.is_file() and 'portable-data' not in p.relative_to(target).parts:z.write(p, Path(name) / p.relative_to(target))
    with zipfile.ZipFile(portable) as z:
        require(z.testzip() is None, 'Portable ZIP CRC failed')
        for item in APP_FILES: require(z.read(name+'/resources/app/'+item)==(SOURCE/'desktop'/item).read_bytes(), 'App/source mismatch: '+item)
        require(z.read(name+'/resources/app/HexScope.html')==html.read_bytes(), 'HTML mismatch')
        for asset in icon_record['files']:require(z.read(name+'/resources/app/assets/'+asset)==(assets/asset).read_bytes(), 'Icon asset mismatch')
        shipped={Path(p).name.lower() for p in z.namelist() if '/resources/app/engines/tsk/bin/' in p}
        require(shipped==keep, 'Native dependency set mismatch')
    sourcezip = out / 'HexScope-CTF-4.1-GitHub-Source-and-Offline.zip'
    with zipfile.ZipFile(sourcezip, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for item in DOCS + ['HexScope.html','HexScope.build.json','打开程序.cmd']:z.write(docs_root/item,item)
        for item in REPO_FILES:z.write(docs_root/item,item)
        for p in sorted((docs_root/'验证').rglob('*')):
            if p.is_file():z.write(p,Path('验证')/p.relative_to(docs_root/'验证'))
        for folder in [SOURCE, docs_root/'示例文件', verification]:
            for p in sorted(folder.rglob('*')):
                if not p.is_file() or 'node_modules' in p.relative_to(folder).parts:continue
                if folder == verification and (p.parent != verification or p.name not in VERIFICATION_FILES):continue
                if p.is_relative_to(engines) and not ship_engine(p.relative_to(engines)):continue
                z.write(p,Path(folder.name)/p.relative_to(folder))
    with zipfile.ZipFile(sourcezip) as z: require(z.testzip() is None, 'Source ZIP CRC failed')
    checks=''.join(digest(p)+'  '+p.name+'\n' for p in [portable,sourcezip,html])
    (out/'SHA256SUMS-4.1-GitHub.txt').write_text(checks,encoding='utf8')
    (out/'SHA256SUMS.txt').write_text(checks,encoding='utf8')
    if out != docs_root.resolve():
        shutil.copy2(html, out/'HexScope.html')
        shutil.copy2(docs_root/'HexScope.build.json',out/'HexScope.build.json')
    print(checks,flush=True)
    print('Verified portable staging directory:',target,flush=True)
    (verification/'打包结果.json').write_text(json.dumps({'portable':portable.name,'source':sourcezip.name,'htmlSHA256':digest(html),'portableSHA256':digest(portable),'sourceSHA256':digest(sourcezip),'stagingDirectory':str(target)},ensure_ascii=False,indent=2),encoding='utf8')

if __name__ == '__main__':main()
