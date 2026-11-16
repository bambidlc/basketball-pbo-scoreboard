import schemas from './schema.json';
import {fillPdf,readPdf,validateValues,deriveValues} from './pdf-engine.mjs';

const $=id=>document.getElementById(id);
let schema,values={},images={},baseBytes=null,dirty=false,busy=false;
const inputs=new Map();
const select=$('document');
for(const year of [2027,2026]) {
  const group=document.createElement('optgroup');group.label=year===2027?'Temporada 2027':'Archivo 2026';
  for(const doc of schemas.filter(d=>d.year===year)){const o=document.createElement('option');o.value=doc.key;o.textContent=doc.title;group.append(o);}select.append(group);
}
const urlKey=new URLSearchParams(location.search).get('doc');
select.value=schemas.some(d=>d.key===urlKey)?urlKey:'uniformes-2027';
function status(message){$('status').textContent=message;}
function setBusy(value){busy=value;document.querySelectorAll('button,select,input,textarea').forEach(el=>el.disabled=value);}
function progress(){const count=schema.fields.filter(f=>!f.copyFrom && (String(values[f.name]||'').trim()||images[f.name])).length;$('progress').textContent=`${count} campos completados`;
  const derived=deriveValues(schema,values);for(const f of schema.fields.filter(f=>f.name.startsWith('summary_')))if(inputs.has(f.name))inputs.get(f.name).value=derived[f.name]||'';
}
function download(bytes,name){const blob=new Blob([bytes],{type:'application/pdf'});const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);}
function clearErrors(){$('errors').hidden=true;$('errors').replaceChildren();document.querySelectorAll('.invalid').forEach(e=>e.classList.remove('invalid'));}
function showErrors(errors){clearErrors();const box=$('errors');box.hidden=false;const intro=document.createElement('b');intro.textContent=`Faltan datos por completar (${errors.length}). Puedes guardar un borrador en cualquier momento.`;box.append(intro);const ul=document.createElement('ul');for(const error of errors.slice(0,16)){const li=document.createElement('li');const a=document.createElement('a');a.href=`#${error.name}`;a.textContent=error.message;a.onclick=e=>{e.preventDefault();const input=inputs.get(error.name);input.closest('details.section').open=true;input.focus();input.scrollIntoView({block:'center',behavior:'smooth'});};li.append(a);ul.append(li);inputs.get(error.name)?.classList.add('invalid');}box.append(ul);box.scrollIntoView({block:'start',behavior:'smooth'});}
async function imageData(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Usa una imagen JPG, PNG o WebP. Convierte archivos HEIC o PDF a una imagen antes de añadirlos.');
  if(file.size>12*1024*1024)throw new Error('La imagen debe pesar menos de 12 MB.');
  const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,1400/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/png');}finally{URL.revokeObjectURL(url);}
}
function addSignature(box,f,input){
  const hint=document.createElement('p');hint.className='help';hint.textContent=f.name.includes('guardian')?'El padre, madre o encargado debe escribir su nombre completo como firma. La firma autoriza a la ACB a dar su información a sus auspiciadores.':'La persona indicada debe escribir su nombre completo como firma. No firme por otra persona.';box.append(hint);
  const details=document.createElement('details');details.className='signature-box';const summary=document.createElement('summary');summary.textContent='Añadir firma dibujada (opcional)';details.append(summary);
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=180;canvas.setAttribute('aria-label','Dibujar firma con el dedo o ratón');details.append(canvas);const ctx=canvas.getContext('2d');ctx.lineWidth=2.6;ctx.lineCap='round';ctx.strokeStyle='#102347';let drawing=false,hasInk=false;
  const point=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];};
  canvas.onpointerdown=e=>{drawing=true;canvas.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(...point(e));};
  canvas.onpointermove=e=>{if(!drawing)return;ctx.lineTo(...point(e));ctx.stroke();hasInk=true;};
  canvas.onpointerup=()=>{drawing=false;if(hasInk){images[f.name]=canvas.toDataURL('image/png');dirty=true;status('Firma añadida. Escriba también el nombre del firmante.');}};
  canvas.onpointercancel=()=>drawing=false;
  const clear=document.createElement('button');clear.type='button';clear.textContent='Borrar firma dibujada';clear.onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasInk=false;images[f.name]=null;dirty=true;};details.append(clear);box.append(details);
  input.addEventListener('input',()=>{if(images[f.name]===true)delete images[f.name];});
}
function render(){
  inputs.clear();$('form').replaceChildren();clearErrors();const groups=new Map();
  for(const f of schema.fields){
    if(f.copyFrom)continue;
    const group=f.row?`Jugador ${f.row.slice(1)}${f.row==='p1'?' *':' (si aplica)'}`:f.group;
    if(!groups.has(group)){const details=document.createElement('details');details.className='section';details.open=groups.size<2;const summary=document.createElement('summary');summary.textContent=group;details.append(summary);const fields=document.createElement('div');fields.className='fields';details.append(fields);$('form').append(details);groups.set(group,fields);}
    const box=document.createElement('div');box.className=`field${f.type==='textarea'?' wide':''}`;box.dataset.type=f.type;const label=document.createElement('label');label.htmlFor=f.name;label.textContent=f.label+(f.required?' *':'');box.append(label);
    let input;
    if(f.options){input=document.createElement('select');for(const option of ['',...f.options]){const o=document.createElement('option');o.value=option;o.textContent=option||'Seleccionar…';input.append(o);}}
    else if(f.type==='textarea'){input=document.createElement('textarea');}
    else{input=document.createElement('input');input.type=['date','email','tel','number'].includes(f.type)?f.type:f.type==='image'?'file':'text';}
    input.id=f.name;input.name=f.name;input.required=f.required;input.autocomplete='off';if(f.maxLength)input.maxLength=f.maxLength;
    if(f.type==='number'){input.min='0';input.max='99';input.step='1';}
    if(f.type==='image'){
      input.accept='image/jpeg,image/png,image/webp';const preview=document.createElement('img');preview.className='preview';preview.alt=f.label;preview.hidden=true;
      const hint=document.createElement('p');hint.className='help';hint.textContent=images[f.name]===true?'Imagen conservada del PDF que abriste. Puedes reemplazarla.':'JPG, PNG o WebP · hasta 12 MB. Se incluye en el PDF.';
      if(typeof images[f.name]==='string'){preview.src=images[f.name];preview.hidden=false;}
      input.onchange=async()=>{try{const file=input.files[0];if(!file)return;images[f.name]=await imageData(file);preview.src=images[f.name];preview.hidden=false;hint.textContent='Imagen añadida al documento.';dirty=true;progress();}catch(error){input.value='';status(error.message);}};
      box.append(input,preview,hint);
    }else{
      input.value=values[f.name]||'';input.readOnly=f.name.startsWith('summary_');
      input.addEventListener('input',()=>{values[f.name]=input.value;dirty=true;input.classList.remove('invalid');progress();});box.append(input);
      if(f.type==='signature')addSignature(box,f,input);
    }
    inputs.set(f.name,input);groups.get(group).append(box);
  }
  progress();
}
function choose(){schema=schemas.find(d=>d.key===select.value);values={};images={};baseBytes=null;dirty=false;const url=new URL(location);url.searchParams.set('doc',schema.key);history.replaceState({},'',url);$('blank').href=`/pdf/${schema.file}`;$('blank').download=schema.file;
  $('instructions').textContent=schema.year===2026?'Archivo histórico 2026. Para inscribir un equipo en 2027, selecciona un formulario de la temporada actual.':schema.key.startsWith('disponibilidad')?'Envíe el PDF completo a bobbyramirez48@yahoo.com antes del 30 de diciembre de 2026. Este editor no envía correos.':schema.key.startsWith('roster')?'Complete digitalmente y lleve las 3 copias que exige la ACB para ser ponchadas. El sello queda reservado para la ACB.':schema.key.startsWith('carnet')?'Incluya las fotos y tarjetas federativas. Cada padre, madre o encargado completa su propia firma. Se mantiene el requisito de presentar certificados de nacimiento originales.':'Complete los jugadores que correspondan (máximo 13). El resumen de tallas se calcula automáticamente.';
  status('');render();
}
select.onchange=()=>{if(dirty&&!confirm('Tienes cambios sin guardar. Guarda un borrador antes de cambiar. ¿Descartar estos cambios?')){select.value=schema.key;return;}choose();};
$('clear').onclick=()=>{if(confirm('¿Borrar los datos y fotos de este formulario?'))choose();};
async function exportPdf(final){if(busy)return;clearErrors();if(final){const errors=validateValues(schema,values,images);if(errors.length){showErrors(errors);return;}}
  setBusy(true);status('Preparando el PDF con tus datos…');try{if(!baseBytes){const response=await fetch(`/pdf/${schema.file}`);if(!response.ok)throw new Error('No se pudo cargar el PDF. Inténtalo de nuevo.');baseBytes=new Uint8Array(await response.arrayBuffer());}
    const bytes=await fillPdf(baseBytes,schema,values,images);download(bytes,`${final?'completado':'borrador'}-${schema.file}`);dirty=false;status(final?'PDF descargado con campos editables. Revísalo y entrégalo según las instrucciones de la ACB.':'Borrador descargado. Para continuar, selecciona este formulario y pulsa «Abrir mi PDF».');
  }catch(error){status(`No se pudo descargar: ${error.message}`);}finally{setBusy(false);}}
$('save').onclick=()=>exportPdf(false);$('download').onclick=()=>exportPdf(true);
$('restore').onchange=async()=>{const file=$('restore').files[0];if(!file)return;if(file.size>40*1024*1024){status('El PDF debe pesar menos de 40 MB.');return;}if(dirty&&!confirm('¿Reemplazar los cambios actuales con el PDF seleccionado?'))return;setBusy(true);try{const bytes=new Uint8Array(await file.arrayBuffer());const restored=await readPdf(bytes,schema);values=restored.values;images=restored.images;baseBytes=bytes;dirty=false;render();status('PDF abierto. Los datos y las imágenes guardadas se conservarán al descargar.');}catch(error){status(error.message);}finally{setBusy(false);$('restore').value='';}};
$('form').onsubmit=e=>e.preventDefault();
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
choose();
