'use strict';
const {timingSafeEqual}=require('node:crypto');
const json=(res,status,data)=>{res.status(status).setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(data));};
function authorize(req){
 const configured=Boolean(process.env.OPENAI_API_KEY&&process.env.FOTONODOS_AI_PASSWORD);
 if(!configured)return{ok:false,status:503,error:'Configura OPENAI_API_KEY y FOTONODOS_AI_PASSWORD en el proyecto de Vercel.'};
 const sent=String(req.headers['x-fotonodos-password']||'');
 const expected=process.env.FOTONODOS_AI_PASSWORD;
 const a=Buffer.from(sent),b=Buffer.from(expected);
 if(!a.length||a.length!==b.length||!timingSafeEqual(a,b))return{ok:false,status:401,error:'Contraseña de IA incorrecta.'};
 const origin=req.headers.origin;
 if(origin){
  try{if(new URL(origin).host!==req.headers.host)return{ok:false,status:403,error:'Origen no autorizado.'};}
  catch{return{ok:false,status:403,error:'Origen no autorizado.'};}
 }
 return{ok:true};
}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store, private');
 if(req.method==='GET')return json(res,200,{configured:Boolean(process.env.OPENAI_API_KEY&&process.env.FOTONODOS_AI_PASSWORD),passwordRequired:true,model:'gpt-image-2.5-sunburst'});
 if(req.method!=='POST')return json(res,405,{error:'Método no permitido.'});
 const auth=authorize(req);
 if(!auth.ok)return json(res,auth.status,{error:auth.error});
 if(Number(req.headers['content-length']||0)>3900000)return json(res,413,{error:'La fotografía enviada es demasiado grande; reduce su resolución.'});
 let body;
 try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return json(res,400,{error:'JSON inválido.'});}
 const image=String(body?.image||''),mask=body?.mask?String(body.mask):'',instructions=String(body?.instructions||'').slice(0,2500),mode=body?.mode;
 if(!['label','local','full'].includes(mode))return json(res,400,{error:'Modo de edición desconocido.'});
 if(!instructions.trim())return json(res,400,{error:'Escribe una instrucción para la IA.'});
 if(image.length>3300000||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image))return json(res,400,{error:'Formato de fotografía inválido o demasiado grande.'});
 if(mode!=='full'&&(!mask||mask.length>2000000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(mask)))return json(res,400,{error:'Para editar solo una región necesitas seleccionar el rótulo o el área de trabajo.'});
 const prompt=mode==='label'?
  'Professional photographic inpainting. Remove ONLY the existing on-photo GPS/date/time/node white text overlay inside the transparent editable region of the supplied mask and reconstruct the original background surface accurately: its lighting, texture, imperfections and perspective. Preserve all the surrounding image details, hardware, screws, edges, and shapes. Do not add any letters, numbers, logo, watermark, captions or labels. The user will add exact replacement lettering separately with deterministic software. Additional user intent: '+instructions:
  mode==='local'?
  'Edit ONLY the transparent region of the supplied mask as instructed. Preserve photographic realism, context, lighting and physical details elsewhere, and do not alter unrelated areas. User instruction: '+instructions:
  'Photorealistic, high-fidelity edit of the supplied photograph. Preserve original composition and all areas not requested. User instruction: '+instructions;
 const imageMime=image.slice(5,image.indexOf(';'));
 const imageBuffer=Buffer.from(image.slice(image.indexOf(',')+1),'base64');
 const form=new FormData();
 form.append('model','gpt-image-2.5-sunburst');
 form.append('prompt',prompt);
 form.append('quality','medium');
 form.append('size','auto');
 form.append('output_format','jpeg');
 form.append('output_compression','75');
 form.append('image[]',new Blob([imageBuffer],{type:imageMime}),imageMime==='image/png'?'source.png':'source.jpg');
 if(mode!=='full'){
  const maskBuffer=Buffer.from(mask.slice(mask.indexOf(',')+1),'base64');
  form.append('mask',new Blob([maskBuffer],{type:'image/png'}),'mask.png');
 }
 let upstream;
 try{
  upstream=await fetch('https://api.openai.com/v1/images/edits',{
   method:'POST',
   headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},
   body:form,signal:AbortSignal.timeout(170000)});
 }catch(e){return json(res,504,{error:'No se pudo completar la solicitud a OpenAI: '+(e.name==='TimeoutError'?'tiempo de espera superado':'error de conexión')});}
 if(!upstream.ok){
  let detail='';try{const parsed=await upstream.json();detail=String(parsed.error?.message||'').slice(0,400);}catch{}
  return json(res,upstream.status===429?429:502,{error:'OpenAI no generó la edición. '+detail});
 }
 let result;try{result=await upstream.json();}catch{return json(res,502,{error:'OpenAI devolvió una respuesta inesperada.'});}
 const b64=result.data?.[0]?.b64_json;
 if(!b64||typeof b64!=='string')return json(res,502,{error:'OpenAI no devolvió una imagen.'});
 const bytes=Buffer.from(b64,'base64');
 if(bytes.length>3900000)return json(res,502,{error:'La imagen generada excedió el tamaño admitido por Vercel. Reintenta con otra selección.'});
 res.status(200);
 res.setHeader('Content-Type','image/jpeg');
 res.setHeader('Content-Length',String(bytes.length));
 res.setHeader('X-Fotonodos-Model','gpt-image-2.5-sunburst');
 res.end(bytes);
};