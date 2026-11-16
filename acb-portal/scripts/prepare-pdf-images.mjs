// Give photo slots native PDF image buttons. Acrobat supports buttonImportIcon;
// the web editor supports photos in every browser without PDF JavaScript.
import {readFile,writeFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFString,StandardFonts,rgb} from 'pdf-lib';
const schemas=JSON.parse(await readFile(new URL('../forms/schema.json',import.meta.url)));
for(const schema of schemas) {
  const file=new URL(`../output/pdf/${schema.file}`,import.meta.url);
  const doc=await PDFDocument.load(await readFile(file));const form=doc.getForm();
  const font=await doc.embedFont(StandardFonts.Helvetica);
  // Merged source PDFs can inherit /DA only from the original AcroForm root.
  // Make the font and appearance explicit on every canonical field.
  for(const f of schema.fields.filter(f=>f.type!=='image'))form.getTextField(f.name).updateAppearances(font);
  for(const f of schema.fields.filter(f=>f.type==='image')) {
    const old=form.getField(f.name);form.removeField(old);
    const button=form.createButton(f.name);button.acroField.dict.set(PDFName.of('TU'),PDFString.of(f.label));
    button.addToPage('Añadir imagen',doc.getPages()[f.page],{x:f.x,y:f.y,width:f.width,height:f.height,fontSize:8,borderWidth:.5,borderColor:rgb(.66,.72,.82),backgroundColor:rgb(.93,.96,1),textColor:rgb(.06,.14,.28)});
    button.acroField.getWidgets()[0].dict.set(PDFName.of('AA'),doc.context.obj({U:{S:'JavaScript',JS:PDFString.of('event.target.buttonImportIcon();')}}));
  }
  doc.setSubject(`ACB_FORM:${schema.key}:v1`);
  await writeFile(file,await doc.save({useObjectStreams:false}));
  console.log(schema.file,form.getFields().length,'interactive fields');
}
