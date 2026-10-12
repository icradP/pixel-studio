// A narrow transition at each pixel boundary prevents fractional/rotated scaling
// from aliasing, without interpolating across the interior of enlarged pixels.
export function pixelSample(position, footprint) {
  const f = Math.min(1, footprint),
    fraction = position - Math.floor(position);
  return (
    Math.floor(position) + 0.5 + (fraction - Math.max(0.5 * f, Math.min(1 - 0.5 * f, fraction))) / f
  );
}
export function createPixelRenderer() {
  const canvas = document.createElement('canvas');
  let gl,
    program,
    lastSource = null,
    lost = false;
  const uniforms = {};
  function initialize() {
    gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
      return s;
    };
    const v = shader(
      gl.VERTEX_SHADER,
      'attribute vec2 point;void main(){gl_Position=vec4(point,0.,1.);}',
    );
    const f = shader(
      gl.FRAGMENT_SHADER,
      `precision highp float;
   uniform sampler2D picture;uniform vec2 viewport;uniform vec2 center;uniform vec2 imageSize;uniform vec2 rotation;uniform float scale;uniform float smoothMode;
   void main(){vec2 q=vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y)-center;
    vec2 p=vec2(q.x*rotation.x+q.y*rotation.y,-q.x*rotation.y+q.y*rotation.x)/scale+imageSize*.5;
    float footprint=(abs(rotation.x)+abs(rotation.y))/scale;
    float f=min(1.,footprint);vec2 uv=(floor(p)+.5+(fract(p)-clamp(fract(p),.5*f,1.-.5*f))/f)/imageSize;
    if(smoothMode>0.5)uv=p/imageSize;
    vec2 edge=min(p,imageSize-p);float coverage=clamp(min(edge.x,edge.y)/footprint+.5,0.,1.);
    gl_FragColor=texture2D(picture,uv)*coverage;
   }`,
    );
    program = gl.createProgram();
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw Error('Pixel preview shader unavailable');
    gl.deleteShader(v);
    gl.deleteShader(f);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const point = gl.getAttribLocation(program, 'point');
    gl.enableVertexAttribArray(point);
    gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const name of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
      gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE);
    for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
      gl.texParameteri(gl.TEXTURE_2D, name, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (const name of ['viewport', 'center', 'imageSize', 'rotation', 'scale', 'smoothMode'])
      uniforms[name] = gl.getUniformLocation(program, name);
    lastSource = null;
  }
  try {
    initialize();
  } catch {
    gl = null;
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      initialize();
      lost = false;
    } catch {
      gl = null;
    }
  });
  return {
    draw(ctx, source, camera, cw, ch, dpr, mode, dirty = false) {
      if (!gl || lost || mode === 'pixel') return false;
      const w = Math.round(cw * dpr),
        h = Math.round(ch * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      if (lastSource !== source || dirty) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        lastSource = source;
      }
      gl.uniform2f(uniforms.viewport, w, h);
      gl.uniform2f(uniforms.center, (cw / 2 + camera.x) * dpr, (ch / 2 + camera.y) * dpr);
      gl.uniform2f(uniforms.imageSize, source.width, source.height);
      gl.uniform2f(uniforms.rotation, Math.cos(camera.angle), Math.sin(camera.angle));
      gl.uniform1f(uniforms.scale, camera.scale * dpr);
      gl.uniform1f(uniforms.smoothMode, mode === 'smooth' ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(canvas, 0, 0);
      ctx.restore();
      return true;
    },
  };
}
