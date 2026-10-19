// Takes an app's version out of review, attaches the newest processed build and sends it back for review.
import fs from 'node:fs';import crypto from 'node:crypto';
const {ASC_KEY_ID,ASC_ISSUER_ID,ASC_KEY_PATH,BUNDLE_ID}=process.env;
const b64=b=>Buffer.from(b).toString('base64url');
function jwt(){const h=b64(JSON.stringify({alg:'ES256',kid:ASC_KEY_ID,typ:'JWT'})),n=Math.floor(Date.now()/1000);
  const p=b64(JSON.stringify({iss:ASC_ISSUER_ID,iat:n,exp:n+1100,aud:'appstoreconnect-v1'}));
  const s=crypto.sign('SHA256',Buffer.from(`${h}.${p}`),{key:fs.readFileSync(ASC_KEY_PATH),dsaEncoding:'ieee-p1363'});return `${h}.${p}.${b64(s)}`;}
async function api(method,p,body){const r=await fetch(`https://api.appstoreconnect.apple.com${p}`,{method,headers:{authorization:`Bearer ${jwt()}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const t=await r.text();let j;try{j=JSON.parse(t);}catch{j={raw:t};}return {status:r.status,json:j};}
const err=r=>JSON.stringify(r.json.errors??r.json).slice(0,1500);
const ok=(r,w)=>{if(r.status>=300){console.log(`::error::${w} HTTP ${r.status} ${err(r)}`);process.exit(1);}return r;};
const app=ok(await api('GET',`/v1/apps?filter[bundleId]=${BUNDLE_ID}`),'app').json.data[0];
const vs=ok(await api('GET',`/v1/apps/${app.id}/appStoreVersions?limit=5`),'versions').json.data;
console.log('::notice::Versions: '+vs.map(v=>`${v.attributes.versionString}:${v.attributes.appStoreState}`).join(', '));
// 1. take it out of review
const subs=ok(await api('GET',`/v1/apps/${app.id}/reviewSubmissions?filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,READY_FOR_REVIEW&limit=20`),'submissions').json.data;
for(const s of subs){if(s.attributes.state==='WAITING_FOR_REVIEW'||s.attributes.state==='IN_REVIEW'){const c=await api('PATCH',`/v1/reviewSubmissions/${s.id}`,{data:{type:'reviewSubmissions',id:s.id,attributes:{canceled:true}}});console.log(`::notice::Cancel submission ${s.id} (${s.attributes.state}): HTTP ${c.status} ${c.status>=300?err(c):''}`);}}
// wait for the version to return to editable
let ver;for(let i=0;i<20;i++){const r=ok(await api('GET',`/v1/apps/${app.id}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,REJECTED&limit=5`),'editable');ver=r.json.data[0];if(ver)break;await new Promise(r=>setTimeout(r,6000));}
if(!ver){console.log('::error::Version did not become editable');process.exit(1);}
console.log(`::notice::Editable version ${ver.id} ${ver.attributes.appStoreState}`);
// 2. newest processed build
const bs=ok(await api('GET',`/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=10`),'builds').json.data;
const b=bs.find(x=>x.attributes.processingState==='VALID'&&!x.attributes.expired);
if(!b){console.log('::error::No processed build: '+bs.map(x=>x.attributes.version+':'+x.attributes.processingState).join(','));process.exit(1);}
ok(await api('PATCH',`/v1/appStoreVersions/${ver.id}/relationships/build`,{data:{type:'builds',id:b.id}}),'attach build');
console.log(`::notice::Attached build ${b.attributes.version}`);
// 3. back to review
let rs=(await api('GET',`/v1/apps/${app.id}/reviewSubmissions?filter[state]=READY_FOR_REVIEW&include=items&limit=20`)).json;
let sub=(rs.data??[])[0];
if(!sub)sub=ok(await api('POST','/v1/reviewSubmissions',{data:{type:'reviewSubmissions',attributes:{platform:'IOS'},relationships:{app:{data:{type:'apps',id:app.id}}}}}),'create submission').json.data;
const has=(rs.included??[]).some(i=>i.type==='reviewSubmissionItems'&&sub.relationships?.items?.data?.some(d=>d.id===i.id));
if(!has)ok(await api('POST','/v1/reviewSubmissionItems',{data:{type:'reviewSubmissionItems',relationships:{reviewSubmission:{data:{type:'reviewSubmissions',id:sub.id}},appStoreVersion:{data:{type:'appStoreVersions',id:ver.id}}}}}),'add version');
const f=ok(await api('PATCH',`/v1/reviewSubmissions/${sub.id}`,{data:{type:'reviewSubmissions',id:sub.id,attributes:{submitted:true}}}),'submit');
console.log(`::notice::Submitted: ${f.json.data.attributes.state}`);
