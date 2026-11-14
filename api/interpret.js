'use strict';
const {timingSafeEqual}=require('node:crypto');
const json=(res,code,data)=>res.status(code).setHeader('Cache-Control','no-store').json(data);
module.exports=async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Método no permitido.'});
 if(!process.env.OPENAI_API_KEY||!process.env.FOTONODOS_AI_PASSWORD)return json(res,503,{error:'Configura OPENAI_API_KEY y FOTONODOS_AI_PASSWORD en Vercel.'});
 const given=Buffer.from(String(req.headers['x-fotonodos-password']||'')),actual=Buffer.from(process.env.FOTONODOS_AI_PASSWORD);
 if(!given.length||given.length!==actual.length||!timingSafeEqual(given,actual))return json(res,401,{error:'Contraseña de IA incorrecta.'});
 const origin=req.headers.origin;
 if(origin){try{if(new URL(origin).host!==req.headers.host)return json(res,403,{error:'Origen no autorizado.'});}catch{return json(res,403,{error:'Origen no autorizado.'});}}
 let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return json(res,400,{error:'Solicitud inválida.'});}
 const instruction=String(body?.instruction||'').trim(),current=body?.current||{};
 if(!instruction||instruction.length>4000)return json(res,400,{error:'Escribe una instrucción breve.'});
 const fields={node:String(current.node||'').slice(0,100),date:String(current.date||'').slice(0,100),coords:String(current.coords||'').slice(0,100)};
 const prompt='Eres un intérprete preciso de órdenes para editar fotografías técnicas. A partir de la instrucción del usuario y los valores actuales de un rótulo de fotografía, devuelve SOLO JSON con cuatro propiedades: node, date, coords e imageInstruction. Para node/date/coords devuelve null si no hay modificación explícita, y un string con el valor COMPLETO solicitado si sí hay cambio; conserva las partes del valor original que la instrucción no pide cambiar. Nunca inventes números, fechas, horas o coordenadas. No cambies identificadores si solo se pide otro ajuste. imageInstruction será la petición literal del usuario reexpresada brevemente en español sin añadir cambios. JSON únicamente.\nValores actuales: '+JSON.stringify(fields)+'\nInstrucción: '+instruction;
 let response;
 try{
  response=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({model:'gpt-5.4-mini',messages:[{role:'user',content:prompt}],response_format:{type:'json_object'},max_completion_tokens:480}),signal:AbortSignal.timeout(35000)});
 }catch(e){return json(res,504,{error:'Error de conexión con OpenAI al interpretar la instrucción.'});}
 if(!response.ok){let detail='';try{detail=(await response.json()).error?.message||'';}catch{}return json(res,502,{error:'No se pudo interpretar la instrucción. '+String(detail).slice(0,220)});}
 let parsed;
 try{const payload=await response.json();parsed=JSON.parse(payload.choices?.[0]?.message?.content||'{}');}
 catch{return json(res,502,{error:'OpenAI no devolvió una interpretación válida.'});}
 const out={};
 for(const key of ['node','date','coords'])out[key]=typeof parsed[key]==='string'?parsed[key].trim().slice(0,130):null;
 out.imageInstruction=typeof parsed.imageInstruction==='string'?parsed.imageInstruction.slice(0,2000):instruction;
 return json(res,200,out);
};