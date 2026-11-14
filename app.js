'use strict';
const $=id=>document.getElementById(id),cv=$('canvas'),g=cv.getContext('2d',{willReadFrequently:true});
let pics=[],idx=0,logo=null,start=null,selection=null,working=false,raf=0;
const curr=()=>pics[idx],clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const message=s=>$('status').textContent=s;
const data=()=>({node:$('node').value,date:$('date').value,coords:$('coords').value});
const saveData=()=>{if(curr())curr().data=data()};
const loadData=()=>{let d=curr()?.data||{node:'',date:'',coords:''};$('node').value=d.node;$('date').value=d.date;$('coords').value=d.coords};
function image(file){return new Promise((ok,no)=>{const url=URL.createObjectURL(file),im=new Image();im.onload=()=>{URL.revokeObjectURL(url);ok(im)};im.onerror=()=>no(Error('Imagen inválida'));im.src=url})}
async function add(files){let arr=[...files].filter(f=>f.type.startsWith('image/'));for(let file of arr){try{let im=await image(file);pics.push({im,file,data:{node:'',date:'',coords:''},crop:null,erase:null})}catch(e){message(e.message)}}if(arr.length){idx=pics.length-arr.length;loadData();thumbs();refresh();message(pics.length+' fotografías cargadas')}}
$('files').onchange=async e=>{await add(e.target.files);e.target.value=''};
$('logo').onchange=async e=>{if(e.target.files[0]){logo=await image(e.target.files[0]);requestDraw()}};
$('clear').onclick=()=>{pics=[];idx=0;loadData();thumbs();refresh()};
$('previous').onclick=()=>{if(pics.length){saveData();idx=(idx+pics.length-1)%pics.length;loadData(���q�^