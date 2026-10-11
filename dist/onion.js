import {composite} from './engine.js';
// Remove stationary pixels per layer before compositing. Static backgrounds
// should neither cover the onion nor tint the whole canvas.
export function onionPixels(p,frame,neighbor,selectedLayer=-1){
 if(neighbor<0||neighbor>=p.frames.length||neighbor===frame)return null;
 const before=p.frames[neighbor],current=p.frames[frame],cels=before.cels.map((cel,li)=>{const out=new Uint8ClampedArray(cel.length);if(p.layers[li].group||(selectedLayer>=0&&li!==selectedLayer))return out;const now=current.cels[li];for(let i=0;i<cel.length;i+=4)if(cel[i+3]&&(cel[i]!==now[i]||cel[i+1]!==now[i+1]||cel[i+2]!==now[i+2]||cel[i+3]!==now[i+3]))out.set(cel.subarray(i,i+4),i);return out;});
 const pixels=composite({...p,frames:[{...before,cels}]},0),color=neighbor<frame?[255,95,132]:[77,227,187];for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]){pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];}return pixels;
}
