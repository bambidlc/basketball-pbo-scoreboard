#!/usr/bin/env python3
"""Map fields onto official originals; never recreate page artwork or add pages."""
import json
from pathlib import Path
import pdfplumber
ROOT=Path(__file__).resolve().parents[1]
SOURCES=ROOT/'forms/sources'
manifest=[]

class Form:
 def __init__(self,key,title):
  self.key=key;self.title=title;self.year=int(key[-4:]);self.source=key.replace(f'-{self.year}',f'-original-{self.year}')+'.pdf'
  self.pdf=pdfplumber.open(SOURCES/self.source);self.fields={}
 def add(self,name,label,page,box,kind='text',size=9,multiline=False,max_length=120):
  x,t,r,b=map(float,box)
  assert r>x and b>t,(name,box)
  field=self.fields.setdefault(name,dict(name=name,label=label,type=kind,maxLength=max_length,multiline=multiline,widgets=[]))
  field['widgets'].append(dict(page=page,x=round(x,3),y=round(self.pdf.pages[page].height-b,3),width=round(r-x,3),height=round(b-t,3),fontSize=size))
 def cell(self,name,label,page,cell,**kw):
  x,t,r,b=cell;self.add(name,label,page,(x+1.5,t+1,r-1.5,b-1),**kw)
 def line(self,name,label,page,x,t,width,height=13,**kw):self.add(name,label,page,(x,t,x+width,t+height),**kw)
 def table(self,page,index=0):return self.pdf.pages[page].find_tables()[index]
 def save(self):
  d=dict(key=self.key,title=self.title,year=self.year,file=f'{self.key}.pdf',source=self.source,pages=len(self.pdf.pages),fields=list(self.fields.values()))
  if self.key in ['uniformes-2026','informacion-2027']:
   d['removedRamaRegions']=[dict(page=3 if self.key.startswith('informacion') else 0,x=438.5,y=655,width=122.5,height=16)]
  self.pdf.close();manifest.append(d);return d

def uniform(key):
 year=int(key[-4:]);f=Form(key,('Información de inscripción y uniformes' if key.startswith('informacion') else 'Hoja de uniformes')+f' {year}');p=3 if key.startswith('informacion') else 0
 info=p==3;old=year==2026
 f.line('club','Nombre del club',p,135,118 if not old else 120,150,15)
 f.line('category','Categoría',p,375,118 if not old else 120,60,15)
 top=138 if info else 151
 f.line('shirtColor','Color de camiseta',p,138,top,147,14)
 f.line('numberColor','Color letras y números',p,423,top,104,14)
 f.line('pantsColor','Color de pantalón',p,141,top+17,150,14)
 for i,row in enumerate(f.table(p).rows[1:],1):
  for (name,label),cell in zip([('number','Número'),('name','Nombre completo'),('shirt','Talla camiseta'),('pants','Talla pantalón')],row.cells):f.cell(f'p{i}_{name}',f'Jugador {i}: {label}',p,cell,max_length=75 if name=='name' else 20)
 summary=f.table(p,1)
 for i,row in enumerate(summary.rows[-5:]):
  for col,label in [(1,'Camisas niños'),(2,'Pantalones niños'),(4,'Camisas adultos'),(5,'Pantalones adultos')]:f.cell(f'summary_{i}_{col}',f'{label}, talla {i+1}',p,row.cells[col],max_length=2)
 for i,c in enumerate(f.table(p,2).rows[-1].cells):f.cell(['shorts','waist'][i],['Cantidad de pantalones para dirigentes','Tamaño de cintura'][i],p,c,max_length=50)
 manager=630 if info else 644 if not old else 646
 coach=681 if info else 694 if not old else 696
 date=718 if info else 744 if not old else 745
 for name,label,x,t,w in [('manager','Apoderado(a)',115,manager,230),('phone','Teléfono del apoderado',447,manager,117),('coach','Dirigente',88,coach,258),('coachPhone','Teléfono del dirigente',447,coach,117),('date','Fecha',222,date,212)]:f.line(name,label,p,x,t,w,14)
 return f.save()

def roster(year):
 f=Form(f'roster-{year}',f'Roster de juego {year}');old=year==2026
 f.line('club','Equipo',0,117,171 if old else 196,157,14)
 f.line('category','Categoría / edad',0,400,171 if old else 196,100,14)
 for i,row in enumerate(f.table(0).rows[1:],1):
  f.cell(f'p{i}_name',f'Jugador {i}: nombre completo',0,row.cells[0],max_length=80)
  f.cell(f'p{i}_number',f'Jugador {i}: número',0,row.cells[1],max_length=3)
 if not old:
  for n,t in [('coach',511),('assistant',537),('scorer',562)]:
   f.line(n,n,0,158,t,94,13,size=8);f.line(n+'Lic','Licencia DRD',0,304,t,59,13,size=8);f.line(n+'Cert','Certificación FBPR',0,428,t,83,13,size=8)
 else:
  for n,t in [('coach',487),('assistant',542),('scorer',597)]:
   f.line(n,n,0,169,t,148);f.line(n+'Lic','Licencia DRD',0,385,t,96)
  for n,t in [('coach',514),('assistant',570)]:f.line(n+'Cert','Certificación FBPR',0,144,t,89)
 return f.save()

def carnet(year):
 f=Form(f'carnet-{year}',f'Carnet y lista oficial de jugadores {year}');old=year==2026
 f.line('club','Organización o equipo',0,263 if old else 255,156 if old else 157,277 if old else 279,17)
 f.line('category','Edad del equipo',0,137 if old else 132,192 if old else 199,100,17)
 # Header internals in the older PDF generate extra cells; the last 13 rows are the players.
 rows=f.table(0).rows[-13:]
 columns=[30.6,81,216,279,324,387,441,486,581.4]
 names=[('number','Número'),('name','Nombre completo'),('birthdate','Fecha de nacimiento'),('age','Edad'),('phone','Teléfono'),('school','Escuela'),('grade','Grado'),('guardian','Firma padre, madre o encargado')]
 for i,row in enumerate(rows,1):
  cells=[c for c in row.cells if c];t,b=cells[0][1],cells[0][3]
  for j,(name,label) in enumerate(names):f.cell(f'p{i}_{name}',f'Jugador {i}: {label}',0,(columns[j],t,columns[j+1],b),multiline=name in ['name','school','guardian'],max_length=80 if name in ['name','school','guardian'] else 20,size=8)
 if not old:
  for n,t in [('coach',717),('assistant',745)]:
   f.line(n,'Nombre '+n,0,133,t,95);f.line(n+'Phone','Teléfonos',0,290 if n=='coach' else 287,t,59);f.line(n+'Cert','Certificación',0,389 if n=='coach' else 383,t,55);f.line(n+'Lic','Licencia DRD',0,502,t,59)
  specs=[('manager','Apoderado',142,772,216),('managerPhone','Teléfonos apoderado',418,772,75),('leagueClub','Club de baloncesto',137,832,257),('leaguePhone','Teléfonos club',456,832,114),('president','Nombre y firma del presidente',240,860,334),('insuranceNumber','Número de póliza',253,887,271),('insuranceCompany','Compañía aseguradora',37,915,473)]
 else:
  for n,t in [('coach',700),('assistant',742)]:
   f.line(n,'Nombre '+n,0,134,t,146);f.line(n+'Phone','Teléfonos',0,341,t,96);f.line(n+'Cert','Certificación',0,521,t,53);f.line(n+'Lic','Licencia DRD',0,93,t+14,71)
  specs=[('manager','Apoderado',142,783,216),('managerPhone','Teléfonos apoderado',421,783,150),('leagueClub','Club de baloncesto',137,843,259),('leaguePhone','Teléfonos club',459,843,112),('president','Nombre y firma del presidente',240,870,334),('insuranceNumber','Número de póliza',253,898,271),('insuranceCompany','Compañía aseguradora',37,926,473)]
 for n,label,x,t,w in specs:f.line(n,label,0,x,t,w)
 f.line('club','Equipo',1,181,145 if old else 131,192)
 f.line('category','Edad del equipo',1,406,145 if old else 131,90)
 photo_rows=f.table(1).rows
 for i in range(1,14):
  row=(i-1)//3;col=(i-1)%3;cell=photo_rows[row].cells[col];x,t,r,b=cell
  words=f.pdf.pages[1].extract_words();label=next((w for w in words if w['text']=='Nombre' and x<=w['x0']<r and t<w['top']<b),None)
  hash_word=next(w for w in words if w['text']=='#' and x<=w['x0']<r and t<w['top']<b)
  if label is None:label={'x1':x+45,'top':hash_word['top']}
  f.add(f'p{i}_photo',f'Añadir foto del jugador {i} (Adobe Acrobat de escritorio)',1,(x+5,t+4,r-5,label['top']-4),kind='image')
  number_x=hash_word['x1']+2;number_width=r-hash_word['x1']-4
  # Some original # labels sit against the border. Use the blank immediately
  # before that label when there is no readable space after it.
  name_end=hash_word['x0']-3
  if number_width<18:number_x=hash_word['x0']-23;number_width=21;name_end=number_x-3
  f.line(f'p{i}_name',f'Jugador {i}: nombre completo',1,label['x1']+2,label['top']-1,name_end-label['x1']-2,12,multiline=True,size=8)
  f.line(f'p{i}_number',f'Jugador {i}: número',1,number_x,hash_word['top']-1,number_width,12,max_length=3,size=8)
 for i,cell in enumerate(photo_rows[-1].cells):
  x,t,r,b=cell;f.add(f'staff_card_{i}',f'Copia tarjeta federativa: {['Dirigente','Asistente','Anotador'][i]} (Adobe Acrobat)',1,(x+4,t+18,r-4,b-20),kind='image')
 return f.save()

for y in [2027,2026]:uniform(f'uniformes-{y}');roster(y);carnet(y)
uniform('informacion-2027')
f=Form('disponibilidad-2027','Disponibilidad de cancha y dirigentes 2027');f.save()
(ROOT/'forms/schema.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
for d in manifest:print(d['file'],d['pages'],'original pages',len(d['fields']),'fields')
