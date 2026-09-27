from pathlib import Path
import struct,json,hashlib,os,zipfile
root=Path(__file__).resolve().parent/'engines/tsk'
bin=root/'bin'
def imports(p):
    data=p.read_bytes();pe=struct.unpack_from('<I',data,0x3c)[0]
    machine,nsec=struct.unpack_from('<HH',data,pe+4);opt=pe+24
    optsize=struct.unpack_from('<H',data,pe+20)[0]
    magic=struct.unpack_from('<H',data,opt)[0]
    imp=struct.unpack_from('<I',data,opt+(104 if magic==0x10b else 120))[0]
    secs=[]
    for i in range(nsec):
        s=opt+optsize+i*40
        vsize,rva,size,offset=struct.unpack_from('<IIII',data,s+8)
        secs.append((rva,max(vsize,size),offset))
    def at(rva):
        for base,size,pos in secs:
            if base<=rva<base+size:return pos+rva-base
        raise ValueError('invalid RVA')
    names=[]
    if imp:
        pos=at(imp)
        while any(data[pos:pos+20]):
            name=struct.unpack_from('<I',data,pos+12)[0];offset=at(name)
            names.append(data[offset:data.index(b'\0',offset)].decode());pos+=20
    return machine,names
queue=[x+'.exe' for x in ['img_stat','img_cat','mmls','fls','icat','fsstat','istat']]
files={p.name.lower():p for p in bin.iterdir() if p.is_file()}
checked={};missing=[]
while queue:
    name=queue.pop().lower()
    if name in checked:continue
    machine,deps=imports(files[name]);assert machine==0x14c,(name,machine)
    checked[name]={'architecture':'x86','sha256':hashlib.sha256(files[name].read_bytes()).hexdigest(),'imports':deps}
    for dep in deps:
        if dep.lower() in files:queue.append(dep.lower())
        elif not (Path(os.environ['WINDIR'])/'SysWOW64'/dep).is_file():missing.append(dep)
assert not missing,missing
manifest={'component':'The Sleuth Kit','version':'4.15.0','libewf':'20130416','upstreamArchive':'https://github.com/sleuthkit/sleuthkit/releases/download/sleuthkit-4.15.0/sleuthkit-4.15.0-win32.zip','upstreamSHA256':'c2ebab8105b893d97bd8ce35b88e01985e2a106efc97f03adf95840a631b20ce','modification':'Added activeCodePage UTF-8 to the existing embedded manifests of seven CLI executables; machine code and DLLs unchanged. Reproducible patch: ../../enable-utf8.ps1. Requires Windows 10 1903+ or Windows 11.','checkedFiles':checked,'missingDependencies':missing}
(root/'ENGINE_INFO.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print('Audited',len(checked),'native files; all non-system DLL dependencies bundled; no missing DLLs')
print('DLL dependencies:', ', '.join(n for n in checked if n.endswith('.dll') and not n.startswith('api-')))
