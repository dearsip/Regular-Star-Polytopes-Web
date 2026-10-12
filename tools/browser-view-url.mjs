import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const base=process.env.VIEWER_URL??'http://127.0.0.1:8080/',output=new URL('../test-artifacts/',import.meta.url);
await mkdir(output,{recursive:true});const state=()=>page.evaluate(()=>window.starViewer.state);
async function frame(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function ready(id){await page.waitForFunction(id=>window.starViewer?.state.model===id&&!window.starViewer.state.loading,id);await frame();assert.equal((await state()).shaderFailed,false);}
async function input(id,value){await page.locator('#'+id).evaluate((n,value)=>{n.value=String(value);n.dispatchEvent(new Event('input',{bubbles:true}));},value);await frame();}
const results=[];
try{
 for(const stereo of ['parallel','cross']){
  await page.goto(base+'?model=Fix&resolution=0.5&inertia=0');await ready('Fix');
  await page.selectOption('#stereo',stereo);await input('zoom',.8);await input('fov',30);await frame();
  assert.equal((await state()).cameraWorldZ,7);
  await page.locator('#viewer').screenshot({path:fileURLToPath(new URL('view-'+stereo+'-before.png',output))});
  await page.click('#share');const url=page.url();await page.goto(url);await ready('Fix');
  assert.equal((await state()).cameraWorldZ,7);assert.equal((await state()).zoom,.8);assert.equal((await state()).stereo,stereo);
  await page.locator('#viewer').screenshot({path:fileURLToPath(new URL('view-'+stereo+'-after.png',output))});
  await input('zoom',-1);assert.equal((await state()).zoom,-1);
  await page.locator('#viewer').screenshot({path:fileURLToPath(new URL('view-'+stereo+'-zoom-out.png',output))});
  results.push({stereo,cameraWorldZ:7,zoomRestored:.8,zoomAfterInput:-1});
 }
 for(const id of ['Fix','Gahi','Gax','GreatDodecahedron']){
  await page.goto(base+'?model='+id+'&resolution=0.5&inertia=0&mode=single');await ready(id);
  const single=(await state()).triangles;assert(single<1000);
  await page.click('[data-mode="full"]');await frame();const full=(await state()).triangles;
  await page.click('[data-mode="vertex"]');await frame();const vertex=(await state()).triangles;assert(vertex<full);
  await page.click('[data-mode="radial"]');await frame();const radial=(await state()).triangles;assert(radial<full);
  results.push({id,single,vertex,radial,full});
 }
 assert.equal(errors.length,0,errors.join('\n'));await writeFile(new URL('browser-view-url.json',output),JSON.stringify({passed:true,results,errors},null,2));
 console.log('Stereo view URL restores camera position and zoom; Zoom remains responsive.');
 for(const r of results.filter(r=>r.id))console.log(`${r.id}: ${r.full} full triangles → ${r.vertex} vertex, ${r.radial} radial, ${r.single} single`);
}finally{await browser.close();}
