// 1. 引入 Firebase SDK 模組
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, runTransaction, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ⚠️ 請在此處替換成您自己專案的 Firebase 帳密設定 ⚠️
const firebaseConfig = {
    apiKey: "AIzaSyDYHWckA_Oq1lCNnq9LDgacstD-wSDWsis",
    authDomain: "schedule-system-da774.firebaseapp.com",
    projectId: "schedule-system-da774",
    storageBucket: "schedule-system-da774.firebasestorage.app",
    messagingSenderId: "404177257025",
    appId: "1:404177257025:web:2c24287752a3eb8a327cc0"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// 全域變數
let calendar = null;
let currentFilterLeader = "全部"; // 預設查看所有行程
let currentUserEmail = "";

// 定義三位長官的專屬識別顏色
const leaderColors = {
    "局長": "#e53e3e",    // 沉穩紅
    "副局長": "#3182ce",  // 科技藍
    "秘書": "#38a169",    // 活力綠
    "預設": "#4a5568"
};

// =======================================================
// 📅 網頁載入完成：初始化 FullCalendar 日曆
// =======================================================
document.addEventListener('DOMContentLoaded', function() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'zh-tw',
        displayEventTime: true, // 💡 顯示事件時間
        navLinks: false,        // 💡 關閉點擊日期超連結，防止在無切換按鈕時迷路卡在日檢視
        
        // 🔒 24小時制核心設定：移除所有上下午字眼，強迫顯示 24hr 格式
        eventTimeFormat: { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: false 
        },
        slotLabelFormat: { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: false 
        },
        
        // 標頭欄位配置 (配合右側隱藏，左側並排優化)
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: '' // 右側月週日切換按鈕隱藏
        },
        buttonText: { today: '今天' },

        // 💡 每當日曆切換月份或日期範圍時，動態將標題換算為民國年
        datesSet: function(info) {
            updateMinguoTitle(info.view.title);
        },

        // 點擊行程卡片時跳出詳細資訊（或提供秘書刪除功能）
        eventClick: function(info) {
            alert(
                `👑 長官：${info.event.extendedProps.leader}\n` +
                `📋 行程：${info.event.extendedProps.originTitle}\n` +
                `📍 地點：${info.event.extendedProps.room}\n` +
                `🏢 科室：${info.event.extendedProps.dept}\n` +
                `👤 聯絡人：${info.event.extendedProps.userName}\n` +
                `⏰ 時間：${info.event.extendedProps.startTime.replace('T',' ')} ~ ${info.event.extendedProps.endTime.replace('T',' ')}`
            );
        }
    });

    calendar.render();
    
    // 監聽登入狀態並抓取資料
// 監聽登入狀態並控制元件顯示
    onAuthStateChanged(auth, (user) => {
        const formSection = document.querySelector('.form-wrapper');
        const calendarSection = document.querySelector('.calendar-wrapper');
        const filterSection = document.querySelector('.leader-filter-container');

        if (user) {
            currentUserEmail = user.email;
            document.getElementById('userInfo').innerText = `👋 歡迎，${user.displayName || '管理員'}`;
            document.getElementById('userInfo').style.display = 'inline';
            document.getElementById('loginBtn').style.display = 'none';
            document.getElementById('cleanupBtn').style.display = 'inline-block';
            
            // 🔓 登入後，秀出所有功能
            calendarSection.style.display = 'block';
            filterSection.style.display = 'block';
            formSection.style.display = 'block'; 
            
            // 重新讀取雲端資料
            loadData(); 
            // 強制日曆重新計算寬度，防止隱藏後突然顯示導致的排版失準
            setTimeout(() => { calendar.updateSize(); }, 100);
            
        } else {
            currentUserEmail = "";
            document.getElementById('userInfo').style.display = 'none';
            document.getElementById('loginBtn').style.display = 'inline-block';
            document.getElementById('cleanupBtn').style.display = 'none';
            
            // 🔒 未登入時，把日曆、篩選鈕、表單全部隱藏，只留登入按鈕
            calendarSection.style.display = 'none';
            filterSection.style.display = 'none';
            formSection.style.display = 'none';
            
            // 清空舊日曆內容
            if(calendar) calendar.removeAllEvents();
        }
});

// =======================================================
// 🇹🇼 動態換算「民國年」抬頭函數
// =======================================================
function updateMinguoTitle(titleString) {
    // 假設 titleString 格式為 "2026年5月"
    const yearMatch = titleString.match(/(\d{4})年/);
    if (yearMatch) {
        const westernYear = parseInt(yearMatch[1]);
        const minguoYear = westernYear - 1911; // 換算民國年
        const restOfTitle = titleString.replace(`${westernYear}年`, '');
        document.getElementById('minguoDisplay').innerText = `💡 目前檢視：民國 ${minguoYear} 年 (${westernYear}年${restOfTitle})`;
    } else {
        document.getElementById('minguoDisplay').innerText = titleString;
    }
}

// =======================================================
// 🎛️ 長官行程動態篩選按鈕邏輯
// =======================================================
window.filterLeader = function(leaderName) {
    currentFilterLeader = leaderName;
    
    // 變更按鈕的 active 視覺樣式
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.includes(leaderName)) btn.classList.add('active');
    });

    loadData(); // 重新撈取並過濾日曆顯示
};

// =======================================================
// 📥 從 Firebase 讀取資料並渲染至日曆
// =======================================================
async function loadData() {
    if (!calendar) return;
    try {
        const snapshot = await getDocs(collection(db, "schedule"));
        const events = [];

        snapshot.forEach((d) => {
            const m = d.data();

            // 🛠️【一鍵篩選核心】若目前鎖定單一長官，非該長官行程則跳過不顯示
            if (currentFilterLeader !== "全部" && m.leader !== currentFilterLeader) {
                return;
            }

            // 依據長官姓名指派卡片顏色（紅、藍、綠）
            const eventColor = leaderColors[m.leader] || leaderColors["預設"];

            events.push({
                id: d.id,
                // 💡 卡片文字優化：運用 "\n" 進行乾淨的分行呈現，維持 24 小時制無上下午
                title: `👑 [${m.leader}] ${m.title}\n📍 地點：${m.room}\n🏢 科室：${m.dept} (${m.userName.split(' ')[0]})`,
                start: m.startTime,
                end: m.endTime,
                backgroundColor: eventColor,
                borderColor: eventColor,
                extendedProps: {
                    leader: m.leader,
                    originTitle: m.title,
                    room: m.room,
                    dept: m.dept,
                    userName: m.userName,
                    startTime: m.startTime,
                    endTime: m.endTime
                }
            });
        });

        calendar.removeAllEvents();
        calendar.addEventSource(events);
    } catch (e) {
        console.error("讀取日曆資料失敗：", e);
    }
}

// =======================================================
// 🛡️ 新增行程：長官專屬「防撞期 Transaction 交易機制」
// =======================================================
window.addMeeting = async function() {
    const leader = document.getElementById('leader').value;
    const title = document.getElementById('title').value.trim();
    const start = document.getElementById('start').value;
    const end = document.getElementById('end').value;
    const room = document.getElementById('room').value.trim();
    const dept = document.getElementById('dept').value.trim();
    const userName = document.getElementById('userName').value.trim();

    // 基本欄位驗證
    if (!title || !start || !end || !room || !dept || !userName) {
        alert("❌ 填寫不完整！請檢查所有帶有紅色星號 (*) 的欄位是否皆已填寫。");
        return;
    }

    const newStart = new Date(start);
    const newEnd = new Date(end);

    if (newStart >= newEnd) {
        alert("❌ 時間排序錯誤：結束時間必須晚於開始時間！");
        return;
    }

    document.getElementById('addBtn').disabled = true;
    document.getElementById('addBtn').innerText = "交易檢查中...";

    try {
        // 🔥 啟動雲端防撞 Transaction 機制
        await runTransaction(db, async (transaction) => {
            const querySnapshot = await getDocs(collection(db, "schedule"));
            let hasConflict = false;

            querySnapshot.forEach((docSnap) => {
                const existingMeeting = docSnap.data();

                // 🔒 防撞關鍵：只有當「同一位長官」且「時間段相撞」時才引發衝突！
                if (existingMeeting.leader === leader) {
                    const existS = new Date(existingMeeting.startTime);
                    const existE = new Date(existingMeeting.endTime);

                    // 判斷時間區間是否有交集
                    if (newStart < existE && newEnd > existS) {
                        hasConflict = true;
                    }
                }
            });

            if (hasConflict) {
                throw new Error("CONFLICT_DETECTED");
            }

            // 檢查安全無誤，正式寫入雲端
            const newDocRef = doc(collection(db, "schedule"));
            transaction.set(newDocRef, {
                leader: leader,
                title: title,
                startTime: start,
                endTime: end,
                room: room,
                dept: dept,
                userName: userName,
                userEmail: currentUserEmail,
                createdAt: new Date().toISOString()
            });
        });

        alert(`🎉 成功登錄！已將行程排入【${leader}】行事曆。`);
        
        // 清空表單文字框
        document.getElementById('title').value = "";
        document.getElementById('room').value = "";
        document.getElementById('dept').value = "";
        document.getElementById('userName').value = "";
        
        loadData(); // 重新整理畫面
    } catch (error) {
        if (error.message === "CONFLICT_DETECTED") {
            alert(`🚨 登記失敗！【${leader}】在此時間段內已有其他公務行程，請先確認長官行程表！`);
        } else {
            alert("❌ 系統發生錯誤，無法登錄行程，請聯絡系統工程師。");
            console.error(error);
        }
    } finally {
        document.getElementById('addBtn').disabled = false;
        document.getElementById('addBtn').innerText = "確認登錄行程";
    }
};

// =======================================================
// 🔑 Google 帳號登入功能
// =======================================================
window.login = function() {
    signInWithPopup(auth, provider).catch((error) => {
        console.error("登入失敗：", error);
        alert("Google 登入失敗，請確認您的網路連線。");
    });
};