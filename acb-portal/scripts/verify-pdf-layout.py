#!/usr/bin/env python3
"""Pixel-compare blank deliverables with their official originals, then audit widgets."""
from pathlib import Path
import json,subprocess
from concurrent.futures import ThreadPoolExecutor
from PIL import Image,ImageChops,ImageDraw
from math import floor,ceil
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]
QA=ROOT/'.preview/original-qa';QA.mkdir(parents=True,exist_ok=True)
schemas=json.loads((ROOT/'forms/schema.json').read_text())
def check(s):
 paths=[ROOT/'forms/sources'/s['source'],ROOT/'output/pdf'/s['file']]
 renders=[]
 for tag,p in zip(['source','result'],paths):
  dest=QA/f"{s['key']}-{tag}";subprocess.run(['pdftoppm','-r','96','-png',str(p),str(dest)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  renders.append(sorted(QA.glob(dest.name+'-*.png')))
 assert len(renders[0])==len(renders[1])==s['pages']
 for page,(a,b) in enumerate(zip(*renders)):
  x,y=Image.open(a).convert('RGB'),Image.open(b).convert('RGB');assert x.size==y.size
  for r in s.get('removedRamaRegions',[]):
   if r['page']!=page:continue
   # The sole authorized artwork edit is erasing obsolete M/F choices. Compare
   # every other pixel, and ensure the removed choice is blank in the result.
   scale=96/72;left=r['x']*scale;top=(792-r['y']-r['height'])*scale
   right=(r['x']+r['width'])*scale;bottom=(792-r['y'])*scale
   interior=(ceil(left)+2,ceil(top)+2,floor(right)-2,floor(bottom)-2)
   assert y.crop(interior).getextrema()==((255,255),)*3
   box=(floor(left)-1,floor(top)-1,ceil(right)+1,ceil(bottom)+1)
   ImageDraw.Draw(x).rectangle(box,fill='white');ImageDraw.Draw(y).rectangle(box,fill='white')
  assert ImageChops.difference(x,y).getbbox() is None,f'Original design changed: {s["file"]} {a.name}'
 r=PdfReader(paths[1]);fields=r.get_fields() or {};assert set(fields)=={f['name'] for f in s['fields']}
 widgets=[]
 for p in r.pages:
  for a in p.get('/Annots',[]):
   w=a.get_object()
   if w.get('/Subtype')!='/Widget':continue
   parent=w.get('/Parent');f=parent.get_object() if parent else w;name=f.get('/T')
   assert name in fields and w.get('/AP',{}).get('/N');widgets.append(name)
 assert len(widgets)==sum(len(f['widgets']) for f in s['fields'])
 return dict(file=s['file'],pages=s['pages'],fields=len(fields),widgets=len(widgets),original_layout_preserved=True,removed_rama_regions=len(s.get('removedRamaRegions',[])))
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(check,schemas))
(QA/'verification.json').write_text(json.dumps(results,indent=2)+'\n')
for r in results:print(r)
