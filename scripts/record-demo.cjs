/** Record real UI interactions. Usage: PLAYWRIGHT_MODULE=/path/to/playwright node scripts/record-demo.cjs */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'), out=path.join(root,'demo-output/bunkr-demo');
 fs.mkdirSync(path.join(out,'raw'),{recursive:true});
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1920,height:1080},recordVideo:{dir:path.join(out,'raw'),size:{width:1920,height:1080}},timezoneId:'America/New_York'});
 const page=await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765'); await page.waitForTimeout(1500);
 await page.evaluate(()=>{
  const style=document.createElement('style');style.textContent='#demo-cursor{position:fixed;width:22px;height:22px;border:2px solid #fff;border-radius:50%;background:#66e0d944;box-shadow:0 0 0 5px #66e0d922;pointer-events:none;z-index:9999;transform:translate(-50%,-50%)}';document.head.append(style);
  const cursor=document.createElement('div');cursor.id='demo-cursor';document.body.append(cursor);document.addEventListener('pointermove',e=>{cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px'});
 });
 const start=Date.now();const marks={};const mark=n=>{marks[n]=(Date.now()-start)/1000; console.log(n,marks[n]);};
 mark('intro');await page.mouse.move(960,490);await page.waitForTimeout(5500);
 mark('send');await page.locator('input[type=file]').first().setInputFiles(path.join(root,'fixtures/trail-sign.jpg'));
 await page.getByRole('button',{name:'Open image',exact:true}).nth(1).waitFor({timeout:30000});await page.waitForTimeout(2000);
 mark('blurry');await page.getByRole('button',{name:'Open image',exact:true}).nth(1).click();await page.waitForTimeout(3500);
 await page.screenshot({path:path.join(out,'preview.png')});
 mark('select');
 const img=page.locator('.cursor-crosshair'); const b=await img.boundingBox();if(!b)throw Error('Missing receiver canvas');
 await page.mouse.move(b.x+b.width*.18,b.y+b.height*.25,{steps:20});await page.mouse.down();await page.mouse.move(b.x+b.width*.84,b.y+b.height*.59,{steps:50});await page.mouse.up();
 await page.getByRole('button',{name:'Render this area'}).waitFor();await page.waitForTimeout(2000);
 await page.screenshot({path:path.join(out,'selection.png')});
 await page.evaluate(()=>{window.demoTiles=[];new MutationObserver(()=>{const n=document.querySelectorAll('.cursor-crosshair img[alt="Verified source detail"]').length;if(n&&window.demoTiles.at(-1)?.count!==n)window.demoTiles.push({t:Date.now(),count:n});}).observe(document.body,{childList:true,subtree:true});});
 mark('request');await page.getByRole('button',{name:'Render this area'}).click();await page.mouse.move(960,530,{steps:25});
 let first=false,last=0;const tileEvents=[];
 for(let i=0;i<180;i++){
   const count=await img.getByAltText('Verified source detail').count();
   if(count!==last){tileEvents.push({t:(Date.now()-start)/1000,count});console.log('Verified tiles:',count);last=count;}
   if(count && !first){mark('firstTile');first=true;}
   if(count===6){mark('complete');break;}await page.waitForTimeout(1000);
 }
 if(last!==6)throw Error(`Incomplete transfer: ${last}/6`);
 await page.waitForTimeout(1800);await page.screenshot({path:path.join(out,'detail.png')});mark('hold');await page.waitForTimeout(3500);
 mark('extras');await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForTimeout(700);
 await page.getByPlaceholder('Message').nth(1).fill('I can read it now — Oak Flat Loop.');await page.getByPlaceholder('Message').nth(1).press('Enter');await page.waitForTimeout(3000);
 await page.mouse.move(960,530,{steps:20});await page.waitForTimeout(1000);await page.getByRole('button',{name:'Settings',exact:true}).click();await page.waitForTimeout(2200);mark('controls');await page.waitForTimeout(3500);
 await page.getByRole('button',{name:'Event timeline',exact:true}).click();await page.waitForTimeout(3500);
 await page.screenshot({path:path.join(out,'mesh.png')});mark('end');
 const observedTiles=await page.evaluate(origin=>window.demoTiles.map(e=>({...e,t:(e.t-origin)/1000})),start);
 const video=page.video();await context.close();const videoPath=await video.path();await browser.close();
 fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify({videoPath,marks,tileEvents,observedTiles,errors,viewport:{width:1920,height:1080}},null,2));
 if(errors.length)throw Error(errors.join('\n'));
 console.log('Capture verified:',videoPath);
})().catch(e=>{console.error(e);process.exit(1)});
