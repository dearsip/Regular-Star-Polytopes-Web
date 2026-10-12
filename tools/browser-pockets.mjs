// GPU agreement against existing Unity/independent-solid ray fixtures.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const fixtures = JSON.parse(await readFile(new URL('fixtures/pocket-probes.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ headless:true, ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}), args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.route('**/src/main.js', route => route.fulfill({ contentType:'text/javascript', body:'' }));
try {
  await page.goto(process.env.VIEWER_URL ?? 'http://127.0.0.1:8080/');
  const results = await page.evaluate(async fixtures => {
    const { pocketGLSL } = await import('./src/pocket-glsl.js');
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=1;
    const gl=canvas.getContext('webgl2');if(!gl)throw Error('WebGL2 unavailable');
    const vs=`#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
    const fs=`#version 300 es
      precision highp float;precision highp int;precision highp sampler2D;
      ${pocketGLSL}
      uniform sampler2D uProbes;out vec4 result;
      void main(){int i=int(gl_FragCoord.x);vec4 p=texelFetch(uProbes,ivec2(i,0),0),back=texelFetch(uProbes,ivec2(i,1),0),meta=texelFetch(uProbes,ivec2(i,2),0);
      int seed=int(round(uPocketHeader0.w));int uid=int(meta.y);int code=int(round(PocketTex(seed+(uid>>2))[uid&3]));
      bool hidden=HullPocketOccludedEntry(p,back,meta.x,code);vec4 pp,pb;PocketPrepareEntry(p,back,code,pp,pb);
      bool prepared=HullPocketOccludedPrepared(p,back,meta.x,code,pp,pb,code>=0,false);
      result=vec4(hidden?1.0:0.0,prepared?1.0:0.0,0,1);}`;
    function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    function texture(unit,data,width,height){const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,data);return t;}
    gl.uniform1i(gl.getUniformLocation(program,'uPockets'),0);gl.uniform1i(gl.getUniformLocation(program,'uProbes'),1);gl.viewport(0,0,256,1);
    const results=[];
    for(const [id,probes] of Object.entries(fixtures)){
      const bytes=await(await fetch(`./data/${id}.pockets.bin.gz`)).arrayBuffer();const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();const source=new Float32Array(raw),height=Math.ceil(source.length/1024),atlas=new Float32Array(height*1024);atlas.set(source);
      const a=texture(0,atlas,256,height);for(let i=0;i<4;i++)gl.uniform4fv(gl.getUniformLocation(program,`uPocketHeader${i}`),source.subarray(i*4,i*4+4));
      const data=new Float32Array(256*3*4);probes.forEach((p,i)=>{data.set(p.p,i*4);data.set(p.back,1024+i*4);data.set([p.sine,p.globalUnit,0,0],2048+i*4);});const b=texture(1,data,256,3);
      gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(1024);gl.readPixels(0,0,256,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError()!==gl.NO_ERROR)throw Error('GPU probe GL error');
      const mismatches=[],preparedMismatch=[];probes.forEach((p,i)=>{if((pixels[i*4]>127)!==p.hidden)mismatches.push(i);if(pixels[i*4]!==pixels[i*4+1])preparedMismatch.push(i);});results.push({id,count:probes.length,mismatches,preparedMismatch,hidden:probes.filter(p=>p.hidden).length});gl.deleteTexture(a);gl.deleteTexture(b);
    }
    return results;
  }, fixtures);
  await mkdir(new URL('../test-artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../test-artifacts/browser-pockets.json',import.meta.url),JSON.stringify(results,null,2));
  for(const r of results){console.log(`${r.id}: ${r.count} rays, ${r.mismatches.length} reference differences, ${r.preparedMismatch.length} prepared differences`);assert.equal(r.preparedMismatch.length,0);assert.equal(r.mismatches.length,0);}
} finally { await browser.close(); }
