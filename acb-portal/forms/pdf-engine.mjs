import { PDFDocument, PDFName, PDFBool, StandardFonts } from 'pdf-lib';

function hasImageAppearance(doc,field) {
  const seen=new Set();
  const scan=(ref,depth=0)=>{
    if(!ref || depth>8 || seen.has(String(ref)))return false;
    seen.add(String(ref));const stream=doc.context.lookup(ref);
    if(!stream?.dict)return false;
    if(stream.dict.get(PDFName.of('Subtype'))===PDFName.of('Image'))return true;
    const resources=doc.context.lookup(stream.dict.get(PDFName.of('Resources')));
    const objects=resources && doc.context.lookup(resources.get(PDFName.of('XObject')));
    return objects?.entries().some(([,value])=>scan(value,depth+1)) || false;
  };
  return field.acroField.getWidgets().some(w=>scan(w.getNormalAppearance()));
}

export function validateValues(schema, values, images = {}) {
  const active = new Set(schema.fields.filter(f => f.row && !f.copyFrom && (String(values[f.name] || '').trim() || images[f.name])).map(f => f.row));
  const errors = [];
  for (const f of schema.fields) {
    if (f.copyFrom) continue;
    const value = String(values[f.name] || '').trim();
    if ((f.required || (f.row && active.has(f.row))) && !(f.type === 'image' ? images[f.name] : value)) errors.push({name:f.name,message:`${f.row ? `Jugador ${f.row.slice(1)}: ` : ''}${f.label} es obligatorio.`});
    if (value && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push({name:f.name,message:'Revise el correo electrónico.'});
    if (value && f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) errors.push({name:f.name,message:`${f.label}: use una fecha válida.`});
    if (value && f.type === 'number' && !/^\d{1,2}$/.test(value)) errors.push({name:f.name,message:`${f.label}: use una cantidad de 0 a 99.`});
    if (value && f.options && !f.options.includes(value)) errors.push({name:f.name,message:`${f.label}: seleccione una opción válida.`});
  }
  const numbers = new Set();
  for (let i=1;i<=13;i++) { const n=String(values[`p${i}_number`] || '').trim(); if(n && numbers.has(n)) errors.push({name:`p${i}_number`,message:`Jugador ${i}: número repetido.`}); if(n)numbers.add(n); }
  if(schema.key.startsWith('disponibilidad') && ['coach','team1','team2','slot'].some(n=>String(values[n]||'').trim())) {
    for(const name of ['coach','team1','team2','slot']) if(!String(values[name]||'').trim())errors.push({name,message:'Complete los dos equipos, el dirigente y el acomodo solicitado.'});
  }
  return errors;
}

export function deriveValues(schema, input) {
  const values = {...input};
  for(const f of schema.fields) if(f.copyFrom)values[f.name]=values[f.copyFrom]||'';
  if(schema.key.startsWith('uniformes') || schema.key.startsWith('informacion')) {
    const sizes=['Niños 2-4','Niños 6-8','Niños 10-12','Niños 14-16','Niños 18-20','Adulto S','Adulto M','Adulto L','Adulto XL','Adulto XXL'];
    for(let s=0;s<sizes.length;s++)for(const [field,col] of [['shirts','shirt'],['pants','pants']])values[`summary_${s}_${field}`]=String(Array.from({length:13},(_,i)=>values[`p${i+1}_${col}`]).filter(v=>v===sizes[s]).length);
  }
  return values;
}

export async function fillPdf(bytes, schema, input, images = {}) {
  const doc=await PDFDocument.load(bytes);const form=doc.getForm();const font=await doc.embedFont(StandardFonts.Helvetica);
  const values=deriveValues(schema,input);
  for(const f of schema.fields) {
    if(f.type==='image')continue;
    const field=form.getTextField(f.name); const value=String(values[f.name]||'');
    // Reject unsupported characters with a clear field label instead of silently losing data.
    try{font.encodeText(value);}catch{throw new Error(`${f.label}: utilice letras, números y acentos; quite emojis o símbolos especiales.`);}
    if((field.getText()||'')!==value || images[f.name]===null) {
      field.setText(value);
      field.acroField.dict.delete(PDFName.of('ACBImage'));
    }
    if(!field.acroField.getDefaultAppearance())field.updateAppearances(font);
    // Fit long names without enlarging short values beyond the form's 9pt baseline.
    const width=font.widthOfTextAtSize(value||' ',9);
    const size=f.type==='textarea'?9:Math.min(9,9*(f.width-7)/Math.max(width,1));
    if(!images[f.name] || images[f.name]!==true)field.setFontSize(size);
  }
  form.updateFieldAppearances(font);
  for(const f of schema.fields) {
    const data=images[f.name];if(!data || data===true)continue;
    const image=await doc.embedPng(data);
    const field=f.type==='image'?form.getButton(f.name):form.getTextField(f.name);
    field.setImage(image);field.acroField.dict.set(PDFName.of('ACBImage'),PDFBool.True);
  }
  doc.setSubject(`ACB_FORM:${schema.key}:v1`);
  return doc.save({useObjectStreams:false});
}

export async function readPdf(bytes,schema) {
  const doc=await PDFDocument.load(bytes);const form=doc.getForm();
  if(doc.getSubject()!==`ACB_FORM:${schema.key}:v1`)throw new Error('Este PDF no corresponde al formulario seleccionado. Seleccione su formulario y abra un PDF descargado de esta página.');
  const values={},images={};
  for(const f of schema.fields) {
    const field=form.getField(f.name);
    if(f.type!=='image')values[f.name]=form.getTextField(f.name).getText()||'';
    if(field.acroField.dict.get(PDFName.of('ACBImage'))===PDFBool.True || (f.type==='image' && hasImageAppearance(doc,field)))images[f.name]=true;
  }
  return {values,images};
}
