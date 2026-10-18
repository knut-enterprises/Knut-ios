// Creates (via the App Store Connect API) an App Store distribution certificate and
// provisioning profile for the Knut app, installs them on this runner and writes
// PROFILE_NAME / SIGN_IDENTITY to GITHUB_ENV. Errors print as workflow annotations.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

const {ASC_KEY_ID:kid,ASC_ISSUER_ID:iss,ASC_KEY_PATH:keyPath,RUNNER_TEMP:tmp,GITHUB_ENV:envFile}=process.env;
const BUNDLE=process.env.BUNDLE_ID||'au.com.knut.app',APP_NAME=process.env.APP_NAME||'Knut',PASS=(process.env.CACHE_PASSPHRASE&&process.env.CACHE_PASSPHRASE!=='null')?process.env.CACHE_PASSPHRASE:'';
const CACHE=`${os.homedir()}/.knut-signing`;
const fail=m=>{console.log(`::error::${String(m).slice(0,900).replace(/\n/g,' ')}`);process.exit(1);};
const b64u=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(){
  const h=b64u({alg:'ES256',kid,typ:'JWT'}),n=Math.floor(Date.now()/1000),c=b64u({iss,iat:n,exp:n+900,aud:'appstoreconnect-v1'});
  const sig=crypto.sign('SHA256',Buffer.from(`${h}.${c}`),{key:fs.readFileSync(keyPath),dsaEncoding:'ieee-p1363'}).toString('base64url');
  return `${h}.${c}.${sig}`;
}
async function api(method,path,body){
  const r=await fetch(`https://api.appstoreconnect.apple.com${path}`,{method,headers:{authorization:`Bearer ${jwt()}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const t=await r.text();let j;try{j=JSON.parse(t);}catch{j={raw:t};}
  return {status:r.status,json:j};
}
const sh=(cmd,args,opts={})=>execFileSync(cmd,args,{encoding:'utf8',...opts});
const err=r=>JSON.stringify(r.json.errors??r.json).slice(0,700);

// 1. The app id
let r=await api('GET',`/v1/bundleIds?filter[identifier]=${BUNDLE}&limit=5`);
if(r.status!==200)fail(`Apple rejected the API key (HTTP ${r.status}): ${err(r)}`);
let bundle=r.json.data.find(b=>b.attributes.identifier===BUNDLE);
if(!bundle){
  const c=await api('POST','/v1/bundleIds',{data:{type:'bundleIds',attributes:{identifier:BUNDLE,name:`${APP_NAME} iOS`,platform:'IOS'}}});
  if(c.status!==201)fail(`Could not register app id ${BUNDLE}: HTTP ${c.status} ${err(c)}`);
  bundle=c.json.data;console.log(`::notice::Registered app id ${BUNDLE}`);
}
console.log(`::notice::Key accepted by Apple. App id ${bundle.id}`);

// 2. Push notifications capability (ignore "already enabled")
r=await api('POST','/v1/bundleIdCapabilities',{data:{type:'bundleIdCapabilities',attributes:{capabilityType:'PUSH_NOTIFICATIONS'},relationships:{bundleId:{data:{type:'bundleIds',id:bundle.id}}}}});
console.log(`::notice::Push capability: HTTP ${r.status}`);

// 3. Distribution certificate: reuse the one kept (encrypted) in the cache, else create it
const dir=`${tmp}/sign`;fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(CACHE,{recursive:true});
const dec=(src,dst)=>sh('/usr/bin/openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-in',src,'-out',dst,'-pass','env:CACHE_PASSPHRASE']);
const enc=(src,dst)=>sh('/usr/bin/openssl',['enc','-aes-256-cbc','-pbkdf2','-salt','-in',src,'-out',dst,'-pass','env:CACHE_PASSPHRASE']);
let cert=null;
if(PASS&&fs.existsSync(`${CACHE}/cert.json`)&&fs.existsSync(`${CACHE}/key.pem.enc`)){
  try{
    const saved=JSON.parse(fs.readFileSync(`${CACHE}/cert.json`,'utf8'));
    const g=await api('GET',`/v1/certificates/${saved.id}`);
    if(g.status===200&&new Date(g.json.data.attributes.expirationDate)>new Date(Date.now()+7*864e5)){
      dec(`${CACHE}/key.pem.enc`,`${dir}/key.pem`);
      fs.copyFileSync(`${CACHE}/cert.cer`,`${dir}/cert.cer`);
      cert=g.json.data;console.log(`::notice::Reusing the cached distribution certificate ${cert.id}`);
    }else console.log(`::notice::Cached certificate no longer valid (HTTP ${g.status})`);
  }catch(e){console.log(`::warning::Cached certificate unusable: ${String(e.stderr||e.message).slice(0,200)}`);}
}
if(!cert){
  // Certificates this pipeline made on earlier runs (no longer usable) count against Apple's limit: revoke those from the last 3 days.
  const all=await api('GET','/v1/certificates?limit=100');
  for(const c of all.json.data??[]){
    const t=c.attributes.certificateType,created=new Date(c.attributes.expirationDate).getTime()-365*864e5;
    if((t==='DISTRIBUTION'||t==='IOS_DISTRIBUTION')&&Date.now()-created<3*864e5&&Date.now()-created>-864e5){
      const d=await api('DELETE',`/v1/certificates/${c.id}`);console.log(`::notice::Revoked stale CI certificate ${c.id} (HTTP ${d.status})`);
    }
  }
  sh('/usr/bin/openssl',['genrsa','-out',`${dir}/key.pem`,'2048'],{stdio:'pipe'});
  sh('/usr/bin/openssl',['req','-new','-key',`${dir}/key.pem`,'-out',`${dir}/req.csr`,'-subj','/CN=Knut CI/O=Knut/C=AU'],{stdio:'pipe'});
  const csr=fs.readFileSync(`${dir}/req.csr`,'utf8');
  let lastErr='';
  for(const type of ['DISTRIBUTION','IOS_DISTRIBUTION']){
    r=await api('POST','/v1/certificates',{data:{type:'certificates',attributes:{certificateType:type,csrContent:csr}}});
    if(r.status===201){cert=r.json.data;break;}
    lastErr=`${type}: HTTP ${r.status} ${err(r)}`;console.log(`::warning::Certificate ${lastErr}`);
  }
  if(!cert){
    const l=await api('GET','/v1/certificates?limit=50');
    const names=(l.json.data??[]).map(c=>`${c.id}:${c.attributes.certificateType}:${c.attributes.expirationDate}`).join(', ');
    fail(`Could not create a distribution certificate. ${lastErr}. Existing: ${names}`);
  }
  fs.writeFileSync(`${dir}/cert.cer`,Buffer.from(cert.attributes.certificateContent,'base64'));
  if(PASS){
    enc(`${dir}/key.pem`,`${CACHE}/key.pem.enc`);
    fs.copyFileSync(`${dir}/cert.cer`,`${CACHE}/cert.cer`);
    fs.writeFileSync(`${CACHE}/cert.json`,JSON.stringify({id:cert.id}));
  }
  console.log(`::notice::Created distribution certificate ${cert.id}`);
}
sh('/usr/bin/openssl',['x509','-inform','der','-in',`${dir}/cert.cer`,'-out',`${dir}/cert.pem`]);
sh('/usr/bin/openssl',['pkcs12','-export','-inkey',`${dir}/key.pem`,'-in',`${dir}/cert.pem`,'-out',`${dir}/cert.p12`,'-passout','pass:ci']);

// 4. Temporary keychain
const kc=`${dir}/build.keychain-db`;
sh('security',['create-keychain','-p','ci',kc]);
sh('security',['set-keychain-settings','-lut','7200',kc]);
sh('security',['unlock-keychain','-p','ci',kc]);
sh('security',['import',`${dir}/cert.p12`,'-k',kc,'-P','ci','-T','/usr/bin/codesign','-T','/usr/bin/security']);
sh('security',['set-key-partition-list','-S','apple-tool:,apple:,codesign:','-s','-k','ci',kc],{stdio:'pipe'});
const existing=sh('security',['list-keychains','-d','user']).split('\n').map(s=>s.trim().replace(/"/g,'')).filter(Boolean);
sh('security',['list-keychains','-d','user','-s',kc,...existing]);
const ids=sh('security',['find-identity','-v','-p','codesigning',kc]);
const m=ids.match(/"((?:Apple|iPhone) Distribution[^"]*)"/);
if(!m)fail(`Certificate imported but no distribution identity found: ${ids}`);

// 5. App Store provisioning profile (remove this app's earlier CI profiles first)
{
  const old=await api('GET',`/v1/bundleIds/${bundle.id}/profiles?limit=50`);
  for(const pr of old.json.data??[])if(String(pr.attributes.name).startsWith('Knut CI '))await api('DELETE',`/v1/profiles/${pr.id}`);
}
const pname=`Knut CI ${Date.now()}`;
r=await api('POST','/v1/profiles',{data:{type:'profiles',attributes:{name:pname,profileType:'IOS_APP_STORE'},relationships:{bundleId:{data:{type:'bundleIds',id:bundle.id}},certificates:{data:[{type:'certificates',id:cert.id}]}}}});
if(r.status!==201)fail(`Could not create the provisioning profile: HTTP ${r.status} ${err(r)}`);
const prof=`${dir}/app.mobileprovision`;
fs.writeFileSync(prof,Buffer.from(r.json.data.attributes.profileContent,'base64'));
const plist=sh('security',['cms','-D','-i',prof]);fs.writeFileSync(`${dir}/prof.plist`,plist);
const uuid=sh('/usr/libexec/PlistBuddy',['-c','Print :UUID',`${dir}/prof.plist`]).trim();
const pdir=`${os.homedir()}/Library/MobileDevice/Provisioning Profiles`;fs.mkdirSync(pdir,{recursive:true});
fs.copyFileSync(prof,`${pdir}/${uuid}.mobileprovision`);

fs.appendFileSync(envFile,`PROFILE_NAME=${pname}\nSIGN_IDENTITY=${m[1]}\n`);
console.log(`::notice::Signing ready: ${m[1]} / ${pname}`);
