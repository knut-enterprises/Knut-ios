// iPhone 6.9" screenshots (1290x2796) of the live site, shown the way the app shows it (?app=ios).
import {chromium} from 'playwright';import fs from 'node:fs';
const app=process.argv[2];
const cfg=JSON.parse(fs.readFileSync(`${app}/capacitor.config.json`,'utf8'));
const base=cfg.server.url.split('?')[0].replace(/\/$/,'');
const shots=(JSON.parse(fs.readFileSync(`${app}/listing.json`,'utf8')).screenshots)||[{path:'/',name:'1-home',scroll:0},{path:'/',name:'2-more',scroll:900},{path:'/',name:'3-more',scroll:1900},{path:'/signup',name:'4-signup',scroll:0}];
fs.mkdirSync('shots',{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'});
for(const s of shots){
  const pg=await ctx.newPage();
  await pg.goto(`${base}${s.path}?app=ios`,{waitUntil:'networkidle',timeout:60000}).catch(()=>{});
  await pg.waitForTimeout(3000);
  if(s.scroll)await pg.evaluate(y=>window.scrollTo(0,y),s.scroll);
  await pg.waitForTimeout(800);
  await pg.screenshot({path:`shots/${s.name}.png`});
  await pg.close();
}
// Google Play phone screenshots (1080x1920)
fs.mkdirSync('shots-play',{recursive:true});
const c2=await b.newContext({viewport:{width:360,height:640},deviceScaleFactor:3,isMobile:true,hasTouch:true});
for(const s of shots){const pg=await c2.newPage();await pg.goto(`${base}${s.path}?app=android`,{waitUntil:'networkidle',timeout:60000}).catch(()=>{});await pg.waitForTimeout(3000);if(s.scroll)await pg.evaluate(y=>window.scrollTo(0,y*0.8),s.scroll);await pg.waitForTimeout(800);await pg.screenshot({path:`shots-play/${s.name}.png`});await pg.close();}
await b.close();
console.log(fs.readdirSync('shots'));
