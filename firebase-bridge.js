import { firebaseConfig, CLASS_ID } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const configured =
  firebaseConfig &&
  firebaseConfig.apiKey &&
  !String(firebaseConfig.apiKey).includes("PASTE_") &&
  firebaseConfig.projectId &&
  !String(firebaseConfig.projectId).includes("PASTE_");

const KEY = "nancho-dual-master-plus-v1";
const mode = window.NANCHO_FIREBASE_MODE || "display";

// 이제 교사용 개인관리 데이터도 Firebase에 함께 저장합니다.
// display.html / check.html에는 이 정보를 표시하는 UI가 없으므로 화면에는 나타나지 않습니다.
const CLOUD_FIELDS = [
  "titleText","seats","roleAssignments","points","birthdays",
  "announcement","lunch","lunchPromise","lifeBookText","praise",
  "classState","events","todos","timetable","timer",
  "studentPinHashes","checkHistory",
  "warnings","logs","roleReviews"
];

function pickCloud(state){
  const out = {};
  for(const k of CLOUD_FIELDS){
    if(state && Object.prototype.hasOwnProperty.call(state,k)) out[k] = state[k];
  }
  return out;
}
function mergeCloud(localState, cloudState){
  return Object.assign({}, localState || {}, cloudState || {});
}
function status(text, ok=false){
  window.dispatchEvent(new CustomEvent("nancho-cloud-status",{detail:{text,ok}}));
}
function hasTeacherData(v){
  if(!v || typeof v!=="object") return false;
  return Object.values(v).some(x => Array.isArray(x) ? x.length>0 : Number(x||0)!==0);
}

if(!configured){
  console.warn("Firebase config not set. Running in local-only mode.");
  status("Firebase 미설정 · 현재 기기 저장", false);
  window.NanchoCloud = { enabled:false };
}else{
  try{
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    await signInAnonymously(auth);

    const ref = doc(db, "classes", CLASS_ID);

    window.NanchoCloud = {
      enabled:true,
      db, ref,
      async saveState(state){
        await setDoc(ref,{
          state: pickCloud(state),
          updatedAt: serverTimestamp()
        },{merge:true});
      },
      async getState(){
        const snap = await getDoc(ref);
        return snap.exists() ? (snap.data().state || {}) : null;
      }
    };

    // 구버전에서는 warnings/logs/roleReviews가 이 PC에만 저장되었습니다.
    // teacher.html에서 처음 새 브리지를 사용할 때,
    // Firebase에 해당 데이터가 아직 없으면 로컬 데이터를 한 번 올립니다.
    const initial = await getDoc(ref);
    if(!initial.exists() && mode==="teacher"){
      let local = {};
      try{ local = JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(e){}
      await window.NanchoCloud.saveState(local);
    }else if(initial.exists() && mode==="teacher"){
      let local = {};
      try{ local = JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(e){}
      const remote = initial.data().state || {};
      let changed = false;

      for(const key of ["warnings","logs","roleReviews"]){
        if(hasTeacherData(local?.[key]) && !hasTeacherData(remote?.[key])){
          remote[key] = local[key];
          changed = true;
        }
      }
      if(changed){
        await setDoc(ref,{state:remote,updatedAt:serverTimestamp()},{merge:true});
      }
    }

    onSnapshot(ref,(snap)=>{
      status("Firebase 연결됨 · 실시간 동기화", true);
      if(!snap.exists()) return;
      const remote = snap.data().state || {};
      let local = {};
      try{ local = JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(e){}
      const merged = mergeCloud(local, remote);
      localStorage.setItem(KEY, JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent("nancho-cloud-update",{detail:{state:merged}}));
    },(err)=>{
      console.error(err);
      status("Firebase 연결 오류", false);
    });

    status("Firebase 연결됨 · 실시간 동기화", true);
    window.dispatchEvent(new Event("nancho-cloud-ready"));
  }catch(err){
    console.error(err);
    status("Firebase 연결 실패", false);
    window.NanchoCloud = { enabled:false, error:err };
  }
}
