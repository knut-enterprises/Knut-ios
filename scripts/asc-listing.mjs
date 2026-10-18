// Fills in an App Store listing from <app>/listing.json and uploads screenshots from ./shots.
// Uses the App Store Connect API key the workflow fetched. Each step reports its own result.
import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';
const {ASC_KEY_ID,ASC_ISSUER_ID,ASC_KEY_PATH,APP_DIR}=process.env;
const L=JSON.parse(fs.readFileSync(`${APP_DIR}/listing.json`,'utf8'));
const b64=b=>Buffer.from(b).toString('base64url');
function jwt(){const h=b64(JSON.stringify({alg:'ES256',kid:ASC_KEY_ID,typ:'JWT'})),n=Math.floor(Date.now()/1000);
  const p=b64(JSON.stringify({iss:ASC_ISSUER_ID,iat:n,exp:n+1100,aud:'appstoreconnect-v1'}));
  const s=crypto.sign('SHA256',Buffer.from(`${h}.${p}`),{key:fs.readFileSync(ASC_KEY_PATH),dsaEncoding:'ieee-p1363'});return `${h}.${p}.${b64(s)}`;}
async function api(method,p,body){const r=await fetch(`https://api.appstoreconnect.apple.com${p}`,{method,headers:{authorization:`Bearer ${jwt()}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const t=await r.text();let j;try{j=JSON.parse(t);}catch{j={raw:t};}return {status:r.status,json:j};}
const err=r=>JSON.stringify(r.json.errors??r.json).slice(0,600);
let bad=0;
const ENUMS=new Set(['alcoholTobaccoOrDrugUseOrReferences','contests','gamblingSimulated','gunsOrOtherWeapons','horrorOrFearThemes','matureOrSuggestiveThemes','medicalOrTreatmentInformation','profanityOrCrudeHumor','sexualContentGraphicAndNudity','sexualContentOrNudity','violenceCartoonOrFantasy','violenceRealistic','violenceRealisticProlongedGraphicOrSadistic']);
async function step(name,fn){try{const m=await fn();console.log(`::notice::${name}: ${m??'ok'}`);}catch(e){bad++;console.log(`::error::${name}: ${e.message}`);}}
const ok=(r,what)=>{if(r.status>=300)throw new Error(`${what} HTTP ${r.status} ${err(r)}`);return r;};

let app,ver,vloc,info,iloc;
await step('Find app',async()=>{const r=ok(await api('GET',`/v1/apps?filter[bundleId]=${L.bundleId}`),'apps');app=r.json.data[0];if(!app)throw new Error('no app');return app.id;});
await step('Find version',async()=>{const r=ok(await api('GET',`/v1/apps/${app.id}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION&include=appStoreVersionLocalizations`),'versions');ver=r.json.data[0];vloc=(r.json.included??[]).find(i=>i.attributes.locale===L.locale)??(r.json.included??[])[0];return `${ver.id} loc ${vloc?.id}`;});
await step('Version text',async()=>{
  ok(await api('PATCH',`/v1/appStoreVersionLocalizations/${vloc.id}`,{data:{type:'appStoreVersionLocalizations',id:vloc.id,attributes:{description:L.description,keywords:L.keywords,promotionalText:L.promotionalText,supportUrl:L.supportUrl,marketingUrl:L.marketingUrl}}}),'localization');
  ok(await api('PATCH',`/v1/appStoreVersions/${ver.id}`,{data:{type:'appStoreVersions',id:ver.id,attributes:{copyright:L.copyright,releaseType:'AFTER_APPROVAL'}}}),'version');});
await step('App info (name, subtitle, privacy URL, categories)',async()=>{
  const r=ok(await api('GET',`/v1/apps/${app.id}/appInfos?include=appInfoLocalizations`),'appInfos');info=r.json.data[0];iloc=(r.json.included??[]).find(i=>i.attributes.locale===L.locale)??(r.json.included??[])[0];
  ok(await api('PATCH',`/v1/appInfoLocalizations/${iloc.id}`,{data:{type:'appInfoLocalizations',id:iloc.id,attributes:{name:L.name,subtitle:L.subtitle,privacyPolicyUrl:L.privacyPolicyUrl}}}),'info localization');
  const rel={primaryCategory:{data:{type:'appCategories',id:L.primaryCategory}}};if(L.secondaryCategory)rel.secondaryCategory={data:{type:'appCategories',id:L.secondaryCategory}};
  ok(await api('PATCH',`/v1/appInfos/${info.id}`,{data:{type:'appInfos',id:info.id,relationships:rel}}),'categories');});
await step('Age rating',async()=>{
  const g=ok(await api('GET',`/v1/appInfos/${info.id}/ageRatingDeclaration`),'age rating');const d=g.json.data;const a={};
  for(const [k,v] of Object.entries(d.attributes)){
    if(k==='kidsAgeBand'||k.includes('Override')||k.includes('AgeRestriction')||k.includes('AgeRating'))continue;
    if(ENUMS.has(k))a[k]='NONE';
    else if(typeof v==='boolean'||v===null)a[k]=false;
  }
  Object.assign(a,L.ageRating??{});
  const r=await api('PATCH',`/v1/ageRatingDeclarations/${d.id}`,{data:{type:'ageRatingDeclarations',id:d.id,attributes:a}});
  ok(r,'age rating update');return JSON.stringify(Object.keys(a));});
await step('Review details',async()=>{
  const R=L.review;const attrs={contactFirstName:R.firstName,contactLastName:R.lastName,contactPhone:R.phone,contactEmail:R.email,demoAccountRequired:R.demoAccountRequired,notes:R.notes};
  const g=await api('GET',`/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`);
  if(g.json.data){ok(await api('PATCH',`/v1/appStoreReviewDetails/${g.json.data.id}`,{data:{type:'appStoreReviewDetails',id:g.json.data.id,attributes:attrs}}),'review detail');}
  else ok(await api('POST','/v1/appStoreReviewDetails',{data:{type:'appStoreReviewDetails',attributes:attrs,relationships:{appStoreVersion:{data:{type:'appStoreVersions',id:ver.id}}}}}),'review detail create');});
await step('Screenshots',async()=>{
  const dir='shots';const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort():[];if(!files.length)throw new Error('no screenshots');
  const sets=ok(await api('GET',`/v1/appStoreVersionLocalizations/${vloc.id}/appScreenshotSets?include=appScreenshots`),'sets');
  let set=sets.json.data.find(s=>s.attributes.screenshotDisplayType==='APP_IPHONE_67');
  if(set){for(const s of (sets.json.included??[]).filter(i=>i.type==='appScreenshots'))await api('DELETE',`/v1/appScreenshots/${s.id}`);}
  else set=ok(await api('POST','/v1/appScreenshotSets',{data:{type:'appScreenshotSets',attributes:{screenshotDisplayType:'APP_IPHONE_67'},relationships:{appStoreVersionLocalization:{data:{type:'appStoreVersionLocalizations',id:vloc.id}}}}}),'new set').json.data;
  for(const f of files){
    const buf=fs.readFileSync(path.join(dir,f));
    const res=ok(await api('POST','/v1/appScreenshots',{data:{type:'appScreenshots',attributes:{fileName:f,fileSize:buf.length},relationships:{appScreenshotSet:{data:{type:'appScreenshotSets',id:set.id}}}}}),`reserve ${f}`).json.data;
    for(const op of res.attributes.uploadOperations){
      const hdr={};for(const h of op.requestHeaders)hdr[h.name]=h.value;
      const u=await fetch(op.url,{method:op.method,headers:hdr,body:buf.subarray(op.offset,op.offset+op.length)});if(!u.ok)throw new Error(`upload part ${u.status}`);}
    ok(await api('PATCH',`/v1/appScreenshots/${res.id}`,{data:{type:'appScreenshots',id:res.id,attributes:{uploaded:true,sourceFileChecksum:crypto.createHash('md5').update(buf).digest('hex')}}}),`commit ${f}`);
  }
  return `${files.length} uploaded`;});
await step('Price: free',async()=>{
  const pp=ok(await api('GET',`/v1/apps/${app.id}/appPricePoints?filter[territory]=AUS&limit=5`),'price points');
  const free=pp.json.data.find(p=>p.attributes.customerPrice==='0.0'||p.attributes.customerPrice==='0');
  if(!free)throw new Error('no free price point');
  ok(await api('POST','/v1/appPriceSchedules',{data:{type:'appPriceSchedules',relationships:{app:{data:{type:'apps',id:app.id}},baseTerritory:{data:{type:'territories',id:'AUS'}},manualPrices:{data:[{type:'appPrices',id:'${p1}'}]}}},included:[{type:'appPrices',id:'${p1}',attributes:{startDate:null},relationships:{appPricePoint:{data:{type:'appPricePoints',id:free.id}}}}]}),'price schedule');});
if(bad)console.log(`::warning::${bad} step(s) failed`);
