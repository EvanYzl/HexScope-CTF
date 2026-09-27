"""Fetch pinned, redistributable OCR language models. Build-time only."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import gzip, hashlib, json, urllib.request, time

ROOT = Path(__file__).resolve().parents[2] / 'desktop/vendor/vision'
COMMIT = '87416418657359cb625c412a48b6e1d6d41c29bd'
LANGUAGES = {'eng':'英语','chi_sim':'简体中文','chi_tra':'繁体中文','jpn':'日语','kor':'韩语',
 'chi_sim_vert':'简体中文（竖排）','chi_tra_vert':'繁体中文（竖排）','jpn_vert':'日语（竖排）',
 'afr':'南非荷兰语','ara':'阿拉伯语','aze':'阿塞拜疆语','bel':'白俄罗斯语','ben':'孟加拉语',
 'bos':'波斯尼亚语','bul':'保加利亚语','cat':'加泰罗尼亚语','ces':'捷克语','cym':'威尔士语',
 'dan':'丹麦语','deu':'德语','ell':'希腊语','est':'爱沙尼亚语','eus':'巴斯克语','fas':'波斯语',
 'fin':'芬兰语','fra':'法语','gle':'爱尔兰语','glg':'加利西亚语','guj':'古吉拉特语','heb':'希伯来语',
 'hin':'印地语','hrv':'克罗地亚语','hun':'匈牙利语','ind':'印度尼西亚语','isl':'冰岛语',
 'ita':'意大利语','kan':'卡纳达语','kat':'格鲁吉亚语','kaz':'哈萨克语','khm':'高棉语',
 'lao':'老挝语','lat':'拉丁语','lav':'拉脱维亚语','lit':'立陶宛语','mal':'马拉雅拉姆语',
 'mar':'马拉地语','mkd':'马其顿语','msa':'马来语','mya':'缅甸语','nep':'尼泊尔语',
 'nld':'荷兰语','nor':'挪威语','pan':'旁遮普语','pol':'波兰语','por':'葡萄牙语',
 'ron':'罗马尼亚语','rus':'俄语','sin':'僧伽罗语','slk':'斯洛伐克语','slv':'斯洛文尼亚语',
 'spa':'西班牙语','sqi':'阿尔巴尼亚语','srp':'塞尔维亚语','swa':'斯瓦希里语','swe':'瑞典语',
 'tam':'泰米尔语','tel':'泰卢固语','tha':'泰语','tur':'土耳其语','ukr':'乌克兰语',
 'urd':'乌尔都语','uzb':'乌兹别克语','vie':'越南语'}

def fetch(url):
 for attempt in range(4):
  try:
   with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'HexScope-build'}), timeout=90) as r:
    return r.read()
  except Exception:
   if attempt == 3: raise
   time.sleep(2 ** attempt)

def download(item):
 key, name = item
 url = f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{COMMIT}/{key}.traineddata'
 path = ROOT / 'languages' / (key + '.traineddata.gz')
 if path.exists(): data = gzip.decompress(path.read_bytes())
 else:
  data = fetch(url)
  if len(data) < 10000: raise RuntimeError('Incomplete model: ' + key)
  path.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
 return {'code':key,'name':name,'url':url,'sha256':hashlib.sha256(data).hexdigest(),
         'compressedSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':len(data)}

if __name__ == '__main__':
 (ROOT / 'languages').mkdir(parents=True, exist_ok=True)
 with ThreadPoolExecutor(max_workers=4) as pool: models=list(pool.map(download, LANGUAGES.items()))
 (ROOT / 'languages.json').write_text(json.dumps({'engine':'Tesseract.js 7.0.0','repository':'https://github.com/tesseract-ocr/tessdata_fast',
   'commit':COMMIT,'license':'Apache-2.0','models':models}, ensure_ascii=False, indent=2)+'\n',encoding='utf8')
 (ROOT / 'licenses').mkdir(exist_ok=True)
 (ROOT / 'licenses/tessdata-LICENSE').write_bytes(fetch(f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{COMMIT}/LICENSE'))
 font='https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf'
 font_path=ROOT/'NotoSansCJKsc-Regular.otf'
 if not font_path.exists(): font_path.write_bytes(fetch(font))
 (ROOT/'licenses/noto-OFL.txt').write_bytes(fetch('https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/LICENSE'))
 (ROOT/'font.json').write_text(json.dumps({'url':font,'sha256':hashlib.sha256(font_path.read_bytes()).hexdigest(),'license':'OFL-1.1'},indent=2)+'\n')
 print(f'{len(models)} offline language models and CJK font ready',flush=True)
