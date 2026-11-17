// Add transparent AcroForm widgets to the official original PDFs. Page artwork,
// page size, pagination and existing spaces remain unchanged. Only the obsolete
// printed M/F choice is removed, as requested, from the two sources containing it.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
const root=new URL('../',import.meta.url);
const schemas=JSON.parse(await readFile(new URL('forms/schema.json',root)));
await mkdir(new URL('output/pdf/',root),{recursive:true});
for(const schema of schemas) {
  const original=await readFile(new URL(`forms/sources/${schema.source}`,root));
  const target=new URL(`output/pdf/${schema.file}`,root);
  if(!schema.fields.length){await writeFile(target,original);console.log(schema.file,'original informational PDF, unchanged');continue;}
  const pdf=await PDFDocument.load(original);const form=pdf.getForm();const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(const {page,...region} of schema.removedRamaRegions||[]) pdf.getPages()[page].drawRectangle({...region,color:rgb(1,1,1),borderWidth:0});
  if(form.getFields().length)throw new Error(`Expected a pristine original: ${schema.source}`);
  for(const f of schema.fields) {
    const field=f.type==='image'?form.createButton(f.name):form.createTextField(f.name);
    field.acroField.dict.set(PDFName.of('TU'),PDFString.of(f.label));
    if(f.type!=='image') {
      field.setMaxLength(f.maxLength||120);
      if(f.multiline)field.enableMultiline();
    }
    for(const w of f.widgets) {
      const options={x:w.x,y:w.y,width:w.width,height:w.height,borderWidth:0,borderColor:undefined,backgroundColor:undefined,textColor:rgb(0,0,0),font,fontSize:w.fontSize||9};
      if(f.type==='image') {
        field.addToPage('',pdf.getPages()[w.page],options);
        const widget=field.acroField.getWidgets().at(-1);
        // PDFButton defaults to grey even with an undefined background option.
        // Remove that paint explicitly so the blank PDF remains pixel-identical.
        widget.getAppearanceCharacteristics().dict.delete(PDFName.of('BG'));
        const appearance=widget.getAppearanceCharacteristics().dict;
        appearance.set(PDFName.of('TP'),pdf.context.obj(1)); // icon only
        appearance.set(PDFName.of('IF'),pdf.context.obj({SW:'A',S:'P',A:[0.5,0.5],FB:true}));
        widget.dict.set(PDFName.of('AA'),pdf.context.obj({U:{S:'JavaScript',JS:PDFString.of('event.target.buttonImportIcon();')}}));
      } else {
        field.addToPage(pdf.getPages()[w.page],options);
        // Each repeated widget has its own geometry. Auto-size independently,
        // rather than inheriting the first widget's calculated font size.
        field.acroField.getWidgets().at(-1).setDefaultAppearance(`0 g /${font.name} 0 Tf`);
      }
    }
    if(f.type!=='image')field.setFontSize(0);
    else field.updateAppearances(font);
  }
  form.updateFieldAppearances(font);
  // Keep automatic sizing enabled in readers after generating blank appearances.
  for(const f of schema.fields) if(f.type!=='image') {
    const field=form.getTextField(f.name);
    field.acroField.setDefaultAppearance(`0 g /${font.name} 0 Tf`);
    for(const widget of field.acroField.getWidgets()) widget.setDefaultAppearance(`0 g /${font.name} 0 Tf`);
  }
  await writeFile(target,await pdf.save({useObjectStreams:false}));
  console.log(schema.file,pdf.getPageCount(),'original pages,',form.getFields().length,'fields');
}
