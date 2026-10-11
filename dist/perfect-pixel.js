// Browser adaptation of theAmusing/perfectPixel 0.1.4 (MIT).
// FFT grid detection → Sobel boundary refinement → cell sampling.
// See perfect-pixel-LICENSE.txt for provenance and local modifications.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function fftRadix(re,im,inverse=false){
 const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len*=2){const a=(inverse?2:-2)*Math.PI/len,cr=Math.cos(a),ci=Math.sin(a);for(let start=0;start<n;start+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){const p=start+j,q=p+len/2,tr=re[q]*wr-im[q]*wi,ti=re[q]*wi+im[q]*wr;re[q]=re[p]-tr;im[q]=im[p]-ti;re[p]+=tr;im[p]+=ti;const next=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=next;}}}
 if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
// Bluestein preserves arbitrary source dimensions instead of stretching to powers of two.
function fftPlan(n){
 if((n&(n-1))===0)return (r,i)=>fftRadix(r,i);
 let m=1;while(m<2*n-1)m*=2;const cos=new Float64Array(n),sin=new Float64Array(n),br=new Float64Array(m),bi=new Float64Array(m),ar=new Float64Array(m),ai=new Float64Array(m);
 for(let k=0;k<n;k++){const a=Math.PI*(k*k%(2*n))/n;cos[k]=Math.cos(a);sin[k]=Math.sin(a);br[k]=cos[k];bi[k]=sin[k];if(k){br[m-k]=cos[k];bi[m-k]=sin[k];}}fftRadix(br,bi);
 return (r,i)=>{ar.fill(0);ai.fill(0);for(let k=0;k<n;k++){ar[k]=r[k]*cos[k]+i[k]*sin[k];ai[k]=i[k]*cos[k]-r[k]*sin[k];}fftRadix(ar,ai);for(let k=0;k<m;k++){const a=ar[k]*br[k]-ai[k]*bi[k];ai[k]=ar[k]*bi[k]+ai[k]*br[k];ar[k]=a;}fftRadix(ar,ai,true);for(let k=0;k<n;k++){r[k]=ar[k]*cos[k]+ai[k]*sin[k];i[k]=ai[k]*cos[k]-ar[k]*sin[k];}};
}
function normalize(v){let lo=Infinity,hi=-Infinity;for(const x of v){lo=Math.min(lo,x);hi=Math.max(hi,x);}return Float64Array.from(v,x=>hi-lo<1e-8?0:(x-lo)/(hi-lo));}
function smooth(v){const k=17,sigma=k/6,ker=Array.from({length:k},(_,i)=>Math.exp(-((i-8)**2)/(2*sigma*sigma))),sum=ker.reduce((a,b)=>a+b);return Float64Array.from(v,(_,i)=>ker.reduce((s,w,j)=>s+(v[i+j-8]||0)*w/sum,0));}
function detectPeak(proj){const center=Math.floor(proj.length/2),candidates=[];let max=0;for(const x of proj)max=Math.max(max,x);if(max<1e-6)return null;
 for(let i=1;i<proj.length-1;i++){let ok=true;for(let j=1;j<6;j++){if(i-j<0||i+j>=proj.length)continue;if(proj[i-j+1]<proj[i-j]||proj[i+j-1]<proj[i+j]){ok=false;break;}}if(!ok||proj[i]<max*.35)continue;let left=0,right=0;for(let k=i;k>0&&proj[k]>proj[k-1];k--)left=proj[i]-proj[k-1];for(let k=i;k<proj.length-1&&proj[k]>proj[k+1];k++)right=proj[i]-proj[k+1];candidates.push({i,score:Math.max(left,right)});}
 const best=filter=>candidates.filter(filter).sort((a,b)=>b.score-a.score)[0];const l=best(c=>c.i<center-6&&c.i>center*.25),r=best(c=>c.i>center+6&&c.i<center*1.75);return l&&r?Math.abs(r.i-l.i)/2:null;
}
function fftGrid(gray,w,h){
 const real=Float64Array.from(gray),imag=new Float64Array(w*h),rowPlan=fftPlan(w),colPlan=fftPlan(h),rr=new Float64Array(w),ri=new Float64Array(w),cr=new Float64Array(h),ci=new Float64Array(h);
 for(let y=0;y<h;y++){rr.set(real.subarray(y*w,(y+1)*w));ri.fill(0);rowPlan(rr,ri);real.set(rr,y*w);imag.set(ri,y*w);}
 for(let x=0;x<w;x++){for(let y=0;y<h;y++){cr[y]=real[y*w+x];ci[y]=imag[y*w+x];}colPlan(cr,ci);for(let y=0;y<h;y++){real[y*w+x]=1-Math.log1p(Math.hypot(cr[y],ci[y]));}}
 const mag=normalize(real),rows=new Float64Array(h),cols=new Float64Array(w);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=mag[((y+Math.ceil(h/2))%h)*w+(x+Math.ceil(w/2))%w];rows[y]+=v;cols[x]+=v;}
 const gx=detectPeak(smooth(normalize(cols))),gy=detectPeak(smooth(normalize(rows)));return gx&&gy?[gx,gy]:null;
}
function gradients(gray,w,h){const xSum=new Float64Array(w),ySum=new Float64Array(h),reflect=(i,n)=>n===1?0:i<0?1:i>=n?n-2:i;for(let y=0;y<h;y++)for(let x=0;x<w;x++){let gx=0,gy=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const v=gray[reflect(y+dy,h)*w+reflect(x+dx,w)];gx+=v*dx*(dy===0?2:1);gy+=v*dy*(dx===0?2:1);}xSum[x]+=Math.abs(gx);ySum[y]+=Math.abs(gy);}return [xSum,ySum];}
function gradientCount(v){let max=0;for(const x of v)max=Math.max(max,x);if(max<1e-6)return null;const peaks=[];for(let i=1;i<v.length-1;i++){// Accept a flat two-column Sobel peak once, including exact nearest-neighbour art.
 if(v[i]>v[i-1]&&v[i]>=v[i+1]&&v[i]>=max*.2&&(!peaks.length||i-peaks.at(-1)>=4))peaks.push(i);}
 if(peaks.length<4)return null;const intervals=peaks.slice(1).map((p,i)=>p-peaks[i]).sort((a,b)=>a-b),mid=Math.floor(intervals.length/2),median=intervals.length%2?intervals[mid]:(intervals[mid-1]+intervals[mid])/2;return v.length/median;
}
function bestBoundary(origin,range,grad){let best=Math.round(origin),value=0;for(let j=Math.max(1,Math.round(origin-range));j<=Math.min(grad.length-2,Math.round(origin+range));j++){if(grad[j]>grad[j-1]&&grad[j]>=grad[j+1]&&grad[j]>value){best=j;value=grad[j];}}return best;}
function refineAxis(n,count,grad,intensity,manual){
 const cell=n/count;if(manual){const a=[0];for(let k=1;k<count;k++)a.push(clamp(bestBoundary(k*cell,cell*intensity,grad),a.at(-1)+1,n-(count-k)));a.push(n);return a;}
 const middle=bestBoundary(n/2,cell,grad),coords=[];
 for(const direction of [1,-1]){let value=middle-(direction===-1?cell:0);for(let guard=0;guard<n+2&&value>-cell/2&&value<n+cell/2;guard++){const next=bestBoundary(value,cell*intensity,grad);coords.push(clamp(next,0,n));value=next+direction*cell;}}
 const a=[...new Set(coords)].sort((x,y)=>x-y);if(!a.length)return [0,n];if(a[0]<cell*.6)a[0]=0;else a.unshift(0);if(n-a.at(-1)<cell*.6)a[a.length-1]=n;else a.push(n);return [...new Set(a)];
}
function sample(data,w,xs,ys,method){
 const ow=xs.length-1,oh=ys.length-1,out=new Uint8ClampedArray(ow*oh*4);
 for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){
  const x0=xs[x],x1=xs[x+1],y0=ys[y],y1=ys[y+1],dest=(y*ow+x)*4;
  if(method==='center'){const p=(Math.floor((y0+y1)/2)*w+Math.floor((x0+x1)/2))*4;out.set(data.subarray(p,p+4),dest);if(!out[dest+3])out.fill(0,dest,dest+3);continue;}
  const area=(x1-x0)*(y1-y0),samples=[],take=Math.min(128,area);
  for(let i=0;i<take;i++){const offset=Math.floor((i+.5)*area/take),p=((y0+Math.floor(offset/(x1-x0)))*w+x0+offset%(x1-x0))*4,a=data[p+3];samples.push([data[p]*a/255,data[p+1]*a/255,data[p+2]*a/255,a]);}
  let color;
  if(method==='median'){color=[0,1,2,3].map(c=>{const a=samples.map(p=>p[c]).sort((a,b)=>a-b),mid=a.length>>1;return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;});}
  else{const dist=(a,b)=>a.reduce((s,v,c)=>s+(v-b[c])**2,0);let a=samples[0],b=samples.reduce((best,p)=>dist(p,a)>dist(best,a)?p:best,a),n0=0,n1=0;for(let k=0;k<6;k++){const s0=[0,0,0,0],s1=[0,0,0,0];n0=0;n1=0;for(const p of samples){const one=dist(p,b)<dist(p,a),s=one?s1:s0;one?n1++:n0++;p.forEach((v,c)=>s[c]+=v);}if(n0)a=s0.map(v=>v/n0);if(n1)b=s1.map(v=>v/n1);}color=n1>=n0?b:a;}
  const alpha=clamp(Math.round(color[3]),0,255);out[dest+3]=alpha;for(let c=0;c<3;c++)out[dest+c]=alpha?clamp(Math.round(color[c]*255/alpha),0,255):0;
 }
 return out;
}
// Optional median-cut palette reduction; alpha is retained, transparent RGB is ignored.
export function reducePalette(data,count){
 if(!count)return new Uint8ClampedArray(data);const histogram=new Map();for(let p=0;p<data.length;p+=4){if(!data[p+3])continue;const key=(data[p]<<16)|(data[p+1]<<8)|data[p+2],entry=histogram.get(key);if(entry)entry.n++;else histogram.set(key,{v:[data[p],data[p+1],data[p+2]],n:1});}
 if(histogram.size<=count)return new Uint8ClampedArray(data);
 const box=items=>{const ranges=[0,1,2].map(c=>{let lo=255,hi=0;for(const p of items){lo=Math.min(lo,p.v[c]);hi=Math.max(hi,p.v[c]);}return hi-lo;});return {items,ranges,score:Math.max(...ranges)*Math.sqrt(items.reduce((s,p)=>s+p.n,0))};};
 const boxes=[box([...histogram.values()])];while(boxes.length<count){boxes.sort((a,b)=>b.score-a.score);const b=boxes.shift();if(b.items.length<2){boxes.unshift(b);break;}const axis=b.ranges.indexOf(Math.max(...b.ranges));b.items.sort((a,b)=>a.v[axis]-b.v[axis]);const total=b.items.reduce((s,p)=>s+p.n,0);let sum=0,i=0;for(;i<b.items.length-1;i++){sum+=b.items[i].n;if(sum>=total/2)break;}boxes.push(box(b.items.slice(0,i+1)),box(b.items.slice(i+1)));}
 const palette=boxes.map(b=>{const total=b.items.reduce((s,p)=>s+p.n,0);return [0,1,2].map(c=>Math.round(b.items.reduce((s,p)=>s+p.v[c]*p.n,0)/total));}),mapping=new Map(),out=new Uint8ClampedArray(data);
 for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;const key=(data[i]<<16)|(data[i+1]<<8)|data[i+2];let color=mapping.get(key);if(!color){let best=Infinity;for(const p of palette){const d=p.reduce((s,v,c)=>s+(v-data[i+c])**2,0);if(d<best){best=d;color=p;}}mapping.set(key,color);}out.set(color,i);}return out;
}
export function getPerfectPixel({w,h,data},{grid=null,sampleMethod='majority',refineIntensity=.25,colors=0}={}){
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>1536||h>1536||data?.length!==w*h*4)throw Error('处理图片尺寸无效，最长边不得超过 1536');
 if(!['center','median','majority'].includes(sampleMethod)||!Number.isFinite(refineIntensity)||refineIntensity<0||refineIntensity>.49||![0,16,32,64,128].includes(colors))throw Error('转换参数无效');
 const gray=Float64Array.from({length:w*h},(_,i)=>(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2])*data[i*4+3]/255),[gx,gy]=gradients(gray,w,h);let method='manual',size=grid;
 if(grid){if(grid.length!==2||grid.some((n,i)=>!Number.isInteger(n)||n<1||n>Math.min(512,i?h:w)))throw Error('输出宽高必须是 1–512 且不大于处理图');}
 else{size=fftGrid(gray,w,h);method='fft';if(size){const a=w/size[0],b=h/size[1];if(Math.min(a,b)<4||Math.max(a,b)>20||Math.max(a/b,b/a)>1.5)size=null;}
  if(!size){method='gradient';const a=gradientCount(gx),b=gradientCount(gy);if(a&&b)size=[a,b];}
  if(!size)throw Error('未识别到稳定的像素网格，请切换「手动尺寸」再预览。');
  const a=w/size[0],b=h/size[1],cell=Math.max(a/b,b/a)>1.5?Math.min(a,b):(a+b)/2;size=[Math.max(1,Math.round(w/cell)),Math.max(1,Math.round(h/cell))];
 }
 const xs=refineAxis(w,size[0],gx,refineIntensity,!!grid),ys=refineAxis(h,size[1],gy,refineIntensity,!!grid),ow=xs.length-1,oh=ys.length-1;
 if(ow>512||oh>512)throw Error('识别结果超过画室 512 像素上限，请指定较小的手动尺寸。');
 return {w:ow,h:oh,data:reducePalette(sample(data,w,xs,ys,sampleMethod),colors),method,estimated:size};
}
