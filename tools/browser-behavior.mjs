// Geometry invariants on the actual GPU vertex shader, plus pointer-input regression.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1000,height:700}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const base=process.env.VIEWER_URL??'http://127.0.0.1:8080/';
await page.route('**/src/main.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
try {
  await page.goto(base);
  const geometry=await page.evaluate(async()=>{
    const {starVertexShader}=await import('./src/star-shader.js');
    const {fetchBinary}=await import('./src/star-data.js');
    const gl=document.createElement('canvas').getContext('webgl2');
    const check=(test,message)=>{if(!test)throw new Error(message);};
    const compile=(kind,source)=>{const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));return s;};
    const program=gl.createProgram();
    gl.attachShader(program,compile(gl.VERTEX_SHADER,'#version 300 es\nprecision highp float;\nprecision highp int;\nuniform mat4 projectionMatrix,modelViewMatrix;\n'+starVertexShader));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;\nout vec4 color;\nvoid main(){color=vec4(1);}'));
    gl.transformFeedbackVaryings(program,['vPosition4','vRear','gl_Position'],gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));gl.useProgram(program);
    const loc=name=>gl.getUniformLocation(program,name);
    const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    for(const name of ['uPose','projectionMatrix','modelViewMatrix'])gl.uniformMatrix4fv(loc(name),false,identity);
    for(const [name,value] of Object.entries({uOriginal:1,uCullCells:0,uBackOnly:0,uHopfColors:0,uOnlyCell:-1}))gl.uniform1i(loc(name),value);
    gl.uniform4f(loc('uBack'),0,0,0,1);
    const texture=(data,width)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,Math.ceil(data.length/(width*4)),0,gl.RGBA,gl.FLOAT,data);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);return t;};
    const dummy=texture(new Float32Array(4),1);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dummy);
    for(const name of ['uCenters','uUnitCells','uPockets','uFixFrames'])gl.uniform1i(loc(name),1);
    gl.uniform1i(loc('uFrames'),0);
    const catalog=await(await fetch('./data/catalog.json')).json(),results=[];
    for(const item of catalog.models){
      const m=await(await fetch(`./data/${item.id}.json`)).json();
      const [mesh,frameBuffer]=await Promise.all([fetchBinary(`./data/${item.id}.original.bin.gz`),fetchBinary(`./data/${item.id}.frames.bin.gz`)]);
      const frames=new Float32Array(frameBuffer),n=new DataView(mesh).getUint32(4,true);
      const positions=new Float32Array(mesh,16,n*4),units=new Uint32Array(mesh,16+n*20,n);
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffers=[];
      function attribute(name,data,size,type=gl.FLOAT,normalized=false){const at=gl.getAttribLocation(program,name);if(at<0)return;const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,type,normalized,0,0);}
      attribute('aPosition4',positions,4);attribute('aUnit',Float32Array.from(units),1);
      attribute('aLightingNormal',new Int8Array(mesh,16+n*16,n*4),4,gl.BYTE,true);
      const at=gl.getAttribLocation(program,'aEntry');if(at>=0){gl.disableVertexAttribArray(at);gl.vertexAttrib1f(at,-1);}
      gl.activeTexture(gl.TEXTURE0);const tex=texture(frames,7);
      gl.uniform1i(loc('uPerCell'),m.dimension===4?m.unitsPerCell:0);
      const output=gl.createBuffer(),feedback=gl.createTransformFeedback();
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,n*9*4,gl.STREAM_READ);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);
      const result={id:m.id,vertices:n,maxPositionError:0,maxRadiusError:0,cornerChecks:0,rearChecks:0,depthChecks:0,visibleRadius:[]};
      for(const fraction of [0,.5,1])for(const fov of [0,60,-60])for(const filter of [-90,10]){
        const e=fraction*m.explosionMax,s=Math.sin(fov*Math.PI/360),c=Math.cos(fov*Math.PI/360),limit=Math.sin(filter*Math.PI/180);
        gl.uniform1f(loc('uExplosion'),e);gl.uniform1f(loc('uFoV'),fov);gl.uniform1f(loc('uFilter'),filter);
        gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,n);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);
        const raw=new ArrayBuffer(n*9*4),out=new Float32Array(raw),bits=new Int32Array(raw);
        gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,out);check(gl.getError()===gl.NO_ERROR,`${m.id}: GPU readback failed`);
        let maxRadius=0;
        for(let i=0;i<n;i++){
          const cell=units[i],center=Array.from(frames.slice(cell*28+16,cell*28+20)),normal=Array.from(frames.slice(cell*28+12,cell*28+16));
          const center2=center.reduce((a,v)=>a+v*v,0),radius=Math.sqrt(1+center2*e*(e+2));
          const moved=center.map(v=>v*(1+e)/radius),p=Array.from(positions.slice(i*4,i*4+4));
          // Undo the original 0.94 margin to check the underlying geometry,
          // not a fitted bound of the displayed hollow mesh.
          const vertex=p.map((v,k)=>center[k]+(v-center[k])/.94);
          if(Math.abs(Math.hypot(...vertex)-1)<2e-5){
            const expanded=vertex.map((v,k)=>(v+e*center[k])/radius);
            result.maxRadiusError=Math.max(result.maxRadiusError,Math.abs(Math.hypot(...expanded)-1));
            result.cornerChecks++;
          }
          let norm2=0;
          for(let k=0;k<4;k++){
            const expected=(p[k]+e*center[k])/radius,actual=out[i*9+k];norm2+=actual*actual;
            result.maxPositionError=Math.max(result.maxPositionError,Math.abs(expected-actual));
          }
          maxRadius=Math.max(maxRadius,Math.sqrt(norm2));
          const h=normal.reduce((a,v,k)=>a+v*moved[k],0);
          const rear=normal[3]+h*s>=-1e-9*c;
          check(bits[i*9+4]===+rear,`${m.id}: moved-cell back-face test, e=${e}, FoV=${fov}`);result.rearChecks++;
          const z=moved[2]*c/(1+moved[3]*s),filtered=z<limit-1e-9;
          const rejected=out[i*9+5]===-2&&out[i*9+6]===-2&&out[i*9+8]===1;
          check(rejected===filtered,`${m.id}: final-center depth filter, e=${e}, FoV=${fov}`);result.depthChecks++;
        }
        if(fov===0&&filter===-90)result.visibleRadius.push({fraction,radius:maxRadius});
      }
      check(result.maxPositionError<3e-6,`${m.id}: exploded position differs from source formula`);
      check(result.cornerChecks>0,`${m.id}: no underlying corners checked`);
      check(result.maxRadiusError<3e-6,`${m.id}: underlying radius changed`);
      check(result.visibleRadius.every(r=>r.radius>.92&&r.radius<1.001),`${m.id}: visible mesh shrinks excessively`);
      results.push(result);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);
      gl.deleteTransformFeedback(feedback);gl.deleteBuffer(output);for(const b of buffers)gl.deleteBuffer(b);gl.deleteVertexArray(vao);gl.deleteTexture(tex);
    }
    return results;
  });
  const input=await page.evaluate(async()=>{
    const THREE=await import('three');const {StarControls}=await import('./src/star-controls.js');
    const el=document.createElement('canvas');el.style.cssText='position:fixed;left:0;top:0;width:500px;height:500px';document.body.append(el);
    const u={};for(let i=1;i<=4;i++)u['uAxis'+i]={value:new THREE.Vector4(...Array.from({length:4},(_,j)=>+(j===i-1)))};
    for(let i=1;i<=2;i++)for(const [key,value] of [['From',new THREE.Vector4(1,0,0,0)],['To',new THREE.Vector4(0,1,0,0)],['Speed',0],['Time',0]])u[`uAutoRot${i}${key}`]={value};
    const controls=new StarControls(el,u),rows=[];
    if(controls.useArcball)throw new Error('Arcball must default off');controls.setUseArcball(true);controls.inertia=false;
    for(const dimension of [4,3])for(const button of [0,2])for(const [ox,oy] of [[100,0],[-100,0],[0,100],[0,-100],[80,-60]])for(const [dx,dy] of [[8,0],[0,8]]){
      controls.dimension=dimension;controls.reset();
      const x=250+ox,y=250+oy,arc=controls.getArcballFromClientPosition(x,y);
      const event=(type,ex,ey)=>el.dispatchEvent(new PointerEvent(type,{pointerId:1,pointerType:'mouse',clientX:ex,clientY:ey,button,buttons:type==='pointerup'?0:button===2?2:1,bubbles:true}));
      event('pointerdown',x,y);event('pointermove',x+dx,y+dy);
      const candidate=controls.lastAutoCandidate,depth=dimension===3?3:2;
      const hemisphere=new THREE.Vector4(arc.s*arc.ux,arc.s*arc.uy,0,0);hemisphere.setComponent(depth,-arc.c);
      // The tilted drag direction must be tangent to the near hemisphere
      // under the pointer, rather than its mirrored far-hemisphere position.
      const error=Math.abs(candidate.from.dot(hemisphere));
      if(error>1e-7)throw new Error(`Wrong arcball hemisphere: ${dimension}D, button=${button}, offset=${ox},${oy}, error=${error}`);
      if(dimension===3&&controls.axes[2].clone().sub(new THREE.Vector4(0,0,1,0)).length()>1e-7)throw new Error('Polyhedron unused Z axis changed');
      rows.push({dimension,button,offset:[ox,oy],drag:[dx,dy],tangentError:error});event('pointerup',x+dx,y+dy);
    }
    controls.dispose();el.remove();return rows;
  });
  await page.unroute('**/src/main.js');
  for(const [query,expected] of [['',false],['&arcball=0',false],['&arcball=1',true]]){
    await page.goto(base+'?model=GreatDodecahedron&inertia=0'+query);
    await page.waitForFunction(()=>window.starViewer&&!window.starViewer.state.loading);
    assert.equal(await page.locator('#arcball').isChecked(),expected);
    await page.click('#share');assert.equal(new URL(page.url()).searchParams.get('arcball'),expected?'1':'0');
    await page.reload();await page.waitForFunction(()=>window.starViewer&&!window.starViewer.state.loading);
    assert.equal(await page.locator('#arcball').isChecked(),expected);
  }
  assert.equal(errors.length,0,errors.join('\n'));
  const output=new URL('../test-artifacts/',import.meta.url);await mkdir(output,{recursive:true});
  await writeFile(new URL('browser-behavior.json',output),JSON.stringify({passed:true,geometry,input,arcballDefaultAndURL:'passed',errors},null,2));
  console.log('All 14 Explosion geometries: GPU positions, constant underlying radius, moved-cell facing and depth filter passed at 0%, 50%, 100%, FoV 0/+60/-60.');
  console.log('40 offset pointer cases: both dimensions and buttons, near-hemisphere tangent directions and 3D Z lock passed. Arcball default off and URL overrides passed.');
}finally{await browser.close();}
