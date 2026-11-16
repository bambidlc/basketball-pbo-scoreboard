import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFBool} from 'pdf-lib';
import {fillPdf,readPdf,validateValues,deriveValues} from '../forms/pdf-engine.mjs';
const schemas=JSON.parse(await readFile(new URL('../forms/schema.json',import.meta.url)));
const image=(await readFile(new URL('../public/acb-logo-256.png',import.meta.url))).toString('base64');
const sampleImage=`data:image/png;base64,${image}`;
await mkdir(new URL('../.preview/pdf-qa/',import.meta.url),{recursive:true});

for(const schema of schemas)test(`${schema.key}: every field survives a fill, save, reopen and second save`,async()=>{
  const bytes=await readFile(new URL(`../output/pdf/${schema.file}`,import.meta.url));
  const pdf=await PDFDocument.load(bytes);const fields=pdf.getForm().getFields();
  assert.equal(fields.length,schema.fields.length);assert.equal(new Set(fields.map(f=>f.getName())).size,fields.length);
  const values={},images={};
  for(const f of schema.fields){if(f.type==='image'){images[f.name]=sampleImage;continue;}values[f.name]=f.options?.[0] || (f.type==='date'?'2015-03-14':f.type==='email'?'prueba@example.invalid':f.type==='number'?'2':f.name.endsWith('_number')?f.name.match(/^p(\d+)/)[1]:f.label.includes('Edad')||f.name.endsWith('_age')?'12':f.name.endsWith('_grade')?'6':f.name==='gender'?'M':f.name==='category'?'12':f.type==='tel'||f.name.endsWith('_phone')?'7875550100':f.maxLength<=25?'123':'José Rodríguez Pérez');}
  const signature=schema.fields.find(f=>f.type==='signature');if(signature)images[signature.name]=sampleImage;
  const result=await fillPdf(bytes,schema,values,images);const restored=await readPdf(result,schema);
  const derived=deriveValues(schema,values);
  for(const f of schema.fields){if(f.type==='image'){assert.equal(restored.images[f.name],true);continue;}assert.equal(restored.values[f.name],derived[f.name],f.name);}
  const again=await fillPdf(result,schema,restored.values,restored.images);const reopened=await readPdf(again,schema);
  assert.deepEqual(reopened,restored);
  const saved=await PDFDocument.load(again);for(const f of saved.getForm().getFields())for(const w of f.acroField.getWidgets())assert.ok(w.getNormalAppearance(),`missing appearance ${f.getName()}`);
  assert.equal(validateValues(schema,values,images).length,0);
  await writeFile(new URL(`../.preview/pdf-qa/${schema.file}`,import.meta.url),again);
});

test('final download requires complete populated rows, signatures and photos; unused rows remain optional',()=>{
  const schema=schemas.find(d=>d.key==='carnet-2027');const empty=validateValues(schema,{});
  assert.ok(empty.some(e=>e.name==='p1_guardian'));assert.ok(empty.some(e=>e.name==='p1_photo'));
  assert.ok(!empty.some(e=>e.name==='p2_guardian'));
  const partial=validateValues(schema,{p2_name:'Prueba'});
  assert.ok(partial.some(e=>e.name==='p2_guardian'));assert.ok(partial.some(e=>e.name==='p2_photo'));
});

test('wrong form imports fail; unsupported characters produce a field-specific message',async()=>{
  const schema=schemas.find(d=>d.key==='roster-2027');const bytes=await readFile(new URL('../output/pdf/roster-2027.pdf',import.meta.url));
  await assert.rejects(()=>readPdf(bytes,schemas.find(d=>d.key==='roster-2026')),/no corresponde/);
  await assert.rejects(()=>fillPdf(bytes,schema,{club:'🏀'}),/Club.*quite emojis/);
});

test('size totals count each garment separately, including the thirteenth player',()=>{
  const schema=schemas.find(d=>d.key==='uniformes-2027');const values=deriveValues(schema,{p1_shirt:'Adulto M',p1_pants:'Adulto S',p13_shirt:'Adulto M',p13_pants:'Adulto M'});
  assert.equal(values.summary_6_shirts,'2');assert.equal(values.summary_5_pants,'1');assert.equal(values.summary_6_pants,'1');
});

test('photos inserted by a PDF reader are recognized without web-editor metadata',async()=>{
  const schema=schemas.find(d=>d.key==='carnet-2027');const doc=await PDFDocument.load(await readFile(new URL('../output/pdf/carnet-2027.pdf',import.meta.url)));
  const field=doc.getForm().getButton('p1_photo');field.setImage(await doc.embedPng(sampleImage));
  const restored=await readPdf(await doc.save(),schema);assert.equal(restored.images.p1_photo,true);
});
