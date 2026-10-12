// Screen-direction regression and stereo spacing UI/URL verification.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}), args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width:1000,height:700 } });
const errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const base=process.env.VIEWER_URL??'http://127.0.0.1:8080/';
const state=()=>page.evaluate(()=>window.starViewer.state);
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function open(model,extra={}){
  const params=new URLSearchParams({model,inertia:'0',arcball:'0',resolution:'0.5',...extra});
  for(let i=1;i<=4;i++)params.set(`axis${i}`,Array.from({length:4},(_,j)=>+(j===i-1)).join(','));
  await page.goto(base+'?'+params);
  await page.waitForFunction(model=>window.starViewer?.state.model===model&&!window.starViewer.state.loading,model);
  await frame();
  assert.equal((await state()).shaderFailed,false);
}
async function drag(dx,dy,button){
  const r=await page.locator('#viewer').boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
  await page.mouse.move(x,y);await page.mouse.down({button});
  await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up({button});await frame();
}
try{
  for(const [model,button,frontColumn] of [['Fix','left',2],['Fix','right',3],['GreatDodecahedron','left',3]]){
    for(const [dx,dy] of [[80,0],[-80,0],[0,80],[0,-80]]){
      await open(model);await drag(dx,dy,button);
      const s=await state();
      // Source -Z becomes the visible near side after the renderer's Z flip.
      // The right/3D gesture sees the near side along source -W instead.
      const x=-.5*s.pose[frontColumn*4],y=.5*s.pose[frontColumn*4+1];
      if(dx)assert(x*Math.sign(dx)>.1,`${model} ${button}: X must follow the drag`);
      if(dy)assert(y*Math.sign(dy)>.1,`${model} ${button}: screen Y must follow the drag`);
      if(s.dimension===3)assert.deepEqual(s.pose.slice(8,12),[0,0,1,0]);
      results.push({model,button,dx,dy,x,y});
    }
  }
  await open('Fix');
  assert.equal(await page.locator('#eyeSpacingControl').isVisible(),false);
  await page.selectOption('#stereo','parallel');assert(await page.locator('#eyeSpacingControl').isVisible());
  const output=new URL('../test-artifacts/',import.meta.url);await mkdir(output,{recursive:true});
  async function spacing(value){
    await page.locator('#eyeSpacing').evaluate((n,value)=>{n.value=String(value);n.dispatchEvent(new Event('input',{bubbles:true}));},value);
    await frame();assert.equal((await state()).eyeSpacing,value);
  }
  await spacing(0);await page.screenshot({path:new URL('spacing-zero.png',output).pathname.replace(/^\/([A-Za-z]:\/)/,'$1')});
  await spacing(.8);await page.screenshot({path:new URL('spacing-wide.png',output).pathname.replace(/^\/([A-Za-z]:\/)/,'$1')});
  await page.selectOption('#stereo','cross');assert(await page.locator('#eyeSpacingControl').isVisible());
  await page.selectOption('#stereo','off');assert.equal(await page.locator('#eyeSpacingControl').isVisible(),false);
  await page.selectOption('#stereo','parallel');assert.equal((await state()).eyeSpacing,.8);
  await page.click('#share');const url=page.url();assert.equal(new URL(url).searchParams.get('eyeSpacing'),'0.8');
  await page.goto(url);await page.waitForFunction(()=>window.starViewer?.state.model==='Fix'&&!window.starViewer.state.loading);await frame();
  assert.equal((await state()).eyeSpacing,.8);assert.equal((await state()).stereo,'parallel');assert(await page.locator('#eyeSpacingControl').isVisible());
  assert.equal(await page.locator('#eyeSpacingValue').textContent(),'0.800');
  assert.equal(errors.length,0,errors.join('\n'));
  await writeFile(new URL('browser-input.json',output),JSON.stringify({passed:true,directions:results,eyeSpacing:'UI, rendering parameter and URL round trip passed',errors},null,2));
  console.log('12 screen-direction checks passed: polychoron left/right and polyhedron left in all four directions.');
  console.log('Eye spacing visibility, value retention, stereo modes and URL round trip passed.');
}finally{await browser.close();}
