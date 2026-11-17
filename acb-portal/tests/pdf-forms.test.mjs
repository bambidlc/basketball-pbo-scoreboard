import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
const root=new URL('../',import.meta.url);
const schemas=JSON.parse(await readFile(new URL('forms/schema.json',root)));
const png=await readFile(new URL('public/acb-logo-256.png',root));
await mkdir(new URL('.preview/original-qa/filled/',root),{recursive:true});
for(const schema of schemas)test(`${schema.key}: original page sizes, complete widgets, editable values and images survive saving`,async()=>{
 const original=await readFile(new URL(`forms/sources/${schema.source}`,root));
 const bytes=await readFile(new URL(`output/pdf/${schema.file}`,root));
 const source=await PDFDocument.load(original);const pdf=await PDFDocument.load(bytes);
 assert.equal(pdf.getPageCount(),source.getPageCount());
 assert.deepEqual(pdf.getPages().map(p=>p.getSize()),source.getPages().map(p=>p.getSize()));
 if(!schema.fields.length){assert.deepEqual(bytes,original);return;}
 const form=pdf.getForm();assert.equal(form.getFields().length,schema.fields.length);
 assert.ok(!form.getFields().some(f=>/gender|rama/i.test(f.getName())), 'No rama or gender fields');
 const font=await pdf.embedFont(StandardFonts.Helvetica);const image=await pdf.embedPng(png);const values={};
 for(const f of schema.fields){
  const field=form.getField(f.name);assert.equal(field.acroField.getWidgets().length,f.widgets.length);
  for(const w of field.acroField.getWidgets()){const mk=w.getAppearanceCharacteristics();assert.ok(!mk?.getBackgroundColor()?.length,'Field must remain transparent');}
  if(f.type==='image'){
   for(const w of field.acroField.getWidgets()) {
    assert.equal(w.getAppearanceCharacteristics().dict.get(PDFName.of('TP')).asNumber(),1,'Photo buttons display imported icons');
    assert.ok(w.dict.get(PDFName.of('AA')),'Photo buttons have an import action');
   }
   form.getButton(f.name).setImage(image);continue;
  }
  const v=f.name.startsWith('summary')?'2':f.name.endsWith('number')?'23':f.name.endsWith('birthdate')?'03/14/2015':f.name.endsWith('_age')||f.name==='category'?'12':f.name.endsWith('_grade')?'6':f.name.endsWith('_name')?'José Alejandro Pérez Rivera':f.name.endsWith('_school')?'Esc. Eugenio María de Hostos':f.name.toLowerCase().includes('phone')?'7875550100':'José Pérez';
  values[f.name]=v;form.getTextField(f.name).setText(v);
  for(const w of field.acroField.getWidgets()) assert.match(w.getDefaultAppearance(), / 0 Tf/, 'Widgets auto-size independently');
 }
 form.updateFieldAppearances(font);
 const filled=await pdf.save({useObjectStreams:false});const reopened=await PDFDocument.load(filled);const restored=reopened.getForm();
 for(const f of schema.fields){
  if(f.type!=='image')assert.equal(restored.getTextField(f.name).getText(),values[f.name]);
  for(const w of restored.getField(f.name).acroField.getWidgets())assert.ok(w.getNormalAppearance());
 }
 // Mirrored names/numbers are the SAME field, not independent copies that drift.
 if(schema.key.startsWith('carnet')){assert.equal(restored.getTextField('p1_name').acroField.getWidgets().length,2);assert.equal(restored.getTextField('club').acroField.getWidgets().length,2);}
 await writeFile(new URL(`.preview/original-qa/filled/${schema.file}`,root),filled);
});
