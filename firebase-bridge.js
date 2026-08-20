
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

// 교실 여러 기기와 공유할 데이터만 Firebase에 보냅니다.
// 개인 행동기록(logs), 경고(warnings), 역할 성실도(roleReviews)는
// 교사용 PC localStorage에만 남겨 민감 기록의 공개 범위를 줄입니다.
const PUBLIC_FIELDS = [
  "titleText","seats","roleAssignments","points","birthdays",
  "announcement","lunch","lunchPromise","lifeBookText","praise",
  "classState","events","todos","timetable","timer",
  "studentPinHashes","checkHistory"
];

function pickPublic(state){
  const out = {};
  for(const k of PUBLIC_FIELDS){
    if(state && Object.prototype.hasOwnProperty.call(state,k)) out[k] = state[k];
  }
  return out;
}
function mergePublic(localState, publicState){
  return Object.assign({}, localState || {}, publicState || {});
}
function status(text, ok=false){
  window.dispatchEvent(new CustomEvent("nancho-cloud-status",{detail:{text,ok}}));
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
    let suppressFirst = true;

    window.NanchoCloud = {
      enabled:true,
      db, ref,
      async saveState(state){
        const publicState = pickPublic(state);
        await setDoc(ref,{
          state: publicState,
          updatedAt: serverTimestamp()
        },{merge:true});
      },
      async getState(){
        const snap = await getDoc(ref);
        return snap.exists() ? (snap.data().state || {}) : null;
      }
    };

    const initial = await getDoc(ref);
    if(!initial.exists() && mode==="teacher"){
      let local = {};
      try{ local = JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(e){}
      await window.NanchoCloud.saveState(local);
    }

    onSnapshot(ref,(snap)=>{
      status("Firebase 연결됨 · 실시간 동기화", true);
      if(!snap.exists()) return;
      const remote = snap.data().state || {};
      let local = {};
      try{ local = JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(e){}
      const merged = mergePublic(local, remote);
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
