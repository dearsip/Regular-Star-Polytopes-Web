// Compare completed renders after shader/buffer warmup, using identical inputs.
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();await page.route('**/src/main.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
try{
 await page.goto(process.env.VIEWER_URL??'http://127.0.0.1:8080/');
 const results=await page.evaluate(async ids=>{
  const THREE=await import('three');const {loadModel}=await import('./src/star-data.js');
  const {starVertexShader,polychoronFragmentShader}=await import('./src/star-shader.js');
  const {pocketGLSL}=await import('./src/pocket-glsl.js');
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(160,160);renderer.setClearColor(0x10181f);
  const gl=renderer.getContext(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.z=7;
  let pose=new THREE.Matrix4();
  for(const [a,b,degrees] of [[0,3,37],[1,3,19],[2,3,-23],[0,2,14]]){
   const r=new THREE.Matrix4(),t=degrees*Math.PI/180,c=Math.cos(t),s=Math.sin(t);r.elements[a*4+a]=r.elements[b*4+b]=c;r.elements[b*4+a]=-s;r.elements[a*4+b]=s;pose.premultiply(r);
  }
  const back=new THREE.Vector4(0,0,0,1).applyMatrix4(pose.clone().transpose());const results=[];
  for(const id of ids){
   const {metadata:m,resources:r}=await loadModel(id);
   const uniforms={uFrames:{value:r.frames},uCenters:{value:r.centers},uUnitCells:{value:r.unitCells},uPockets:{value:r.pockets},uFixFrames:{value:r.fixFrames},uPerCell:{value:m.unitsPerCell},uOriginal:{value:false},uCullCells:{value:true},uBackOnly:{value:false},uHopfColors:{value:true},uExplosion:{value:0},uFoV:{value:0},uFilter:{value:-90},uOnlyCell:{value:-1},uBack:{value:back},uPose:{value:pose},uOcclusion:{value:true},uSelection:{value:0},uSelectionUnits:{value:r.selection},uRegions:{value:r.regions},uRegionCount:{value:m.sectorSizes.length}};
   for(let i=0;i<4;i++)uniforms['uPocketHeader'+i]={value:r.headers[i]};
   const baseline=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:starVertexShader,fragmentShader:polychoronFragmentShader(pocketGLSL),defines:{POCKET_PREPARED_VERTEX:1},side:THREE.DoubleSide,uniforms});
   const fast=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:starVertexShader,fragmentShader:polychoronFragmentShader(r.pocketShader),defines:Object.fromEntries(m.shaderDefines.map(k=>[k,1])),side:THREE.DoubleSide,uniforms});
   const mesh=new THREE.Mesh(r.surface,baseline);mesh.frustumCulled=false;scene.add(mesh);
   const row={id,triangles:m.full.triangles,shaderDefines:m.shaderDefines};
   const variants=[['generic',baseline],['optimized',fast]];
   if(id==='Gashi'){
    const source=await(await fetch('./data/Gashi.static.pocket.glsl')).text();
    variants.push(['static',new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:starVertexShader,fragmentShader:polychoronFragmentShader(source),defines:{POCKET_KIND_GASHI:1,POCKET_SINGLE_VOID:1},side:THREE.DoubleSide,uniforms})]);
   }
   for(const [kind,mat] of variants){
    mesh.material=mat;renderer.render(scene,camera);gl.finish();const times=[];
    const readback=new Uint8Array(160*160*4);
    for(let i=0;i<3;i++){const begin=performance.now();renderer.render(scene,camera);gl.readPixels(0,0,160,160,gl.RGBA,gl.UNSIGNED_BYTE,readback);times.push(performance.now()-begin);}
    row[kind+'CompletionMs']=times.sort((a,b)=>a-b)[1];
    const pixels=new Uint8Array(160*160*4);gl.readPixels(0,0,160,160,gl.RGBA,gl.UNSIGNED_BYTE,pixels);row[kind+'Mask']=Array.from({length:160*160},(_,i)=>Math.max(pixels[4*i],pixels[4*i+1],pixels[4*i+2])>50?1:0);
   }
   row.ratio=row.genericCompletionMs/row.optimizedCompletionMs;
   row.maskDifferences=row.genericMask.reduce((n,v,i)=>n+(v!==row.optimizedMask[i]?1:0),0);
   let interior=0;
   for(let y=2;y<158;y++)for(let x=2;x<158;x++)if(row.genericMask[y*160+x]!==row.optimizedMask[y*160+x]){
    let edge=false;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const j=(y+dy)*160+x+dx;if(row.genericMask[j]!==row.genericMask[y*160+x])edge=true;}if(!edge)interior++;
   }
   row.interiorMaskDifferences=interior;
   if(row.staticMask)row.staticMaskDifferences=row.genericMask.reduce((n,v,i)=>n+(v!==row.staticMask[i]?1:0),0);
   delete row.genericMask;delete row.optimizedMask;delete row.staticMask;
   results.push(row);scene.remove(mesh);for(const [,mat] of variants)mat.dispose();r.dispose();
  }
  renderer.dispose();return results;
 },process.env.MODEL_IDS?.split(',')??['Fix','Sishi','Gohi','Gishi','Gahi','Gashi','Gaghi','Gofix','Gogishi','Gax']);
 await mkdir(new URL('../test-artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../test-artifacts/browser-performance.json',import.meta.url),JSON.stringify({method:'160x160, median of three warmed renders including synchronous pixel readback; Chrome/ANGLE SwiftShader',results},null,2));
 for(const r of results)console.log(`${r.id}: ${r.genericCompletionMs.toFixed(1)} → ${r.optimizedCompletionMs.toFixed(1)} ms (${r.ratio.toFixed(2)}x), mask differences ${r.maskDifferences}, interior ${r.interiorMaskDifferences}${r.staticCompletionMs?`, static ${r.staticCompletionMs.toFixed(1)} ms, differences ${r.staticMaskDifferences}`:''}`);
}finally{await browser.close();}
