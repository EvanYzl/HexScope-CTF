from pathlib import Path
import struct, hashlib, json

source=Path(__file__).resolve().parents[1]
out=source/'tests/fixtures/disk'
out.mkdir(parents=True,exist_ok=True)
sector=512; count=8192; start=2048
volume=bytearray(count*sector)
volume[:3]=b'\xeb\x3c\x90'; volume[3:11]=b'HEXSCOPE'
struct.pack_into('<HBHBHHBHHHII',volume,11,512,1,1,2,512,count,0xf8,32,63,255,start,0)
volume[36]=0x80; volume[38]=0x29
struct.pack_into('<I',volume,39,0x12345678)
volume[43:54]=b'HEXCTF     '; volume[54:62]=b'FAT16   ';volume[510:512]=b'\x55\xaa'
fat=bytearray(32*sector)
struct.pack_into('<HH',fat,0,0xfff8,0xffff)
root=65*sector; data=97*sector; next_cluster=2
def alloc(payload):
    global next_cluster
    n=max(1,(len(payload)+511)//512); first=next_cluster
    for i in range(n):
        cl=next_cluster; next_cluster+=1
        struct.pack_into('<H',fat,cl*2,0xffff if i==n-1 else cl+1)
    volume[data+(first-2)*512:data+(first-2)*512+len(payload)]=payload
    return first
def entry(name,cluster,size=0,attr=0x20,deleted=False):
    e=bytearray(32); e[:11]=name.encode('ascii');e[11]=attr
    if deleted:e[0]=0xe5
    struct.pack_into('<HH',e,22,0,(46<<9)|(9<<5)|27)
    struct.pack_into('<HI',e,26,cluster,size)
    return e
def long_entry(long_name,short_name,cluster,size):
    checksum=0
    for c in short_name.encode('ascii'):checksum=(((checksum&1)<<7)+(checksum>>1)+c)&255
    raw=long_name.encode('utf-16le')+b'\0\0'; n=(len(raw)+25)//26; raw=raw.ljust(n*26,b'\xff')
    records=bytearray()
    for index in range(n,0,-1):
        chunk=raw[(index-1)*26:index*26]; item=bytearray(32);item[0]=index|(0x40 if index==n else 0);item[11]=0x0f;item[13]=checksum
        item[1:11]=chunk[:10];item[14:26]=chunk[10:22];item[28:32]=chunk[22:];records+=item
    return records+entry(short_name,cluster,size)
hello=b'flag{portable_e01_and_sleuthkit}\n'
hello_cl=alloc(hello)
deleted=b'flag{deleted_but_not_overwritten}\n'
deleted_cl=alloc(deleted); struct.pack_into('<H',fat,deleted_cl*2,0)
png=(source/'tests/fixtures/normal.png').read_bytes()
payload=png+(source/'tests/fixtures/deflated.zip').read_bytes()
png_cl=alloc(payload)
sub_cl=next_cluster
sub=entry('.          ',sub_cl,attr=0x10)+entry('..         ',0,attr=0x10)+entry('HIDDEN  PNG',png_cl,len(payload))
alloc(sub)
entries=entry('HEXCTF     ',0,attr=0x08)+entry('HELLO   TXT',hello_cl,len(hello))+entry('REMOVED TXT',deleted_cl,len(deleted),deleted=True)+entry('PICTURES   ',sub_cl,attr=0x10)
entries+=long_entry('中文 线索.png','CHINES~1PNG',png_cl,len(payload))
entries+=long_entry('odd|name.txt','ODDNAM~1TXT',hello_cl,len(hello))
volume[root:root+len(entries)]=entries
volume[512:512+len(fat)]=fat; volume[33*512:33*512+len(fat)]=fat
disk=bytearray(start*512)+volume
disk[446:462]=struct.pack('<B3sB3sII',0,b'\x00\x02\x00',6,b'\xfe\xff\xff',start,count)
disk[510:512]=b'\x55\xaa'
(out/'fat16.dd').write_bytes(disk)
(out/'partition.img').write_bytes(volume)
(out/'expected.json').write_text(json.dumps({'offset':start,'HELLO.TXT':{'bytes':hello.decode(),'sha256':hashlib.sha256(hello).hexdigest()},'_EMOVED.TXT':{'bytes':deleted.decode(),'sha256':hashlib.sha256(deleted).hexdigest()},'PICTURES/HIDDEN.PNG':{'sha256':hashlib.sha256(payload).hexdigest(),'size':len(payload)}},indent=2),encoding='utf8')
print('Generated synthetic FAT16 disk and bare partition',len(disk))
