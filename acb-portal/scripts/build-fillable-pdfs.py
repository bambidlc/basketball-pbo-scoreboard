#!/usr/bin/env python3
"""Build native AcroForms and the matching web-editor schema. No personal data."""
import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import simpleSplit
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
NAVY, BLUE, LINE = map(HexColor, ['#102347', '#eef4ff', '#a9b9d1'])
SCHEMAS = []
SIZES = ['Niños 2-4', 'Niños 6-8', 'Niños 10-12', 'Niños 14-16', 'Niños 18-20', 'Adulto S', 'Adulto M', 'Adulto L', 'Adulto XL', 'Adulto XXL']
CONSENT = 'La firma del padre, madre o encargado autoriza a la ACB a dar su información a nuestros auspiciadores.'
RULE3 = 'Certifico que conozco las disposiciones de la Regla 3 del Reglamento de ACB y que todos los jugadores incluidos son los mismos que sometí en la documentación a base de la cual se conformará la Lista de Jugadores y el Carnet oficial del equipo, y que jugadores nuevos son inelegibles y ocasionarán la confiscación de los partidos y otras sanciones.'

class Form:
    def __init__(self, key, title, year, landscape=False):
        self.key, self.title, self.year = key, title, year
        self.w, self.h = (792, 612) if landscape else (612, 792)
        self.c = canvas.Canvas(str(OUT / f'{key}.pdf'), pagesize=(self.w, self.h))
        self.c.setTitle(f'{title} - ACB {year} - PDF editable')
        self.c.setAuthor('Asociación de Clubes de Baloncesto de Puerto Rico')
        self.fields, self.page, self.group = [], 0, 'Equipo'
        self.new_page(title)

    def text(self, text, x, y, size=9, bold=False, width=None):
        self.c.setFillColor(NAVY); self.c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
        lines = simpleSplit(text, 'Helvetica-Bold' if bold else 'Helvetica', size, width or self.w-64)
        for i, line in enumerate(lines): self.c.drawString(x, self.h-y-i*(size+3), line)
        return len(lines)*(size+3)

    def new_page(self, title):
        if self.page: self.c.showPage()
        self.page += 1
        self.c.setFillColor(NAVY); self.c.rect(0,self.h-76,self.w,76,fill=1,stroke=0)
        self.c.drawImage(str(ROOT/'public/acb-logo-256.png'), 28,self.h-64,width=50,height=50,mask='auto',preserveAspectRatio=True)
        self.c.setFillColor(white);self.c.setFont('Helvetica-Bold',18);self.c.drawString(90,self.h-37,title)
        self.c.setFont('Helvetica',9);self.c.drawString(90,self.h-57,f'ACB Puerto Rico | Temporada {self.year} | Formulario digital')
        self.text('Complete los campos azules y guarde el PDF. Fotos y firmas: acbpr.pages.dev/formularios/',32,94,8)
        self.text(f'ACB {self.year}  |  {self.title}  |  Página {self.page}',32,self.h-20,7)
        if self.year == 2026: self.text('ARCHIVO 2026 - No utilizar para la inscripción 2027.',32,self.h-34,8,True)

    def field(self, name, label, x, y, w, h=23, kind='text', required=False, row=None, label_above=True, **extra):
        if label_above: self.text(label,x,y-5,7,True,width=w)
        options = dict(name=name, tooltip=label, x=x, y=self.h-y-h, width=w, height=h,
                       borderColor=LINE, fillColor=BLUE, textColor=NAVY, borderWidth=.5,
                       fontName='Helvetica', fontSize=9, forceBorder=True, value='', maxlen=extra.get('maxLength',120))
        flags = ('required ' if required else '') + ('multiline' if kind=='textarea' else '')
        self.c.acroForm.textfield(**options, fieldFlags=flags.strip())
        self.fields.append(dict(name=name,label=label,type=kind,required=required,row=row,group=self.group,page=self.page-1,x=x,y=self.h-y-h,width=w,height=h,**extra))

    def team(self, y=116):
        self.group='Equipo'
        self.field('club','Club / organización',32,y,self.w-296,required=True)
        self.field('category','Categoría (edad)',self.w-252,y,100,required=True,maxLength=15)
        self.field('gender','Rama (M / F)',self.w-140,y,108,required=True,options=['M','F'])

    def section(self, title, y):
        self.group=title;self.text(title,32,y,11,True)

    def save(self):
        self.c.save()
        doc=dict(key=self.key,title=f'{self.title} {self.year}',year=self.year,file=f'{self.key}.pdf',fields=self.fields)
        SCHEMAS.append(doc);return doc

def uniforms(year):
    f=Form(f'uniformes-{year}','Hoja de uniformes',year);f.team()
    for i,(n,l) in enumerate([('shirtColor','Color de camiseta'),('numberColor','Color letras y números'),('pantsColor','Color de pantalón')]): f.field(n,l,32+i*186,162,176,required=True)
    f.section('Jugadores - máximo 13',211)
    cols=[('number','Núm.',32,42),('name','Nombre completo',80,260),('shirt','Camiseta',346,110),('pants','Pantalón',462,118)]
    for _,l,x,w in cols:f.text(l,x,228,8,True)
    for i in range(1,14):
        for n,l,x,w in cols:f.field(f'p{i}_{n}',l,x,236+(i-1)*24,w,21,required=i==1,row=f'p{i}',label_above=False,options=SIZES if n in ['shirt','pants'] else None,maxLength=60 if n=='name' else 20)
    f.section('Resumen de tallas - cantidades por prenda',572)
    for x in [142,422]:
        f.text('Camisas',x,586,6,True);f.text('Pantalones',x+74,586,6,True)
    for i,size in enumerate(SIZES):
        col=i//5;r=i%5;x=32+col*280;y=592+r*20
        f.text(size,x,y+12,8)
        for j,(n,l) in enumerate([('shirts','Camisas'),('pants','Pantalones')]):f.field(f'summary_{i}_{n}',f'{size} - {l}',x+110+j*74,y,64,18,label_above=False,kind='number',maxLength=2)
    f.section('Contacto y pedido adicional',705)
    f.field('manager','Apoderado(a)',32,722,220,required=True)
    f.field('phone','Teléfono',262,722,140,required=True,kind='tel',maxLength=25)
    f.field('date','Fecha',412,722,168,required=True,kind='date',maxLength=10)
    f.new_page('Uniformes - contacto y resumen')
    f.section('Dirigente',122)
    f.field('coach','Nombre del dirigente',32,143,330,required=True)
    f.field('coachPhone','Teléfono del dirigente',374,143,206,required=True,kind='tel',maxLength=25)
    f.field('shorts','Pantalón corto dirigentes ($25) - cantidad',32,200,260,kind='number',maxLength=2)
    f.field('waist','Tamaño(s) de cintura',310,200,270,maxLength=60)
    f.text('ACB provee 12 uniformes. El uniforme #13 cuesta $30 y debe incluirse en el formulario inicial.',32,260,10,width=548)
    f.text('No se recibirán peticiones de uniformes que no estén incluidos en el formulario de uniformes sometido inicialmente.',32,303,10,width=548)
    f.text('Los totales se calculan al completar este formulario en la página. En un lector PDF, complete el resumen de tallas.',32,360,9,width=548)
    return f.save()

def roster(year):
    f=Form(f'roster-{year}','Roster oficial de juego',year);f.team()
    f.section('Jugadores - máximo 13',178)
    f.text('Nombre completo (letra de molde)',32,198,9,True);f.text('Número',492,198,9,True)
    for i in range(1,14):
        f.field(f'p{i}_name','Nombre completo',32,208+(i-1)*26,448,23,required=i==1,row=f'p{i}',label_above=False,maxLength=70)
        f.field(f'p{i}_number','Número',492,208+(i-1)*26,88,23,required=i==1,row=f'p{i}',label_above=False,maxLength=3)
    f.text(RULE3,32,568,8,width=548)
    f.section('Personal del equipo',632)
    for i,role in enumerate(['Dirigente','Asistente','Anotador']):
        y=653+i*34;n=['coach','assistant','scorer'][i]
        f.field(n,role,32,y,280,required=True)
        f.field(n+'Lic','Lic. DRD',324,y,122,required=True,maxLength=25)
        f.field(n+'Cert','Cert. FBPR',458,y,122,required=role!='Anotador',maxLength=25)
    f.text('Debe llevar 3 copias para ser ponchadas. Sello ACB al relieve: reservado para la ACB.',32,752,8,True)
    return f.save()

def carnet(year):
    f=Form(f'carnet-{year}','Lista oficial de jugadores',year,True);f.team()
    f.section('Lista oficial - máximo 13 jugadores',177)
    cols=[('number','Núm.',32,32),('name','Nombre completo',69,140),('birthdate','Fecha nac.',214,72),('age','Edad',291,32),('phone','Teléfono',328,80),('school','Escuela',413,116),('grade','Grado',534,44),('guardian','Firma padre, madre o encargado',583,177)]
    for n,l,x,w in cols:f.text(l,x,195,6.8,True,width=w)
    for i in range(1,14):
        for n,l,x,w in cols:f.field(f'p{i}_{n}',l,x,214+(i-1)*23,w,21,required=i==1,row=f'p{i}',label_above=False,kind='date' if n=='birthdate' else 'signature' if n=='guardian' else 'text',maxLength=65 if n in ['guardian','name','school'] else 22)
    f.text(CONSENT,32,538,8,width=728)
    f.text('Cada padre, madre o encargado debe completar su propia firma. No firme por otra persona.',32,555,8)
    f.new_page('Autorización y personal del equipo')
    f.section('Personal del equipo',122)
    for i,role in enumerate(['Dirigente','Asistente','Apoderado']):
        y=150+i*48;n=['coach','assistant','manager'][i]
        f.field(n,role,32,y,260,required=True)
        f.field(n+'Phone','Teléfonos',304,y,164,required=True,kind='tel',maxLength=25)
        if i<2:
            f.field(n+'Cert','# Certificación',480,y,130,required=True,maxLength=25)
            f.field(n+'Lic','# Lic. DRD',622,y,138,required=True,maxLength=25)
    f.section('Autorización de la Liga',307)
    f.field('leagueClub','Club de baloncesto',32,330,460,required=True)
    f.field('leaguePhone','Teléfonos',504,330,256,required=True,kind='tel',maxLength=25)
    f.field('president','Nombre del presidente del club',32,387,340,required=True)
    f.field('presidentSignature','Firma del presidente del club',390,387,370,required=True,kind='signature')
    f.field('insuranceNumber','Póliza de seguro de accidentes - número',32,446,340,required=True)
    f.field('insuranceCompany','Compañía aseguradora',390,446,370,required=True)
    f.text('Esta hoja debe ser llenada en su totalidad y acompañada por los Certificados de Nacimiento ORIGINALES.',32,515,9)
    f.text('No recibiremos documentos incompletos. Es obligatorio incluir copia de las tarjetas federativas.',32,538,9)
    f.new_page('Carnet de jugadores')
    f.section('Fotos de jugadores - los nombres y números se copian de la lista',119)
    for i in range(1,14):
        col=(i-1)%4;r=(i-1)//4;x=32+col*184;y=140+r*104
        f.group=f'Foto jugador {i}'
        f.field(f'p{i}_photo',f'Foto del jugador {i}',x,y,65,80,kind='image',required=i==1,row=f'p{i}',label_above=False)
        f.field(f'p{i}_cardName','Nombre',x+71,y+10,106,32,kind='textarea',row=f'p{i}',copyFrom=f'p{i}_name',maxLength=65)
        f.field(f'p{i}_cardNumber','Número',x+71,y+63,50,20,row=f'p{i}',copyFrom=f'p{i}_number',maxLength=3)
    f.text('Añada fotos desde la página. En Adobe Acrobat de escritorio, use los botones de imagen.',32,570,8)
    f.new_page('Tarjetas de Federación / Lic. DRD')
    for i,role in enumerate(['Dirigente','Asistente','Anotador']):
        x=32+i*246;f.group=f'Tarjeta - {role}'
        f.text(role,x,130,12,True)
        f.field(f'card_{i}_name','Nombre',x,154,230,required=True)
        f.field(f'card_{i}_lic','Lic. DRD',x,206,230,required=True,maxLength=30)
        f.field(f'card_{i}_photo',f'Copia tarjeta - {role}',x,263,230,250,kind='image',required=True)
    f.text('Es obligatorio poner la copia de las tarjetas federativas de los dirigentes, asistente y anotador.',32,554,9)
    return f.save()

def availability():
    f=Form('disponibilidad-2027','Disponibilidad de cancha y dirigentes',2027)
    f.section('Contacto del club',125)
    f.field('club','Nombre del club',32,147,340,required=True)
    f.field('phone','Teléfono',384,147,196,kind='tel',required=True,maxLength=25)
    f.field('contact','Persona de contacto',32,201,268,required=True)
    f.field('email','Correo electrónico',312,201,268,required=True,kind='email')
    f.field('court','Nombre y dirección de la cancha',32,255,548,60,kind='textarea',required=True,maxLength=220)
    f.section('Fechas disponibles para carnavales',345)
    f.field('dates','Indique fechas y disponibilidad AM, PM o todo el día',32,368,548,142,kind='textarea',required=True,maxLength=850)
    f.section('Dirigente con 2 equipos (si aplica)',545)
    f.field('coach','Nombre del dirigente',32,566,548)
    f.field('team1','Equipo 1 y categoría',32,620,268)
    f.field('team2','Equipo 2 y categoría',312,620,268)
    f.field('slot','Acomodo solicitado',32,673,180,options=['AM','PM','Sin acomodo'])
    f.field('notes','Observaciones',224,673,356,58,kind='textarea',maxLength=250)
    f.new_page('Instrucciones para disponibilidad')
    for i,t in enumerate([
        'Envíe este PDF completado por email a bobbyramirez48@yahoo.com antes del 30 de diciembre de 2026, con las fechas disponibles de sus canchas para los carnavales del Torneo ACB 2027.',
        'Notifique los dirigentes que tendrán 2 equipos. Un dirigente no puede dirigir dos equipos en una misma categoría y solo puede dirigir un máximo de 2 equipos.',
        'El acomodo será AM (hasta el mediodía) o PM (después del mediodía). No se aceptan solicitudes para horas específicas de juego.',
        'Los acomodos deben solicitarse al 30 de diciembre de 2026. No se aceptarán nuevos acomodos luego de haber iniciado el torneo.',
        'Descargar este PDF no lo envía a la ACB. Envíelo al correo indicado. El calendario oficial original se incluye en las páginas siguientes.'
    ]): f.text(f'{i+1}. {t}',32,130+i*95,11,width=548)
    return f.save()

for year in [2027,2026]:
    uniforms(year);roster(year);carnet(year)
availability()

# Preserve the official informational pages. Replace the duplicated blank uniform
# sheet in the information packet with the same fillable uniform form.
converted=ROOT/'forms/sources'
info_source=converted/'informacion-original-2027.pdf'
availability_source=converted/'disponibilidad-original-2027.pdf'
if not info_source.exists() or not availability_source.exists():
    raise SystemExit('Missing the official informational source PDFs in forms/sources.')
writer=PdfWriter();source=PdfReader(info_source)
info_pages=[i for i,p in enumerate(source.pages) if 'FORMULARIO PARA UNIFORMES' not in (p.extract_text() or '')]
writer.append(source,pages=info_pages);writer.append(PdfReader(OUT/'uniformes-2027.pdf'))
with open(OUT/'informacion-2027.pdf','wb') as out:writer.write(out)
base=next(d for d in SCHEMAS if d['key']=='uniformes-2027')
SCHEMAS.append(dict(**{**base,'key':'informacion-2027','title':'Información de inscripción y uniformes 2027','file':'informacion-2027.pdf','fields':[{**f,'page':f['page']+len(info_pages)} for f in base['fields']]}))
target=OUT/'disponibilidad-2027.pdf';writer=PdfWriter();writer.append(PdfReader(target));writer.append(PdfReader(availability_source))
with open(target,'wb') as out:writer.write(out)
(ROOT/'forms/schema.json').write_text(json.dumps(SCHEMAS,ensure_ascii=False,indent=2)+'\n')
for d in SCHEMAS:
    r=PdfReader(OUT/d['file']);print(d['file'],len(r.pages),'pages',len(r.get_fields() or {}),'fields')
