import {getPerfectPixel} from './perfect-pixel.js';
self.onmessage=({data:{id,image,options}})=>{try{const result=getPerfectPixel(image,options);self.postMessage({id,result},[result.data.buffer]);}catch(e){self.postMessage({id,error:e.message||'图片转换失败'});}};
