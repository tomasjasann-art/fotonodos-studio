'use strict';
(function(){
const $=id=>document.getElementById(id);
const all=(selector)=>Array.from(document.querySelectorAll(selector));
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const preview=$('preview'),stage=$('stageWrapper'),previewCtx=preview.getContext('2d',{willReadFrequently:true});
const defaultAdjust=()=>({aging:0,saturation:100,brightness:100,contrast:100,warmth:0,grain:0});
const defaultLogo=()=>({enabled:true,size:17,x:98,y:2});
let photos=[],current=-1,mode='view',tab='watermark',drawing=false,dragOrigin=null,dragSelection=null,renderTask=0,busy=false,ocrWorker=null,toastTimer=null,defaultLogoImage=null,customLogoForPhoto=new Map();
let zoomMode='fit';
const active=()=>photos[current]||null;
const toast=(s)=>{$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3200)};
function status(s){$('status').textContent=s;}
function createImage(source){
 return new Promise((resolve,reject)=>{let image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('No se pudo leer imagen'));image.src=source;});
}
function filenameClean(s){return String(s||'').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/\s+/g,' ').replace(/[. ]+$/,'').trim().slice(0,115);}
function filenameOf(p,i,used){
 let pattern=$('namePattern').value,ext=$('outputFormat').value==='image/png'?'.png':'.jpg';
 let fromNode=filenameClean(p.fields.node);
 let base=pattern==='original'?filenameClean(p.file.name.replace(/\.[^.]+$/,'')+'_editada'):(fromNode||filenameClean(p.file.name.replace(/\.[^.]+$/,'')+'_sin_rotulo'));
 if(pattern==='node_number')base+='_'+String(i+1).padStart(3,'0');
 base=base||('foto_'+(i+1));
 let name=base+ext,suffix=2;
 if(used){while(used.has(name.toLowerCase()))name=base+'_'+String(suffix++).padStart(2,'0')+ext;used.add(name.toLowerCase());}
 return name;
}
async function addFiles(list){
 const allowed=Array.from(list||[]).filter(file=>/image\/(jpeg|png|webp)/.test(file.type));
 if(!allowed.length){toast('Selecciona fotografías JPG, PNG o WEBP.');return;}
 let count=0;
 for(const file of allowed){
  let url=URL.createObjectURL(file);
  try{
   const image=await createImage(url);
   photos.push({file,url,image,fields:{node:'',date:'',coords:''},watermarkMode:'replace',region:null,crop:null,pendingCrop:null,fontSize:100,repairMethod:'blend',ocrStatus:'not',adjust:defaultAdjust(),logo:defaultLogo(),customLogo:null,aiImage:null,aiUrl:null,aiCleanRegion:false,aiHistory:[],aiInstruction:'',aiEdits:[]});
   count++;
  }catch(error){URL.revokeObjectURL(url);}
 }
 if(count){selectPhoto(photos.length-count);renderPhotoList();toast(count+' fotografía(s) cargada(s).');status('Selecciona «Leer rótulo (OCR)» o marca manualmente el rótulo de la foto.');}
}
function selectPhoto(index){
 if(index<0||index>=photos.length)return;
 current=index;
 $('beforeAfter').checked=false;
 dragSelection=null;
 showPhotoControls();
 renderPhotoList();
 schedulePreview();
}
function renderPhotoList(){
 $('countHeader').textContent=photos.length+' fotografías';
 $('countLibrary').textContent=String(photos.length);
 $('libraryState').textContent=photos.length?'Selecciona una':'Sin cargar';
 $('photoList').replaceChildren();
 photos.forEach((p,i)=>{
  let button=document.createElement('button');button.type='button';
  button.className='photo-item'+(i===current?' active':'');
  let thumbnail=document.createElement('img');thumbnail.src=p.url;thumbnail.className='thumb-image';thumbnail.alt='';
  let info=document.createElement('div');
  let head=document.createElement('strong');head.textContent=(i+1)+'. '+p.file.name;
  let node=document.createElement('small');node.textContent=p.fields.node||'Nodo sin identificar';
  let state=document.createElement('span');state.className='photo-status'+(p.ocrStatus==='done'?' read':'');
  state.textContent=p.ocrStatus==='done'?'✓ OCR leído':p.region?'✓ Zona marcada':'Pendiente';
  info.append(head,node,state);button.append(thumbnail,info);
  button.addEventListener('click',()=>selectPhoto(i));
  $('photoList').append(button);
 });
}
function refreshNames(){
 let p=active();
 const name=p?filenameOf(p,current):'—';
 $('fileNamePreview').textContent=name;
 $('exportNamePreview').textContent=name;
 $('activeTitle').textContent=p?(p.fields.node||p.file.name):'Selecciona una fotografía';
 if(p){$('editorSubtitle').textContent=p.file.name+' · '+p.image.naturalWidth+' × '+p.image.naturalHeight+' píxeles';}
 $('navCount').textContent=p?(current+1)+' / '+photos.length:'0 / 0';
}
function updateRegionNotice(){
 const p=active();if(!p){$('regionNotice').textContent='Carga una fotografía para empezar.';return;}
 if(p.region){$('regionNotice').textContent='✓ Región del rótulo marcada para esta foto. Al editar los campos, el texto anterior se reconstruye y el nuevo se coloca en la misma área.';}
 else if(p.watermarkMode==='add'){$('regionNotice').textContent='Modo para fotos sin rótulo: se agrega texto nuevo en la parte inferior derecha.';}
 else if(p.watermarkMode==='keep'){$('regionNotice').textContent='Esta fotografía conserva su rótulo original, sin modificaciones.';}
 else {$('regionNotice').textContent='Selecciona «Leer rótulo (OCR)» o «Marcar zona». Sin una región detectada el programa NO superpone un nuevo rótulo.';}
}
function showPhotoControls(){
 const p=active();
 $('emptyState').hidden=Boolean(p);
 $('canvasContainer').hidden=!p;
 if(!p){
  $('activeTitle').textContent='Selecciona una fotografía';
  $('editorSubtitle').textContent='Carga fotografías para empezar';
  $('selectedChip').textContent='Sin imagen';
  $('ocrState').textContent='Sin leer';
  refreshNames();return;
 }
 $('selectedChip').textContent='Foto '+(current+1);
 $('imageDimensions').textContent=p.image.naturalWidth+' × '+p.image.naturalHeight+' px';
 $('fieldNode').value=p.fields.node;
 $('fieldDate').value=p.fields.date;
 $('fieldCoords').value=p.fields.coords;
 $('aiInstruction').value=p.aiInstruction||'';
 $('aiUndo').disabled=!(p.aiHistory&&p.aiHistory.length);
 $('aiRegionNotice').textContent=p.region?'Zona de edición seleccionada para esta foto.':'Usa el OCR o marca el área del rótulo. Para edición de toda la imagen elige «Fotografía completa».';
 $('watermarkMode').value=p.watermarkMode;
 $('fontSize').value=p.fontSize;
 $('fontSizeVal').textContent=p.fontSize+'%';
 $('repairMethod').value=p.repairMethod;
 $('ocrState').textContent=p.ocrStatus==='done'?'OCR leído':p.ocrStatus==='failed'?'Revisar OCR':'Sin leer';
 $('ocrState').classList.toggle('success',p.ocrStatus==='done');
 $('showLogo').checked=p.logo.enabled;
 $('logoSize').value=p.logo.size;
 $('logoX').value=p.logo.x;
 $('logoY').value=p.logo.y;
 for(let [id,val] of Object.entries(p.adjust))$(id).value=val;
 updateSliderLabels();
 updateRegionNotice();
 $('undoCrop').hidden=!p.crop;
 refreshNames();
 updateLogoCard();
}
function updateSliderLabels(){
 const p=active();if(!p)return;
 for(const key of ['aging','saturation','brightness','contrast','warmth','grain']){
  $(key+'Val').textContent=p.adjust[key]+(key==='warmth'?'':'%');
 }
 for(const key of ['logoSize','logoX','logoY'])$(key+'Val').textContent=p.logo[key]+'%';
 $('fontSizeVal').textContent=p.fontSize+'%';
}
function updateLogoCard(){
 const p=active();
 const currentImage=p&&p.customLogo?p.customLogo:defaultLogoImage;
 if(currentImage && currentImage.src)$('logoPreview').src=currentImage.src;
 else if(window.FOTONODOS_YOFC_DATA)$('logoPreview').src=window.FOTONODOS_YOFC_DATA;
}
function switchTab(name){
 tab=name;
 all('.tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===name));
 all('.tab-panel').forEach(el=>el.classList.toggle('active',el.dataset.panel===name));
 $('inspectorTitle').textContent=({watermark:'Rótulos',ai:'Editor con IA',logo:'Logo de empresa',adjust:'Ajustes visuales',export:'Descargas'})[name]||'Propiedades';
}
function switchTool(name){
 mode=name;dragSelection=null;dragOrigin=null;
 all('.tool').forEach(el=>el.classList.toggle('selected',el.dataset.tool===name));
 $('applyCrop').hidden=name!=='crop';$('undoCrop').hidden=name!=='crop'||!active()?.crop;
 const text=({view:'Vista normal: cambia de foto o utiliza las pestañas de la derecha.',watermark:'Arrastra un rectángulo sobre el rótulo existente. La selección será solo de esta fotografía.',crop:'Arrastra para definir el recorte. Luego pulsa «Aplicar recorte».',logo:'Arrastra el logo en la imagen para moverlo. También puedes ajustar X e Y.'})[name];
 $('toolHelp').textContent=text;
 $('tipText').textContent=text;
 preview.style.cursor=name==='view'?'default':name==='logo'?'move':'crosshair';
 schedulePreview();
}
function schedulePreview(){
 if(renderTask)cancelAnimationFrame(renderTask);
 renderTask=requestAnimationFrame(()=>{renderTask=0;paintPreview();});
}
function cropSource(p){
 let W=p.image.naturalWidth,H=p.image.naturalHeight;
 if(!p.crop)return{x:0,y:0,w:W,h:H};
 return{x:p.crop.x*W,y:p.crop.y*H,w:p.crop.w*W,h:p.crop.h*H};
}
function rectOnOutput(p,rect,crop,scale,w,h){
 if(!rect)return null;
 let W=p.image.naturalWidth,H=p.image.naturalHeight;
 let x=Math.round((rect.x*W-crop.x)*scale),y=Math.round((rect.y*H-crop.y)*scale),
   rw=Math.round(rect.w*W*scale),rh=Math.round(rect.h*H*scale);
 let xx=clamp(x,0,w),yy=clamp(y,0,h);
 return{x:xx,y:yy,w:clamp(rw-(xx-x),0,w-xx),h:clamp(rh-(yy-y),0,h-yy)};
}
function repairRegion(g,canvasW,canvasH,rect,method){
 if(!rect)return;
 let x=Math.round(rect.x),y=Math.round(rect.y),w=Math.round(rect.w),h=Math.round(rect.h);
 if(w<3||h<3||x>=canvasW||y>=canvasH)return;
 if(method==='clone'){
  let sy=y-h-Math.max(3,Math.round(canvasH*.006));
  if(sy<0)sy=y+h+Math.max(3,Math.round(canvasH*.006));
  if(sy>=0&&sy+h<=canvasH){g.putImageData(g.getImageData(x,sy,w,h),x,y);return;}
 }
 let l=g.getImageData(Math.max(x-2,0),y,1,h).data;
 let r=g.getImageData(Math.min(x+w+1,canvasW-1),y,1,h).data;
 let t=g.getImageData(x,Math.max(y-2,0),w,1).data;
 let b=g.getImageData(x,Math.min(y+h+1,canvasH-1),w,1).data;
 let out=g.createImageData(w,h),dest=out.data;
 for(let j=0;j<h;j++){
  let v=(j+.5)/h;
  for(let i=0;i<w;i++){
   let u=(i+.5)/w,offset=(j*w+i)*4;
   for(let ch=0;ch<3;ch++){
    let horizontal=l[j*4+ch]*(1-u)+r[j*4+ch]*u;
    let vertical=t[i*4+ch]*(1-v)+b[i*4+ch]*v;
    let texture=1.2*Math.sin((i+3)*(j+4)*.63);
    dest[offset+ch]=clamp(horizontal*.57+vertical*.43+texture,0,255);
   }
   dest[offset+3]=255;
  }
 }
 g.putImageData(out,x,y);
}
function applyAppearance(g,w,h,a){
 let aging=a.aging/100,sat=a.saturation/100,brightness=a.brightness/100,contrast=a.contrast/100,warmth=a.warmth,grain=a.grain/100;
 if(!aging&&sat===1&&brightness===1&&contrast===1&&!warmth&&!grain)return;
 let pix=g.getImageData(0,0,w,h),d=pix.data;
 for(let i=0;i<d.length;i+=4){
  let R=d[i],G=d[i+1],B=d[i+2],gray=R*.299+G*.587+B*.114;
  let finalSat=sat*(1-.5*aging),finalContrast=contrast*(1-.22*aging),finalLight=brightness*(1-.12*aging);
  let noise=(Math.sin((i/4+1)*12.9898)*43758.5453)%1;
  noise=(noise-.5)*(grain*28+aging*11);
  d[i]=clamp((((gray+(R-gray)*finalSat-128)*finalContrast+128)*finalLight)+warmth*.32+aging*12+noise,0,255);
  d[i+1]=clamp((((gray+(G-gray)*finalSat-128)*finalContrast+128)*finalLight)+warmth*.08+aging*4+noise*.65,0,255);
  d[i+2]=clamp((((gray+(B-gray)*finalSat-128)*finalContrast+128)*finalLight)-warmth*.25-aging*9+noise*.5,0,255);
 }
 g.putImageData(pix,0,0);
 if(aging>0){
  g.save();let rad=Math.max(w,h),v=g.createRadialGradient(w*.5,h*.5,rad*.16,w*.5,h*.5,rad*.72);
  v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(43,29,17,'+(.20*aging)+')');
  g.fillStyle=v;g.fillRect(0,0,w,h);g.restore();
 }
}
function drawLabel(g,p,rect,w,h){
 let lines=[p.fields.date,p.fields.coords,p.fields.node].map(v=>v.trim()).filter(Boolean);
 if(!lines.length||!rect||rect.w<10||rect.h<12)return;
 g.save();g.beginPath();g.rect(rect.x,rect.y,rect.w,rect.h);g.clip();
 let inset=Math.max(2,w*.004),lineHeight=1.07;
 let size=Math.max(9,Math.min(w*.036,rect.h/(lines.length*lineHeight))*p.fontSize/100);
 while(size>8){
  g.font=size+'px Arial, Helvetica, sans-serif';
  if(lines.every(v=>g.measureText(v).width<=rect.w-inset*2))break;
  size-=.6;
 }
 g.font=size+'px Arial, Helvetica, sans-serif';
 g.textAlign='right';g.textBaseline='top';g.fillStyle='white';
 g.shadowColor='rgba(16,16,18,.58)';g.shadowBlur=Math.max(1,size*.085);
 g.shadowOffsetX=Math.max(.5,size*.018);g.shadowOffsetY=Math.max(.5,size*.02);
 let left=rect.x+rect.w-inset;
 let top=rect.y+Math.max(0,(rect.h-lines.length*size*lineHeight)/2);
 lines.forEach((v,i)=>g.fillText(v,left,top+i*size*lineHeight));
 g.restore();
}
function drawLogo(g,p,w,h){
 const image=p.customLogo||defaultLogoImage;
 if(!p.logo.enabled||!image||!image.naturalWidth)return;
 let pw=w*p.logo.size/100,ph=pw*image.naturalHeight/image.naturalWidth;
 pw=Math.max(1,pw);ph=Math.max(1,ph);
 const left=clamp(w*p.logo.x/100-pw,0,w-pw),top=clamp(h*p.logo.y/100,0,h-ph);
 g.drawImage(image,left,top,pw,ph);
}
function render(p,canvas,maxSize=Infinity,original=false){
 const crop=cropSource(p),scale=Math.min(1,maxSize/Math.max(crop.w,crop.h));
 const w=Math.max(1,Math.round(crop.w*scale)),h=Math.max(1,Math.round(crop.h*scale));
 canvas.width=w;canvas.height=h;
 const g=canvas.getContext('2d',{willReadFrequently:true});
 g.drawImage(original?p.image:(p.aiImage||p.image),crop.x,crop.y,crop.w,crop.h,0,0,w,h);
 if(original)return canvas;
 const rect=rectOnOutput(p,p.region,crop,scale,w,h);
 if((p.watermarkMode==='replace'||p.watermarkMode==='remove')&&rect&&!p.aiCleanRegion)repairRegion(g,w,h,rect,p.repairMethod);
 applyAppearance(g,w,h,p.adjust);
 if(p.watermarkMode==='replace'&&rect)drawLabel(g,p,rect,w,h);
 if(p.watermarkMode==='add'){
  let textRegion={x:w*.25,y:h*.79,w:w*.745,h:h*.205};
  drawLabel(g,p,textRegion,w,h);
 }
 drawLogo(g,p,w,h);
 return canvas;
}
function paintPreview(){
 const p=active();if(!p)return;
 try{
  render(p,preview,1240,$('beforeAfter').checked);
  setZoomSize();
  if(dragSelection){
   let r=normalizedDrag(dragSelection);
   previewCtx.save();
   previewCtx.strokeStyle='#3dd4ff';previewCtx.fillStyle='rgba(36,163,255,.12)';
   previewCtx.setLineDash([9,5]);previewCtx.lineWidth=Math.max(1.5,preview.width/500);
   previewCtx.fillRect(r.x*preview.width,r.y*preview.height,r.w*preview.width,r.h*preview.height);
   previewCtx.strokeRect(r.x*preview.width,r.y*preview.height,r.w*preview.width,r.h*preview.height);
   previewCtx.restore();
  }
 }catch(e){status('No se pudo renderizar la fotografía: '+e.message);}
}
function setZoomSize(){
 const maxW=Math.max(180,stage.clientWidth-46),maxH=Math.max(220,stage.clientHeight-46);
 const fit=Math.min(maxW/preview.width,maxH/preview.height,1);
 const factor=zoomMode==='fit'?fit:Number(zoomMode);
 preview.style.width=Math.round(preview.width*factor)+'px';
 preview.style.height=Math.round(preview.height*factor)+'px';
}
function pointOnCanvas(event){
 const box=preview.getBoundingClientRect();
 return{x:clamp((event.clientX-box.left)/box.width,0,1),y:clamp((event.clientY-box.top)/box.height,0,1)};
}
function normalizedDrag(d){
 const x=Math.min(d.x0,d.x1),y=Math.min(d.y0,d.y1);
 return{x,y,w:Math.abs(d.x1-d.x0),h:Math.abs(d.y1-d.y0)};
}
function originalRect(p,v){
 const crop=cropSource(p),W=p.image.naturalWidth,H=p.image.naturalHeight;
 return{x:(crop.x+v.x*crop.w)/W,y:(crop.y+v.y*crop.h)/H,w:v.w*crop.w/W,h:v.h*crop.h/H};
}
function assignRegion(p,r){
 p.region=originalRect(p,r);p.aiCleanRegion=false;p.watermarkMode='replace';
 $('watermarkMode').value='replace';updateRegionNotice();
 status('Zona del rótulo guardada para esta fotografía. Edita los campos y observa el cambio.');
 renderPhotoList();schedulePreview();
}
preview.addEventListener('pointerdown',(e)=>{
 if(!active()||mode==='view')return;
 const xy=pointOnCanvas(e);dragOrigin=xy;
 if(mode==='logo'){setLogoPosition(xy);return;}
 dragSelection={x0:xy.x,y0:xy.y,x1:xy.x,y1:xy.y};
 preview.setPointerCapture(e.pointerId);
});
preview.addEventListener('pointermove',(e)=>{
 if(!dragOrigin||!active())return;
 const xy=pointOnCanvas(e);
 if(mode==='logo'){setLogoPosition(xy);return;}
 if(!dragSelection)return;
 dragSelection.x1=xy.x;dragSelection.y1=xy.y;schedulePreview();
});
preview.addEventListener('pointerup',()=>{
 if(!dragOrigin)return;dragOrigin=null;
 if(mode==='logo')return;
 if(!dragSelection)return;
 const r=normalizedDrag(dragSelection);dragSelection=null;
 if(r.w<.008||r.h<.008){schedulePreview();return;}
 if(mode==='watermark'){assignRegion(active(),r);}
 if(mode==='crop'){active().pendingCrop=originalRect(active(),r);status('Recorte seleccionado. Pulsa «Aplicar recorte».');}
 schedulePreview();
});
preview.addEventListener('pointercancel',()=>{dragOrigin=null;dragSelection=null;schedulePreview();});
function setLogoPosition(p){
 const item=active();if(!item)return;
 const width=item.logo.size/100;
 item.logo.x=Math.round(clamp(p.x+width*.5,width,1)*100);
 item.logo.y=Math.round(clamp(p.y,0,.90)*100);
 item.logo.enabled=true;
 $('showLogo').checked=true;
 $('logoX').value=item.logo.x;$('logoY').value=item.logo.y;
 updateSliderLabels();schedulePreview();
}
function parseOcrText(text){
 const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const raw=lines.join(' ');
 const nodeLine=lines.find(s=>/\b[A-Z]\s*\d{4,5}[_\s-]*SM/i.test(s))||'';
 let node='';
 let m=nodeLine.match(/\b([A-Z])\s*(\d{4,5})\s*[_\s-]+\s*SM\s*[_\s-]+\s*([A-ZÁÉÍÓÚÑ0-9_ \-]+)/i);
 if(m)node=(m[1]+m[2]+'_SM_'+m[3]).trim().replace(/\s+$/,'');
 else {m=raw.match(/\b[A-Z]\d{4,5}[_\s-]+SM[_\s-]+[A-Z0-9_ \-]+/i);if(m)node=m[0];}
 node=node.replace(/\s*_\s*/g,'_').replace(/_{2,}/g,'_').trim();
 if(node.length>75)node=node.slice(0,75);
 const coords=lines.find(s=>/[−-]\s*\d{1,3}[.,]\d{3,}\s*[SN]?[^\d]+[−-]\s*\d{1,3}[.,]\d{3,}\s*[EW]?/i.test(s))||'';
 const date=lines.find(s=>/(?:20\d{2})/.test(s)&&/(?:\b\d{1,2}\b|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i.test(s))||'';
 return{node,coords,date};
}
function findOcrRegion(data,p,scan){
 const allLines=(data.lines||[]).filter(x=>x.bbox && String(x.text||'').trim());
 const words=(data.words||[]).filter(x=>x.bbox && String(x.text||'').trim());
 const source=allLines.length?allLines:words;
 let match=source.filter(entry=>/20\d\d|[A-Z]\d{4,5}|_?SM_?|[−-]\s*\d+\.\d+|[SN][^\n]*[EW]/i.test(entry.text));
 if(!match.length)return null;
 let minX=Math.min(...match.map(x=>x.bbox.x0)),minY=Math.min(...match.map(x=>x.bbox.y0));
 let maxX=Math.max(...match.map(x=>x.bbox.x1)),maxY=Math.max(...match.map(x=>x.bbox.y1));
 const padding=Math.max(6,scan.width*.008);
 minX=clamp(minX-padding,0,scan.width);maxX=clamp(maxX+padding,0,scan.width);
 minY=clamp(minY-padding,0,scan.height);maxY=clamp(maxY+padding,0,scan.height);
 let originalX=scan.sx+minX/scan.scale,originalY=scan.sy+minY/scan.scale;
 let originalW=(maxX-minX)/scan.scale,originalH=(maxY-minY)/scan.scale;
 // Add space so edits remain inside the original three-line watermark footprint.
 return{x:originalX/p.image.naturalWidth,y:originalY/p.image.naturalHeight,w:originalW/p.image.naturalWidth,h:originalH/p.image.naturalHeight};
}
async function worker(){
 if(!window.Tesseract)throw new Error('La biblioteca OCR no está disponible. Revisa la conexión.');
 if(!ocrWorker)ocrWorker=await Tesseract.createWorker('eng');
 return ocrWorker;
}
async function recognize(p){
 p.ocrStatus='running';
 if(p===active()){$('ocrState').textContent='Leyendo…';}
 status('Reconociendo rótulo de '+p.file.name+'…');
 const W=p.image.naturalWidth,H=p.image.naturalHeight;
 const sx=W*.27,sy=H*.52,sw=W*.73,sh=H*.48;
 const scale=Math.min(2,1700/sw);
 const scan={sx,sy,scale,width:Math.max(1,Math.round(sw*scale)),height:Math.max(1,Math.round(sh*scale))};
 const off=document.createElement('canvas');off.width=scan.width;off.height=scan.height;
 off.getContext('2d').drawImage(p.image,sx,sy,sw,sh,0,0,off.width,off.height);
 try{
  const w=await worker();const result=await w.recognize(off);
  const data=result.data||{},parsed=parseOcrText(data.text);
  if(parsed.node)p.fields.node=parsed.node;
  if(parsed.date)p.fields.date=parsed.date;
  if(parsed.coords)p.fields.coords=parsed.coords;
  const region=findOcrRegion(data,p,scan);
  if(region){p.region=region;p.aiCleanRegion=false;p.watermarkMode='replace';}
  p.ocrStatus=region?'done':'failed';
  return{region,parsed};
 }catch(e){p.ocrStatus='failed';throw e;}
}
async function recognizeOne(){
 const p=active();if(!p||busy)return;
 busy=true;$('ocrSingle').disabled=true;
 try{
  const result=await recognize(p);
  showPhotoControls();renderPhotoList();
  if(result.region){status('OCR leído. Ya puedes editar fecha, coordenadas y nodo en esta foto.');toast('Rótulo localizado y preparado para edición.');}
  else{status('El OCR no localizó el rótulo con seguridad. Corrige los campos y marca manualmente la zona.');toast('Revisa y marca la zona del rótulo.');}
 }catch(e){status('Error de OCR: '+e.message);toast('No fue posible completar el OCR.');}
 finally{busy=false;$('ocrSingle').disabled=false;}
}
async function recognizeAll(){
 if(busy||!photos.length)return;
 busy=true;$('ocrBatch').disabled=true;
 try{
  for(let i=0;i<photos.length;i++){
   try{await recognize(photos[i]);}catch(e){photos[i].ocrStatus='failed';}
   status('OCR de fotografías: '+(i+1)+' / '+photos.length);
   renderPhotoList();if(active()===photos[i])showPhotoControls();
   await new Promise(r=>setTimeout(r,0));
  }
  toast('Análisis OCR terminado. Revisa cada fotografía de forma independiente.');
 }finally{busy=false;$('ocrBatch').disabled=false;showPhotoControls();}
}
function downloadBlob(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function makeBlob(canvas){
 const format=$('outputFormat').value,q=Number($('jpegQuality').value)/100;
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Error al exportar')),format,q));
}
async function exportSingle(){
 const p=active();if(!p||busy)return;
 if(p.watermarkMode==='replace'&&!p.region){toast('Primero lee el rótulo con OCR o selecciona su zona.');switchTab('watermark');return;}
 busy=true;
 try{const canvas=document.createElement('canvas');render(p,canvas);
  const blob=await makeBlob(canvas);
  downloadBlob(blob,filenameOf(p,current));
  status('Archivo descargado: '+filenameOf(p,current));
  toast('Fotografía exportada correctamente.');
 }catch(e){status('Error de exportación: '+e.message);}
 finally{busy=false;}
}
async function exportAll(){
 if(!photos.length||busy)return;
 if(!window.JSZip){toast('No se pudo cargar la biblioteca ZIP. Comprueba tu conexión.');return;}
 const unselected=photos.find(p=>p.watermarkMode==='replace'&&!p.region);
 if(unselected){selectPhoto(photos.indexOf(unselected));switchTab('watermark');toast('Falta marcar el rótulo de «'+unselected.file.name+'».');return;}
 busy=true;
 $('progressWrap').hidden=false;
 const zip=new JSZip(),used=new Set(),buffer=document.createElement('canvas');
 try{
  for(let i=0;i<photos.length;i++){
   const p=photos[i];render(p,buffer);
   zip.file(filenameOf(p,i,used),await makeBlob(buffer));
   $('progressBar').style.width=(80*(i+1)/photos.length)+'%';
   status('Exportando '+(i+1)+' de '+photos.length+' fotografías…');
   await new Promise(done=>setTimeout(done,0));
  }
  const audit=photos.filter(p=>p.aiEdits?.length).map(p=>({originalFile:p.file.name,outputFile:filenameOf(p,photos.indexOf(p)),modifiedAt:new Date().toISOString(),editedWithAI:true,instructions:p.aiEdits,finalLabel:{...p.fields}}));
  if(audit.length)zip.file('FotoNodos_historial_ediciones.json',JSON.stringify({notice:'Ediciones digitales realizadas sobre fotografías originales; no certifica fecha de captura',files:audit},null,2));
  const result=await zip.generateAsync({type:'blob',compression:'STORE'},meta=>{$('progressBar').style.width=(80+meta.percent*.2)+'%';});
  downloadBlob(result,'FotoNodos_Studio.zip');
  status('Se exportaron '+photos.length+' fotografías con nombres basados en sus nodos.');
  toast('ZIP generado con '+photos.length+' fotografías.');
 }catch(e){status('No se pudo exportar ZIP: '+e.message);}
 finally{busy=false;setTimeout(()=>{$('progressWrap').hidden=true;$('progressBar').style.width='0%';},1800);}
}
$('upload').addEventListener('change',e=>{addFiles(e.target.files);e.target.value='';});
$('dropZone').addEventListener('dragover',e=>{e.preventDefault();$('dropZone').classList.add('dragging');});
$('dropZone').addEventListener('dragleave',()=>$('dropZone').classList.remove('dragging'));
$('dropZone').addEventListener('drop',e=>{e.preventDefault();$('dropZone').classList.remove('dragging');addFiles(e.dataTransfer.files);});
$('dropZone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('upload').click();}});
$('clearAll').addEventListener('click',()=>{
 if(!photos.length)return;
 photos.forEach(p=>{URL.revokeObjectURL(p.url);if(p.aiUrl)URL.revokeObjectURL(p.aiUrl);for(const h of p.aiHistory||[])if(h.url)URL.revokeObjectURL(h.url);});
 photos=[];current=-1;
 renderPhotoList();showPhotoControls();toast('Lista de fotografías vaciada.');
});
$('ocrBatch').addEventListener('click',recognizeAll);
$('ocrSingle').addEventListener('click',recognizeOne);
$('markRegion').addEventListener('click',()=>{switchTool('watermark');switchTab('watermark');});
all('.tab').forEach(el=>el.addEventListener('click',()=>switchTab(el.dataset.tab)));
all('.tool').forEach(el=>el.addEventListener('click',()=>switchTool(el.dataset.tool)));
$('prev').addEventListener('click',()=>{if(photos.length)selectPhoto((current-1+photos.length)%photos.length);});
$('next').addEventListener('click',()=>{if(photos.length)selectPhoto((current+1)%photos.length);});
$('zoom').addEventListener('change',e=>{zoomMode=e.target.value;setZoomSize();});
window.addEventListener('resize',()=>{if(active())setZoomSize();});
$('beforeAfter').addEventListener('change',schedulePreview);
$('applyCrop').addEventListener('click',()=>{
 const p=active();if(!p||!p.pendingCrop){toast('Primero arrastra el área que deseas recortar.');return;}
 p.crop=p.pendingCrop;p.pendingCrop=null;
 $('undoCrop').hidden=false;
 switchTool('view');showPhotoControls();schedulePreview();
 toast('Recorte aplicado solo a esta fotografía.');
});
$('undoCrop').addEventListener('click',()=>{const p=active();if(!p)return;p.crop=null;p.pendingCrop=null;showPhotoControls();schedulePreview();toast('Se restauró la imagen completa.');});
for(let [id,field] of [['fieldNode','node'],['fieldDate','date'],['fieldCoords','coords']]){
 $(id).addEventListener('input',e=>{
  const p=active();if(!p)return;
  p.fields[field]=e.target.value;refreshNames();renderPhotoList();schedulePreview();
 });
}
$('watermarkMode').addEventListener('change',e=>{const p=active();if(!p)return;p.watermarkMode=e.target.value;updateRegionNotice();schedulePreview();});
$('fontSize').addEventListener('input',e=>{const p=active();if(!p)return;p.fontSize=Number(e.target.value);updateSliderLabels();schedulePreview();});
$('repairMethod').addEventListener('change',e=>{const p=active();if(!p)return;p.repairMethod=e.target.value;schedulePreview();});
$('showLogo').addEventListener('change',e=>{const p=active();if(!p)return;p.logo.enabled=e.target.checked;schedulePreview();});
for(let id of ['logoSize','logoX','logoY']){
 $(id).addEventListener('input',e=>{const p=active();if(!p)return;p.logo[id==='logoSize'?'size':id==='logoX'?'x':'y']=Number(e.target.value);updateSliderLabels();schedulePreview();});
}
$('resetLogo').addEventListener('click',()=>{const p=active();if(!p)return;p.customLogo=null;p.logo.enabled=true;$('showLogo').checked=true;updateLogoCard();schedulePreview();toast('Logo YOFC restaurado para esta fotografía.');});
$('customLogo').addEventListener('change',async e=>{
 const p=active();if(!p||!e.target.files[0])return;
 const url=URL.createObjectURL(e.target.files[0]);
 try{
  const image=await createImage(url);
  p.customLogo=image;p.logo.enabled=true;$('showLogo').checked=true;updateLogoCard();schedulePreview();
  toast('Logo personalizado aplicado solo a esta fotografía.');
 }catch(err){toast('No se pudo cargar el logo.');}
 finally{e.target.value='';}
});
for(const id of ['aging','saturation','brightness','contrast','warmth','grain']){
 $(id).addEventListener('input',e=>{const p=active();if(!p)return;p.adjust[id]=Number(e.target.value);updateSliderLabels();schedulePreview();});
}
$('twoYearPreset').addEventListener('click',()=>{
 const p=active();if(!p)return;
 p.adjust={aging:55,saturation:76,brightness:90,contrast:88,warmth:12,grain:12};
 showPhotoControls();schedulePreview();toast('Aspecto envejecido aplicado a esta fotografía.');
});
$('resetAdjust').addEventListener('click',()=>{const p=active();if(!p)return;p.adjust=defaultAdjust();showPhotoControls();schedulePreview();});
for(const id of ['namePattern','outputFormat'])$(id).addEventListener('change',refreshNames);
$('jpegQuality').addEventListener('input',()=>{$('jpegQualityVal').textContent=$('jpegQuality').value+'%';});
$('downloadCurrent').addEventListener('click',exportSingle);
$('downloadAll').addEventListener('click',exportAll);
$('topZip').addEventListener('click',()=>{switchTab('export');exportAll();});

/* OpenAI image editor. API credentials remain on Vercel, never in this file. */
async function checkAIStatus(){
 try{
  const r=await fetch('/api/edit',{cache:'no-store'});
  const info=await r.json();
  const ready=Boolean(info.configured);
  $('aiState').textContent=ready?'IA disponible':'Falta configurar';
  $('aiState').classList.toggle('ready',ready);
  $('aiState').classList.toggle('warn',!ready);
  $('aiMessage').textContent=ready?
   'La IA está conectada. Introduce la contraseña de acceso y escribe qué deseas modificar. Cada ejecución puede consumir crédito de API.':
   'Para activar la IA, añade OPENAI_API_KEY y FOTONODOS_AI_PASSWORD en Vercel → FotoNodos Studio → Settings → Environment Variables y vuelve a desplegar.';
  $('aiGenerate').disabled=!ready;
 }catch(e){
  $('aiState').textContent='Sin conexión';
  $('aiMessage').textContent='No se pudo comprobar el servicio de IA. Revisa la configuración de Vercel.';
 }
}
function aiNotice(text){
 $('aiMessage').textContent=text;
 status(text);
}
function canvasDataUrl(canvas,mime,quality){
 return canvas.toDataURL(mime,quality);
}
function buildAIInput(photo,operation){
 const crop=cropSource(photo),source=photo.aiImage||photo.image;
 let maxSide=1400,work=document.createElement('canvas'),mask=document.createElement('canvas');
 let imageData='',maskData=null,w=0,h=0,rect=null,scale=1;
 for(let attempt=0;attempt<4;attempt++){
  scale=Math.min(1,maxSide/Math.max(crop.w,crop.h));
  w=Math.max(1,Math.round(crop.w*scale));
  h=Math.max(1,Math.round(crop.h*scale));
  work.width=w;work.height=h;
  work.getContext('2d').drawImage(source,crop.x,crop.y,crop.w,crop.h,0,0,w,h);
  imageData=canvasDataUrl(work,'image/jpeg',.78);
  maskData=null;rect=null;
  if(operation!=='full'){
   rect=rectOnOutput(photo,photo.region,crop,scale,w,h);
   if(!rect||rect.w<3||rect.h<3)throw Error('No hay un rótulo o región de edición dentro del recorte actual. Selecciónalo en la fotografía.');
   mask.width=w;mask.height=h;
   const g=mask.getContext('2d');
   g.fillStyle='#fff';g.fillRect(0,0,w,h);
   g.clearRect(rect.x,rect.y,rect.w,rect.h);
   maskData=canvasDataUrl(mask,'image/png');
  }
  if(imageData.length+(maskData?.length||0)<3100000)break;
  maxSide=Math.round(maxSide*.78);
 }
 if(imageData.length+(maskData?.length||0)>=3100000)throw Error('La imagen excede el límite de envío. Recórtala o utiliza una selección más pequeña.');
 return{image:imageData,mask:maskData,crop,rect,scale};
}
async function parseAIInstruction(instruction,p,password){
 const r=await fetch('/api/interpret',{
  method:'POST',
  headers:{'Content-Type':'application/json','X-Fotonodos-Password':password},
  body:JSON.stringify({instruction,current:p.fields})});
 let data={};
 try{data=await r.json();}catch{throw Error('No fue posible interpretar la instrucción.');}
 if(!r.ok)throw Error(data.error||'No fue posible interpretar las instrucciones.');
 for(const field of ['node','date','coords']){
  if(typeof data[field]==='string'&&data[field].trim())p.fields[field]=data[field].trim();
 }
 return data.imageInstruction||instruction;
}
async function applyAIResult(photo,blob,input,operation,instruction){
 const tmpUrl=URL.createObjectURL(blob);
 let generated;
 try{generated=await createImage(tmpUrl);}catch(e){URL.revokeObjectURL(tmpUrl);throw Error('La IA devolvió una imagen que no se puede abrir.');}
 const W=photo.image.naturalWidth,H=photo.image.naturalHeight;
 const output=document.createElement('canvas');output.width=W;output.height=H;
 const g=output.getContext('2d');
 g.drawImage(photo.aiImage||photo.image,0,0,W,H);
 const crop=input.crop;
 let region=operation==='full'?{x:crop.x,y:crop.y,w:crop.w,h:crop.h}:{
  x:photo.region.x*W,y:photo.region.y*H,w:photo.region.w*W,h:photo.region.h*H};
 g.save();g.beginPath();g.rect(region.x,region.y,region.w,region.h);g.clip();
 g.drawImage(generated,crop.x,crop.y,crop.w,crop.h);
 g.restore();URL.revokeObjectURL(tmpUrl);
 const finalBlob=await new Promise((resolve,reject)=>output.toBlob(b=>b?resolve(b):reject(Error('No se pudo integrar el resultado de IA.')),'image/jpeg',.94));
 const url=URL.createObjectURL(finalBlob);
 let resultImage;
 try{resultImage=await createImage(url);}catch(e){URL.revokeObjectURL(url);throw e;}
 photo.aiHistory.push({image:photo.aiImage,url:photo.aiUrl,clean:photo.aiCleanRegion,watermarkMode:photo.watermarkMode});
 if(photo.aiHistory.length>4){
  const old=photo.aiHistory.shift();if(old.url)URL.revokeObjectURL(old.url);
 }
 photo.aiImage=resultImage;photo.aiUrl=url;
 photo.aiCleanRegion=operation==='label';
 photo.watermarkMode=operation==='label'?'replace':'keep';
 photo.aiEdits.push({instruction,mode:operation,editedAt:new Date().toISOString()});
}
async function generateWithAI(){
 const p=active();if(!p){toast('Primero selecciona una fotografía.');return;}
 if(busy){toast('Ya se está procesando una operación.');return;}
 const password=$('aiPassword').value;
 const instruction=$('aiInstruction').value.trim();
 const operation=$('aiOperation').value;
 if(!password){toast('Introduce la contraseña de IA configurada en Vercel.');return;}
 if(!instruction){toast('Escribe qué deseas modificar en esta fotografía.');return;}
 p.aiInstruction=instruction;
 busy=true;$('aiGenerate').disabled=true;$('aiProgress').hidden=false;
 try{
  aiNotice('1/3 · Interpretando la instrucción y sus cambios de fecha, coordenadas o nodo…');
  const prompt=await parseAIInstruction(instruction,p,password);
  refreshNames();renderPhotoList();
  if(operation==='label'&&!p.region){
   aiNotice('2/3 · Buscando el rótulo original con OCR…');
   try{await recognize(p);}catch(e){/* El usuario puede delimitarlo manualmente. */}
  }
  if(operation!=='full'&&!p.region){
   showPhotoControls();
   throw Error('No se localizó el rótulo. Pulsa «Seleccionar rótulo», marca su zona en la foto y vuelve a generar.');
  }
  const input=buildAIInput(p,operation);
  aiNotice('2/3 · La IA está reconstruyendo la zona seleccionada…');
  const response=await fetch('/api/edit',{
   method:'POST',
   headers:{'Content-Type':'application/json','X-Fotonodos-Password':password},
   body:JSON.stringify({mode:operation,image:input.image,mask:input.mask,instructions:prompt})});
  if(!response.ok){
   const data=await response.json().catch(()=>({}));
   throw Error(data.error||('La IA devolvió HTTP '+response.status));
  }
  aiNotice('3/3 · Integrando el resultado en la fotografía original…');
  const generated=await response.blob();
  await applyAIResult(p,generated,input,operation,instruction);
  if(p===active()){showPhotoControls();schedulePreview();}
  renderPhotoList();
  aiNotice('Edición con IA completada. Revisa el resultado y descárgalo con el nombre de nodo.');
  toast('La fotografía se editó con IA. Puedes deshacer.');
 }catch(e){
  aiNotice('No se pudo completar: '+e.message);
 }finally{
  busy=false;$('aiProgress').hidden=true;$('aiGenerate').disabled=false;
 }
}
function undoAI(){
 const p=active();if(!p||!p.aiHistory.length)return;
 if(p.aiUrl)URL.revokeObjectURL(p.aiUrl);
 const previous=p.aiHistory.pop();
 p.aiImage=previous.image;p.aiUrl=previous.url;
 p.aiCleanRegion=previous.clean;p.watermarkMode=previous.watermarkMode;
 p.aiEdits.pop();
 showPhotoControls();schedulePreview();
 aiNotice('Se restauró la versión anterior de esta fotografía.');
}
$('aiInstruction').addEventListener('input',(e)=>{if(active())active().aiInstruction=e.target.value;});
all('.ai-example').forEach(el=>el.addEventListener('click',()=>{
 $('aiInstruction').value=el.dataset.example||'';
 if(active())active().aiInstruction=$('aiInstruction').value;
}));
$('aiOperation').addEventListener('change',()=>{
 const action=$('aiOperation').value;
 $('aiRegionNotice').textContent=action==='full'?
  'La IA editará toda la fotografía visible. Revisa el resultado porque puede modificar otros detalles.':
  active()?.region?'Región de edición marcada para esta foto.':
  'Debes marcar el área del rótulo con OCR o con la herramienta «Seleccionar rótulo».';
});
$('aiGenerate').addEventListener('click',generateWithAI);
$('aiUndo').addEventListener('click',undoAI);

window.addEventListener('keydown',e=>{
 if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
 if(e.key==='ArrowRight'&&photos.length){e.preventDefault();selectPhoto((current+1)%photos.length);}
 else if(e.key==='ArrowLeft'&&photos.length){e.preventDefault();selectPhoto((current-1+photos.length)%photos.length);}
 else if(e.key==='Escape'){dragSelection=null;schedulePreview();}
});
async function bootstrap(){
 if(window.FOTONODOS_YOFC_DATA){
  try{defaultLogoImage=await createImage(window.FOTONODOS_YOFC_DATA);$('logoPreview').src=window.FOTONODOS_YOFC_DATA;}
  catch(e){status('No se pudo cargar el logo predeterminado.');}
 }
 showPhotoControls();renderPhotoList();switchTool('view');switchTab('watermark');
 checkAIStatus();
}
bootstrap();
})();