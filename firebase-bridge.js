import { firebaseConfig, CLASS_ID } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

/*
  난초반 만능툴 업데이트 안전 계층
  --------------------------------
  APP_VERSION  : 화면/기능 코드 버전
  DATA_VERSION : Firebase/localStorage 데이터 구조 버전

  이후 앱 파일이 바뀌어도 migrateState()에서 옛 데이터를 새 구조로
  보완한 뒤 사용하도록 설계합니다. 기존 필드는 삭제하지 않습니다.
*/
export const APP_VERSION = "2026.08.20.2";
export const DATA_VERSION = 3;

const configured =
  firebaseConfig &&
  firebaseConfig.apiKey &&
  !String(firebaseConfig.apiKey).includes("PASTE_") &&
  firebaseConfig.projectId &&
  !String(firebaseConfig.projectId).includes("PASTE_");

const KEY = "nancho-dual-master-plus-v1";
const mode = window.NANCHO_FIREBASE_MODE || "display";

const LEGACY_STUDENTS = [
  "강승효","김동윤","김주원","양지완","이서준","이영현","이이안","이지환",
  "이호진","정민준","정윤후","하이준","고서진","김리재","박나윤","박서은",
  "송윤하","이가빈","임엘린","정단우","정이현","조서윤","최인아","김나현"
];
const LEGACY_ROLES = [
  {name:"급식",count:4,emoji:"🍱"},{name:"뒷정리 도우미",count:2,emoji:"🧽"},
  {name:"시간표",count:1,emoji:"🗓️"},{name:"태블릿(고정자리)",count:2,emoji:"💻"},
  {name:"연필깎이",count:1,emoji:"✏️"},{name:"에어컨담당",count:1,emoji:"❄️"},
  {name:"공기청정기",count:1,emoji:"🌿"},{name:"우유",count:2,emoji:"🥛"},
  {name:"물티슈&휴지",count:1,emoji:"🧻"},{name:"경기어린이",count:2,emoji:"📰"},
  {name:"칠판지우기",count:1,emoji:"🧹"},{name:"심부름",count:1,emoji:"📨"},
  {name:"도서정리",count:1,emoji:"📚"},{name:"일반시민",count:2,emoji:"🙂"},
  {name:"문집정리",count:2,emoji:"📘"}
];


// Firebase에 함께 보관할 데이터.
// 새 필드를 추가할 때 여기에도 추가하면 업데이트 배포 시 그대로 동기화됩니다.
const CLOUD_FIELDS = [
  "titleText","seats","roleAssignments","points","birthdays",
  "announcement","morningNotice","lunch","lunchPromise","lifeBookText","praise",
  "classState","events","todos","timetable","timer",
  "studentPinHashes","checkHistory",
  "warnings","logs","roleReviews",

  // 업데이트/학급 확장용 메타 데이터
  "dataVersion","lastAppVersion","classConfig","students","roles"
];

function clone(v){
  try{return structuredClone(v);}catch(e){
    try{return JSON.parse(JSON.stringify(v));}catch(e2){return {};}
  }
}
function status(text, ok=false){
  window.dispatchEvent(new CustomEvent("nancho-cloud-status",{detail:{text,ok}}));
}
function versionStatus(fromVersion, migrated){
  window.NanchoVersion = {appVersion:APP_VERSION,dataVersion:DATA_VERSION};
  window.dispatchEvent(new CustomEvent("nancho-version-status",{
    detail:{appVersion:APP_VERSION,dataVersion:DATA_VERSION,fromVersion,migrated}
  }));
}
function isObj(v){return !!v && typeof v==="object" && !Array.isArray(v);}
function ensureObj(v){return isObj(v)?v:{};}
function uniqueArray(arr){
  const seen=new Set();
  return (Array.isArray(arr)?arr:[]).filter(x=>{
    const k=JSON.stringify(x);
    if(seen.has(k))return false;
    seen.add(k);return true;
  });
}
function rosterNames(state){
  if(Array.isArray(state?.students) && state.students.length){
    const names=state.students.map(s=>String(s?.name||"").trim()).filter(Boolean);
    if(names.length)return names;
  }
  if(Array.isArray(state?.seats) && state.seats.length){
    const names=state.seats.map(x=>String(x||"").trim()).filter(Boolean);
    if(names.length)return [...new Set(names)];
  }
  const keyNames=[
    ...Object.keys(ensureObj(state?.points)),
    ...Object.keys(ensureObj(state?.birthdays)),
    ...Object.keys(ensureObj(state?.logs))
  ].filter(Boolean);
  return keyNames.length?[...new Set(keyNames)]:LEGACY_STUDENTS;
}
function makeStudentId(index){
  return `student-${String(index+1).padStart(3,"0")}`;
}

/*
  데이터 마이그레이션 규칙
  -----------------------
  원칙:
  1) 기존 값은 삭제하지 않는다.
  2) 새 버전에 필요한 필드만 추가/보완한다.
  3) dataVersion을 한 단계씩 올린다.

  다음 업데이트에서 DATA_VERSION=3으로 올린다면:
    if(v < 3) {
      // 필요한 새 필드만 추가
      v = 3;
    }
  를 아래에 이어서 추가하면 됩니다.
*/
export function migrateState(input){
  const state=clone(isObj(input)?input:{});
  const originalVersion=Number(state.dataVersion||0);
  let v=originalVersion;
  let changed=false;

  // v0 → v1 : 기존 난초반 데이터의 기본 타입 보완
  if(v < 1){
    state.points=ensureObj(state.points);
    state.birthdays=ensureObj(state.birthdays);
    state.warnings=ensureObj(state.warnings);
    state.logs=ensureObj(state.logs);
    state.roleReviews=ensureObj(state.roleReviews);
    if(!Array.isArray(state.events))state.events=[];
    if(!Array.isArray(state.todos))state.todos=[];
    if(!Array.isArray(state.checkHistory))state.checkHistory=[];
    if(!Array.isArray(state.seats))state.seats=[...LEGACY_STUDENTS];

    rosterNames(state).forEach(name=>{
      if(state.points[name]==null)state.points[name]=0;
      if(state.birthdays[name]==null)state.birthdays[name]="";
      if(state.warnings[name]==null)state.warnings[name]=0;
      if(!Array.isArray(state.logs[name]))state.logs[name]=[];
      if(!Array.isArray(state.roleReviews[name]))state.roleReviews[name]=[];
    });

    v=1;changed=true;
  }

  // v1 → v2 : 향후 '학급 설정/학생명단 수정'을 위한 내부 구조 준비
  // 현재 화면은 기존 이름 기반 데이터를 그대로 사용하므로 화면 동작은 바뀌지 않습니다.
  if(v < 2){
    const names=rosterNames(state);
    if(!isObj(state.classConfig)){
      state.classConfig={
        schoolYear:2026,
        grade:5,
        className:"난초반"
      };
    }else{
      if(state.classConfig.schoolYear==null)state.classConfig.schoolYear=2026;
      if(state.classConfig.grade==null)state.classConfig.grade=5;
      if(!state.classConfig.className)state.classConfig.className="난초반";
    }

    if(!Array.isArray(state.students) || !state.students.length){
      state.students=names.map((name,i)=>({
        id:makeStudentId(i),
        name,
        legacyName:name,
        active:true
      }));
    }else{
      state.students=state.students.map((s,i)=>({
        ...s,
        id:s?.id||makeStudentId(i),
        name:String(s?.name||s?.legacyName||names[i]||`학생${i+1}`),
        legacyName:String(s?.legacyName||s?.name||names[i]||`학생${i+1}`),
        active:s?.active!==false
      }));
    }

    v=2;changed=true;
  }


  // v2 → v3 : 역할 설정을 데이터화하여 반마다 역할명/이모지/인원수 수정 가능
  if(v < 3){
    if(!Array.isArray(state.roles) || !state.roles.length){
      state.roles=LEGACY_ROLES.map((r,i)=>({
        id:`role-${String(i+1).padStart(3,"0")}`,
        ...r
      }));
    }else{
      state.roles=state.roles.map((r,i)=>({
        id:r?.id||`role-${String(i+1).padStart(3,"0")}`,
        name:String(r?.name||`역할 ${i+1}`),
        count:Math.max(1,Number(r?.count||1)),
        emoji:String(r?.emoji||"🌱")
      }));
    }
    v=3;changed=true;
  }

  if(Number(state.dataVersion||0)!==DATA_VERSION){
    state.dataVersion=DATA_VERSION;changed=true;
  }
  if(state.lastAppVersion!==APP_VERSION){
    state.lastAppVersion=APP_VERSION;changed=true;
  }

  return {state,changed,fromVersion:originalVersion,toVersion:DATA_VERSION};
}

function pickCloud(rawState){
  const migrated=migrateState(rawState).state;
  const out={};
  for(const k of CLOUD_FIELDS){
    if(Object.prototype.hasOwnProperty.call(migrated,k))out[k]=migrated[k];
  }
  return out;
}

// 교사용 로컬 기록과 Firebase 기록이 둘 다 있을 경우 비파괴적으로 합칩니다.
// 생활기록/역할평가 = 중복 제거 후 합치기, 경고수 = 더 큰 값을 보존.
function mergeTeacherPrivate(localState, remoteState){
  const local=clone(localState||{});
  const remote=clone(remoteState||{});

  const names=[...new Set([
    ...rosterNames(local),
    ...rosterNames(remote)
  ])];

  remote.logs=ensureObj(remote.logs);
  remote.roleReviews=ensureObj(remote.roleReviews);
  remote.warnings=ensureObj(remote.warnings);

  const lLogs=ensureObj(local.logs);
  const lReviews=ensureObj(local.roleReviews);
  const lWarnings=ensureObj(local.warnings);

  names.forEach(name=>{
    remote.logs[name]=uniqueArray([...(remote.logs[name]||[]),...(lLogs[name]||[])]);
    remote.roleReviews[name]=uniqueArray([...(remote.roleReviews[name]||[]),...(lReviews[name]||[])]);
    remote.warnings[name]=Math.max(Number(remote.warnings[name]||0),Number(lWarnings[name]||0));
  });
  return remote;
}

function mergeCloud(localState, cloudState){
  // Firebase 값을 기본으로 하되 localStorage에만 존재하는 알 수 없는 옛 필드는 보존.
  return Object.assign({}, localState||{}, cloudState||{});
}

if(!configured){
  // Firebase 미설정이어도 localStorage 자체는 최신 데이터 구조로 올려 둡니다.
  let local={};
  try{local=JSON.parse(localStorage.getItem(KEY)||"{}");}catch(e){}
  const migrated=migrateState(local);
  try{localStorage.setItem(KEY,JSON.stringify(migrated.state));}catch(e){}
  versionStatus(migrated.fromVersion,migrated.changed);
  status("Firebase 미설정 · 현재 기기 저장",false);
  window.NanchoCloud={enabled:false};
}else{
  try{
    const app=initializeApp(firebaseConfig);
    const auth=getAuth(app);
    const db=getFirestore(app);
    await signInAnonymously(auth);

    const ref=doc(db,"classes",CLASS_ID);

    window.NanchoCloud={
      enabled:true,
      db,ref,
      appVersion:APP_VERSION,
      dataVersion:DATA_VERSION,
      async saveState(rawState){
        const migrated=migrateState(rawState);
        try{localStorage.setItem(KEY,JSON.stringify(migrated.state));}catch(e){}
        await setDoc(ref,{
          state:pickCloud(migrated.state),
          appMeta:{
            appVersion:APP_VERSION,
            dataVersion:DATA_VERSION,
            updatedByMode:mode
          },
          updatedAt:serverTimestamp()
        },{merge:true});
        versionStatus(migrated.fromVersion,migrated.changed);
      },
      async getState(){
        const snap=await getDoc(ref);
        if(!snap.exists())return null;
        return migrateState(snap.data().state||{}).state;
      }
    };

    let local={};
    try{local=JSON.parse(localStorage.getItem(KEY)||"{}");}catch(e){}
    const localMigrated=migrateState(local);

    const initial=await getDoc(ref);

    if(!initial.exists()){
      // 첫 Firebase 저장: 현재 로컬 데이터를 그대로 최신 구조로 올림
      await window.NanchoCloud.saveState(localMigrated.state);
      versionStatus(localMigrated.fromVersion,localMigrated.changed);
    }else{
      const remoteRaw=initial.data().state||{};
      const remoteMigrated=migrateState(remoteRaw);

      let mergedRemote=remoteMigrated.state;

      // teacher에서는 구버전 PC에 남아 있던 개인기록까지 비파괴적으로 병합.
      if(mode==="teacher"){
        mergedRemote=mergeTeacherPrivate(localMigrated.state,mergedRemote);
      }

      // localStorage에만 있던 알 수 없는 구버전 필드도 보존한 상태로 로컬 캐시 작성.
      const mergedLocal=migrateState(mergeCloud(localMigrated.state,mergedRemote)).state;
      try{localStorage.setItem(KEY,JSON.stringify(mergedLocal));}catch(e){}

      // 구조가 옛 버전이었거나 교사용 병합 결과가 달라졌다면 Firebase를 최신 상태로 갱신.
      const before=JSON.stringify(pickCloud(remoteRaw));
      const after=JSON.stringify(pickCloud(mergedRemote));
      if(remoteMigrated.changed || before!==after){
        await setDoc(ref,{
          state:pickCloud(mergedRemote),
          appMeta:{
            appVersion:APP_VERSION,
            dataVersion:DATA_VERSION,
            migratedFrom:remoteMigrated.fromVersion,
            updatedByMode:mode
          },
          updatedAt:serverTimestamp()
        },{merge:true});
      }

      versionStatus(
        Math.min(localMigrated.fromVersion,remoteMigrated.fromVersion),
        localMigrated.changed||remoteMigrated.changed
      );
    }

    onSnapshot(ref,(snap)=>{
      status("Firebase 연결됨 · 실시간 동기화",true);
      if(!snap.exists())return;

      const remoteMigration=migrateState(snap.data().state||{});
      let localNow={};
      try{localNow=JSON.parse(localStorage.getItem(KEY)||"{}");}catch(e){}

      let remoteState=remoteMigration.state;
      if(mode==="teacher"){
        remoteState=mergeTeacherPrivate(localNow,remoteState);
      }

      const merged=migrateState(mergeCloud(localNow,remoteState)).state;
      localStorage.setItem(KEY,JSON.stringify(merged));

      versionStatus(remoteMigration.fromVersion,remoteMigration.changed);
      window.dispatchEvent(new CustomEvent("nancho-cloud-update",{detail:{state:merged}}));
    },(err)=>{
      console.error(err);
      status("Firebase 연결 오류",false);
    });

    status("Firebase 연결됨 · 실시간 동기화",true);
    window.dispatchEvent(new Event("nancho-cloud-ready"));
  }catch(err){
    console.error(err);
    status("Firebase 연결 실패",false);
    window.NanchoCloud={enabled:false,error:err};
  }
}
