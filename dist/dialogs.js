const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
export async function showDialog(dialog){dialog.classList.remove('leaving');if(!dialog.open)dialog.showModal();if(!reduced())dialog.animate([{opacity:0,transform:'translateY(18px) scale(.97)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});}
export async function hideDialog(dialog){if(!dialog.open)return;dialog.classList.add('leaving');if(!reduced())await dialog.animate([{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(12px) scale(.97)'}],{duration:150,easing:'ease-in',fill:'forwards'}).finished.catch(()=>{});dialog.close();dialog.classList.remove('leaving');dialog.getAnimations().forEach(a=>a.cancel());}
export function askDialog({title,description='',value,confirm='确定',danger=false}){
 const d=document.querySelector('#action-dialog'),form=d.querySelector('form'),field=d.querySelector('input'),isText=value!==undefined;
 d.querySelector('h2').textContent=title;d.querySelector('p').textContent=description;field.hidden=!isText;field.value=value??'';field.required=isText;
 const ok=d.querySelector('[type=submit]');ok.textContent=confirm;ok.className=danger?'destructive':'primary';
 showDialog(d);requestAnimationFrame(()=>{if(isText){field.focus();field.select();}else d.querySelector('[data-cancel]').focus();});
 return new Promise(resolve=>{let settled=false;const finish=async result=>{if(settled)return;settled=true;await hideDialog(d);resolve(result);};form.onsubmit=e=>{e.preventDefault();if(isText&&!field.value.trim())return;finish(isText?field.value.trim():true);};d.querySelector('[data-cancel]').onclick=()=>finish(null);d.oncancel=e=>{e.preventDefault();finish(null);};d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)finish(null);}};});
}
