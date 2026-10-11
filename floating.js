// Nonmodal floating panels: the canvas stays interactive and never shifts.
export function floatingPanel(element,{onClose=()=>{},titleHandle,collapseButton,closeButton}={}){
 let drag=null,closed=false;const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 const clamp=()=>{if(closed)return;const r=element.getBoundingClientRect();element.style.left=Math.max(8,Math.min(innerWidth-r.width-8,r.left))+'px';element.style.top=Math.max(8,Math.min(innerHeight-r.height-8,r.top))+'px';element.style.right='auto';};
 const close=()=>{if(closed)return;closed=true;window.removeEventListener('resize',clamp);onClose();if(reduced()){element.remove();return;}element.style.pointerEvents='none';element.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.96)'}],{duration:140}).finished.catch(()=>{}).then(()=>element.remove());};
 titleHandle.onpointerdown=e=>{if(e.target.closest('button,input,select,a'))return;e.preventDefault();const r=element.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};titleHandle.setPointerCapture(e.pointerId);};
 titleHandle.onpointermove=e=>{if(drag?.id!==e.pointerId)return;element.style.left=drag.left+e.clientX-drag.x+'px';element.style.top=drag.top+e.clientY-drag.y+'px';element.style.right='auto';clamp();};
 titleHandle.onpointerup=titleHandle.onpointercancel=()=>drag=null;
 collapseButton.onclick=()=>{const collapsed=element.classList.toggle('float-collapsed');collapseButton.setAttribute('aria-expanded',!collapsed);collapseButton.textContent=collapsed?'⌄':'−';element.querySelectorAll('.plugins-body,.plugins-footer').forEach(part=>part.inert=collapsed);setTimeout(clamp,reduced()?0:250);};
 closeButton.onclick=close;window.addEventListener('resize',clamp);
 if(!reduced())element.animate([{opacity:0,transform:'translateY(-6px) scale(.97)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:190,easing:'cubic-bezier(.2,.8,.2,1)'});
 return {close};
}
