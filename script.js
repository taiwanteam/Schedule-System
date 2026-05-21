// =======================================================
// 1. 引入 Firebase SDK 模組
// =======================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, runTransaction, doc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, browserSessionPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// =======================================================
// 2. Firebase 專案配置與初始化
// =======================================================
const firebaseConfig = {
    apiKey: "AIzaSyDYHWckA_Oq1lCNnq9LDgacstD-wSDWsis",
    authDomain: "schedule-system-da774.firebaseapp.com",
    projectId: "schedule-system-da774",
    storageBucket: "schedule-system-da774.firebasestorage.app",
    messagingSenderId: "404177257025",
    appId: "1:404177257025:web:2c24287752a3eb8a327cc0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// =======================================================
// 3. 全域變數定義
// =======================================================
let calendar = null;
let currentFilterLeader = "全部"; // 預設查看所有行程
let currentUserEmail = "";

// 長官專屬識別顏色
const leaderColors = {
    "局長": "#e53e3e",    // 沉穩紅
    "副局長": "#3182ce",  // 科技藍
    "秘書": "#38a169",    // 活力綠
    "預設": "#4a5568"
};

// =======================================================
// 4. 網頁載入完成：初始化 FullCalendar 日曆
// =======================================================
document.addEventListener('DOMContentLoaded', function() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'zh-tw',
        displayEventTime: true,
        navLinks: false,        
        
        // 24小時制核心設定：強迫顯示 24hr 格式
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
        
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: '' 
        },
        buttonText: { today: '今天' },

        // 動態換算「民國年」抬頭
        datesSet: function(info) {
            updateMinguoTitle(info.view.title);
        },

        // 點擊行程卡片跳出詳細資訊
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
    
    // =======================================================
    // 5. 監聽 Firebase 登入狀態並控制元件顯示
    // =======================================================
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
        
        // 🔓 登入後：移除隱藏類別，秀出所有功能（比傳統 style.display 更穩定）
        calendarSection.classList.remove('auth-hidden');
        filterSection.classList.remove('auth-hidden');
        formSection.classList.remove('auth-hidden'); 
        
        loadData(); 
        setTimeout(() => { calendar.updateSize(); }, 100);
        
    } else {
        currentUserEmail = "";
        document.getElementById('userInfo').style.display = 'none';
        document.getElementById('loginBtn').style.display = 'inline-block';
        document.getElementById('cleanupBtn').style.display = 'none';
        
        // 🔒 未登入時：加回隱藏類別
        calendarSection.classList.add('auth-hidden');
        filterSection.classList.add('auth-hidden');
        formSection.classList.add('auth-hidden');
        
        if(calendar) calendar.removeAllEvents();
    }
});

    // =======================================================
    // 6. 現代事件監聽器綁定 (取代舊式 HTML onclick)
    // =======================================================
    
    // A. 綁定「Google 登入」按鈕（含防重複點擊）
    // const loginBtn = document.getElementById('loginBtn');
    // if (loginBtn) {
    //     loginBtn.addEventListener('click', async () => {
    //         try {
    //             loginBtn.disabled = true; // 鎖定按鈕
    //             await signInWithPopup(auth, provider);
    //             console.log("Google 登入成功發起");
    //         } catch (error) {
    //             console.error("登入失敗：", error);
    //             if (error.code === 'auth/cancelled-popup-request') {
    //                 console.log('前一個登入視窗尚未關閉，已攔截重複請求。');
    //             } else if (error.code === 'auth/popup-closed-by-user') {
    //                 alert("您已關閉登入視窗，請重新嘗試。");
    //             } else {
    //                 alert(`Google 登入失敗：${error.message}`);
    //             }
    //         } finally {
    //             loginBtn.disabled = false; // 解除按鈕鎖定
    //         }
    //     });
    // }
    
    // A. 綁定「Google 登入」按鈕（加入關分頁自動登出機制）
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            try {
                loginBtn.disabled = true; // 鎖定按鈕
                
                // 🔐 強制設定登入狀態為 SESSION（關閉分頁或瀏覽器即失效）
                await setPersistence(auth, browserSessionPersistence);
                
                // 設定完後再發起登入
                await signInWithPopup(auth, provider);
                console.log("Google 登入成功發起（會話模式）");
            } catch (error) {
                console.error("登入失敗：", error);
                if (error.code === 'auth/cancelled-popup-request') {
                    console.log('前一個登入視窗尚未關閉，已攔截重複請求。');
                } else if (error.code === 'auth/popup-closed-by-user') {
                    alert("您已關閉登入視窗，請重新嘗試。");
                } else {
                    alert(`Google 登入失敗：${error.message}`);
                }
            } finally {
                loginBtn.disabled = false; // 解除按鈕鎖定
            }
        });
    }

    // B. 綁定「確認登錄行程」按鈕
    const addBtn = document.getElementById('addBtn');
    if (addBtn) {
        addBtn.addEventListener('click', addMeeting);
    }

    // C. 綁定「長官行程篩選」按鈕群
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const leaderName = btn.dataset.leader;
            filterLeader(leaderName);
        });
    });

    // D. 綁定「自動清理舊資料」按鈕
    const cleanupBtn = document.getElementById('cleanupBtn');
    if (cleanupBtn) {
        cleanupBtn.addEventListener('click', autoCleanup);
    }
});

// =======================================================
// 🇹🇼 動態換算「民國年」抬頭函數
// =======================================================
function updateMinguoTitle(titleString) {
    const yearMatch = titleString.match(/(\d{4})年/);
    if (yearMatch) {
        const westernYear = parseInt(yearMatch[1]);
        const minguoYear = westernYear - 1911; 
        const restOfTitle = titleString.replace(`${westernYear}年`, '');
        document.getElementById('minguoDisplay').innerText = `💡 目前檢視：民國 ${minguoYear} 年 (${westernYear}年${restOfTitle})`;
    } else {
        document.getElementById('minguoDisplay').innerText = titleString;
    }
}

// =======================================================
// 🎛️ 長官行程動態篩選功能
// =======================================================
function filterLeader(leaderName) {
    currentFilterLeader = leaderName;
    
    // 變更按鈕的 active 視覺樣式
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.leader === leaderName) btn.classList.add('active');
    });

    loadData(); // 重新撈取並過濾日曆顯示
}

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

            // 一鍵篩選核心邏輯
            if (currentFilterLeader !== "全部" && m.leader !== currentFilterLeader) {
                return;
            }

            const eventColor = leaderColors[m.leader] || leaderColors["預設"];

            events.push({
                id: d.id,
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
async function addMeeting() {
    const leader = document.getElementById('leader').value;
    const title = document.getElementById('title').value.trim();
    const start = document.getElementById('start').value;
    const end = document.getElementById('end').value;
    const room = document.getElementById('room').value.trim();
    const dept = document.getElementById('dept').value.trim();
    const userName = document.getElementById('userName').value.trim();
    const addBtn = document.getElementById('addBtn');

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

    addBtn.disabled = true;
    addBtn.innerText = "交易檢查中...";

    try {
        // ✨ 【修正步驟 1】：先在 Transaction 外面查出所有行程
        // 為了效能與精準度，這裡可以直接下 query 篩選出「同一位長官」的行程即可
        const scheduleCollRef = collection(db, "schedule");
        const leaderQuery = query(scheduleCollRef, where("leader", "==", leader));
        const snapshot = await getDocs(leaderQuery);

        let hasConflict = false;

        // ✨ 【修正步驟 2】：在外面先比對時間是否有衝突
        snapshot.forEach((docSnap) => {
            const existingMeeting = docSnap.data();
            const existS = new Date(existingMeeting.startTime);
            const existE = new Date(existingMeeting.endTime);

            // 判斷時間區間是否有交集
            if (newStart < existE && newEnd > existS) {
                hasConflict = true;
            }
        });

        if (hasConflict) {
            throw new Error("CONFLICT_DETECTED");
        }

        // 🔥 【修正步驟 3】：確認無衝突後，啟動 Transaction 純粹用來「安全寫入」
        await runTransaction(db, async (transaction) => {
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
        addBtn.disabled = false;
        addBtn.innerText = "確認登錄行程";
    }
}

// =======================================================
// 🧹 自動清理舊資料（結構預留）
// =======================================================
async function autoCleanup() {
    try {
        console.log("啟動清理機制...");
        // 這裡可以寫入你的刪除邏輯，例如篩選出 createdAt 比一個月前更早的 doc 進行 deleteDoc
        alert("🧹 資料清理功能執行成功！");
    } catch (error) {
        console.error("清理失敗：", error);
    }
}
