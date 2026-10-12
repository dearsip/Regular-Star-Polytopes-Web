import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const segments=process.argv.includes('--segments');
const fixtures=JSON.parse(await readFile(new URL(segments?'fixtures/folding-segments.json':'fixtures/pocket-probes.json',import.meta.url),'utf8'));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();
await page.route('**/src/main.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
try{
 await page.goto(process.env.VIEWER_URL??'http://127.0.0.1:8080/');
 const results=await page.evaluate(async ({fixtures,segments})=>{
  const {pocketGLSL}=await import('./src/pocket-glsl.js'),{fixGLSL}=await import('./src/fix-glsl.js');
  const reference=pocketGLSL.replace(/\b(Pocket\w+|HullPocket\w+)\b/g,'Reference_$1');
  const size=Math.max(...Object.values(fixtures).map(a=>a.length));
  const c=document.createElement('canvas');c.width=size;c.height=1;const gl=c.getContext('webgl2');
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  function tex(unit,data,width,height){const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,data);return t;}
  async function floats(file){let b=await(await fetch('./data/'+file)).arrayBuffer();if(new Uint8Array(b)[0]===31)b=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();return new Float32Array(b);}
  const vs=`#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
  const results=[];
  for(const [id,probes] of Object.entries(fixtures)){
   const m=await(await fetch('./data/'+id+'.json')).json();
   const fast=id==='Fix'?fixGLSL:(await(await fetch('./data/'+m.shaderFile)).text()).replace(/uniform sampler2D uPockets;/,'').replace(/uniform vec4 uPocketHeader0,uPocketHeader1,uPocketHeader2,uPocketHeader3;/,'');
   const call=segments?`bool hidden=PocketSolidSegment(p,back,meta.x,meta.y,2e-5,int(round(uPocketHeader2.x)),int(round(uPocketHeader0.z)));bool valid=true;`:id==='Fix'?`
    vec4 center=texelFetch(uCenters,ivec2(uid&255,uid>>8),0);
    int row=uid*4;vec4 x=texelFetch(uFrames,ivec2(row&255,row>>8),0);row++;vec4 y=texelFetch(uFrames,ivec2(row&255,row>>8),0);row++;vec4 z=texelFetch(uFrames,ivec2(row&255,row>>8),0);row++;vec4 n=texelFetch(uFrames,ivec2(row&255,row>>8),0);
    vec4 eye=back+meta.x*center;vec4 local=vec4(dot(x,p-center),dot(y,p-center),dot(z,p-center),0);
    bool hidden=FixClipOccluded(FixPrepareClips(local,vec4(dot(x,eye),dot(y,eye),dot(z,eye),dot(n,eye)),meta.x));
    bool valid=dot(n,back)+meta.x*dot(n,center)<-1e-9;
   `:`bool hidden=HullPocketOccludedEntry(p,back,meta.x,code);bool valid=true;`;
   const fs=`#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;
    ${reference}\n${fast}
    uniform sampler2D uProbes,uFrames,uCenters;out vec4 outputColor;
    void main(){int i=int(gl_FragCoord.x);vec4 p=texelFetch(uProbes,ivec2(i,0),0),back=texelFetch(uProbes,ivec2(i,1),0),meta=texelFetch(uProbes,ivec2(i,2),0);
     int uid=int(meta.y);int seed=int(round(uPocketHeader0.w));int code=int(round(Reference_PocketTex(seed+(uid>>2))[uid&3]));
     bool expected=${segments?'Reference_PocketSolidSegment(p,back,meta.x,meta.y,2e-5,int(round(uPocketHeader2.x)),int(round(uPocketHeader0.z)))':'Reference_HullPocketOccludedEntry(p,back,meta.x,code)'};
     ${call}
     outputColor=vec4(hidden?1.0:0.0,expected?1.0:0.0,valid?1.0:0.0,1.0);}`;
   const program=gl.createProgram(),v=shader(gl.VERTEX_SHADER,vs),f=shader(gl.FRAGMENT_SHADER,fs);gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(id+gl.getProgramInfoLog(program));gl.useProgram(program);
   const atlas=await floats(id+'.pockets.bin.gz'),h=Math.ceil(atlas.length/1024),packed=new Float32Array(h*1024);packed.set(atlas);const textures=[tex(0,packed,256,h)];
   gl.uniform1i(gl.getUniformLocation(program,'uPockets'),0);
   for(let j=0;j<4;j++)gl.uniform4fv(gl.getUniformLocation(program,'uPocketHeader'+j),atlas.subarray(j*4,j*4+4));
   const data=new Float32Array(size*3*4);probes.forEach((p,i)=>{data.set(p.p,i*4);data.set(segments?p.d:p.back,size*4+i*4);data.set(segments?[p.begin,p.end,0,0]:[p.sine,p.globalUnit,0,0],size*8+i*4);});textures.push(tex(1,data,size,3));gl.uniform1i(gl.getUniformLocation(program,'uProbes'),1);
   if(id==='Fix')for(const [file,key,unit] of [['Fix.unit-frames.bin.gz','uFrames',2],['Fix.centers.bin.gz','uCenters',3]]){const a=await floats(file),height=Math.ceil(a.length/1024),b=new Float32Array(height*1024);b.set(a);textures.push(tex(unit,b,256,height));gl.uniform1i(gl.getUniformLocation(program,key),unit);}
   gl.viewport(0,0,size,1);gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(size*4);gl.readPixels(0,0,size,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError())throw Error(id+' GL error');
   const mismatches=[],referenceMismatch=[];let valid=0;
   probes.forEach((p,i)=>{if(pixels[4*i+2]<128)return;valid++;if((pixels[4*i]>127)!==p.hidden)mismatches.push(i);if(pixels[4*i]!==pixels[4*i+1])referenceMismatch.push(i);});
   results.push({id,valid,shaderDefines:m.shaderDefines,mismatches,referenceMismatch});
   for(const t of textures)gl.deleteTexture(t);gl.deleteProgram(program);gl.deleteShader(v);gl.deleteShader(f);
  }
  return results;
 },{fixtures,segments});
 await mkdir(new URL('../test-artifacts/',import.meta.url),{recursive:true});await writeFile(new URL(segments?'../test-artifacts/browser-folding.json':'../test-artifacts/browser-optimized.json',import.meta.url),JSON.stringify(results,null,2));
 for(const r of results){console.log(`${r.id}: ${r.valid} valid rays, ${r.mismatches.length} oracle differences, ${r.referenceMismatch.length} generic differences`);assert.equal(r.mismatches.length,0);if(!segments)assert.equal(r.referenceMismatch.length,0);}
}finally{await browser.close();}
