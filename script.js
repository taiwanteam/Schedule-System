// =======================================================
// 1. 引入 Firebase SDK 模組
// =======================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, runTransaction, doc, query, where, updateDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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

// 🎴 【新加入】客製化卡片式呈現邏輯
            eventContent: function(arg) {
            const props = arg.event.extendedProps;
            const bgColor = arg.event.backgroundColor;
            
            // ⏰ 格式化時間 (只取 時:分)
            const startStr = props.startTime ? props.startTime.split('T')[1].substring(0, 5) : '';
            const endStr = props.endTime ? props.endTime.split('T')[1].substring(0, 5) : '';
            const timeRange = (startStr && endStr) ? `${startStr}-${endStr}` : '';

            // 🛠️ 動態建構極簡 HTML 直式卡片
            const cardDom = document.createElement('div');
            cardDom.className = 'fc-custom-card';
            cardDom.style.backgroundColor = bgColor; // 套用長官專屬顏色
            
            cardDom.innerHTML = `
                <div class="fc-card-leader-row">
                    <span class="fc-card-badge">${props.leader}</span>
                </div>
                <div class="fc-card-time-row">⏰ ${timeRange}</div>
                <div class="fc-card-room-row">📍 ${props.room}</div>
            `;
            
            return { domNodes: [cardDom] };
        },
        
        // 點擊行程卡片：彈出客製化修改/刪除視窗並做所有權限判斷
        eventClick: function(info) {
            const props = info.event.extendedProps;
            const isOwner = (props.userEmail === currentUserEmail);
            
            // 將點擊的行程舊資料塞入 Modal 表單欄位中
            document.getElementById('editDocId').value = info.event.id;
            document.getElementById('editLeader').value = props.leader;
            document.getElementById('editTitle').value = props.originTitle;
            document.getElementById('editRoom').value = props.room;
            document.getElementById('editDept').value = props.dept;
            document.getElementById('editUserName').value = props.userName;
            document.getElementById('editStart').value = props.startTime;
            document.getElementById('editEnd').value = props.endTime;

            const fields = ['editLeader', 'editTitle', 'editRoom', 'editDept', 'editUserName', 'editStart', 'editEnd'];
            
            if (isOwner) {
                // 🟢 建立者本人：解鎖欄位、顯示功能按鈕
                fields.forEach(id => document.getElementById(id).disabled = false);
                document.getElementById('saveBtn').style.display = 'inline-block';
                document.getElementById('deleteBtn').style.display = 'inline-block';
                document.getElementById('ownerNotice').innerText = "✨ 您是此行程的建立者，可進行修改或刪除。";
                document.getElementById('ownerNotice').style.color = "#2f855a";
            } else {
                // 🔴 非建立者：欄位全鎖定（唯讀）、隱藏儲存與刪除按鈕
                fields.forEach(id => document.getElementById(id).disabled = true);
                document.getElementById('saveBtn').style.display = 'none';
                document.getElementById('deleteBtn').style.display = 'none';
                document.getElementById('ownerNotice').innerText = `🔒 唯讀模式：此行程由 ${props.userEmail || '其他管理員'} 建立。`;
                document.getElementById('ownerNotice').style.color = "#c53030";
            }

            // 移除隱藏類別，秀出視窗
            document.getElementById('eventModal').classList.remove('auth-hidden');
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
            document.getElementById('printBtn').style.display = 'inline-block'; // ✨ 補上這一行：登入後顯示列印按鈕
            document.getElementById('cleanupBtn').style.display = 'inline-block';
            
            // 🔓 登入後：移除隱藏類別，秀出所有功能
            calendarSection.classList.remove('auth-hidden');
            filterSection.classList.remove('auth-hidden');
            formSection.classList.remove('auth-hidden'); 
            
            loadData(); 
            setTimeout(() => { calendar.updateSize(); }, 100);
            
        } else {
            currentUserEmail = "";
            document.getElementById('userInfo').style.display = 'none';
            document.getElementById('loginBtn').style.display = 'inline-block';
            document.getElementById('printBtn').style.display = 'inline-block'; // ✨ 補上這一行：登入後顯示列印按鈕
            document.getElementById('cleanupBtn').style.display = 'none';
            
            // 🔒 未登入時：加回隱藏類別
            calendarSection.classList.add('auth-hidden');
            filterSection.classList.add('auth-hidden');
            formSection.classList.add('auth-hidden');
            document.getElementById('eventModal').classList.add('auth-hidden'); // 登出時一併隱藏可能開著的彈窗
            
            if(calendar) calendar.removeAllEvents();
        }
    });

    // =======================================================
    // 6. 現代事件監聽器綁定
    // =======================================================
    
    // A. 綁定「Google 登入」按鈕（強制關分頁自動登出）
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            try {
                loginBtn.disabled = true; // 鎖定按鈕
                
                // 🔐 強制設定狀態為 SESSION
                await setPersistence(auth, browserSessionPersistence);
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
     //綁定「列印目前行程」按鈕
    const printBtn = document.getElementById('printBtn');
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            window.print(); // 觸發瀏覽器原生的列印/另存 PDF 功能
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

    // E. 【新綁定】彈出詳情視窗內部的控制功能
    const eventModal = document.getElementById('eventModal');
    if (eventModal) {
        // 點擊「X」關閉視窗
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            eventModal.classList.add('auth-hidden');
        });
        // 點擊視窗外部半透明黑底關閉視窗
        eventModal.addEventListener('click', (e) => {
            if (e.target === eventModal) eventModal.classList.add('auth-hidden');
        });
    }
    // 綁定儲存與刪除功能
    document.getElementById('saveBtn').addEventListener('click', updateMeeting);
    document.getElementById('deleteBtn').addEventListener('click', deleteMeeting);
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
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.leader === leaderName) btn.classList.add('active');
    });

    loadData(); 
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

            if (currentFilterLeader !== "全部" && m.leader !== currentFilterLeader) {
                return;
            }

            const eventColor = leaderColors[m.leader] || leaderColors["預設"];

            events.push({
                id: d.id,
                // title: `👑 [${m.leader}] ${m.title}\n📍 地點：${m.room}\n🏢 科室：${m.dept} (${m.userName.split(' ')[0]})`,
                title: m.title,
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
                    endTime: m.endTime,
                    userEmail: m.userEmail // ✨ 這裡有確實傳遞 userEmail，Modal 才能判斷所有權
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
// 🛡️ 新增行程：長官專屬「防撞期交易機制」
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
        const scheduleCollRef = collection(db, "schedule");
        const leaderQuery = query(scheduleCollRef, where("leader", "==", leader));
        const snapshot = await getDocs(leaderQuery);

        let hasConflict = false;

        snapshot.forEach((docSnap) => {
            const existingMeeting = docSnap.data();
            const existS = new Date(existingMeeting.startTime);
            const existE = new Date(existingMeeting.endTime);

            if (newStart < existE && newEnd > existS) {
                hasConflict = true;
            }
        });

        if (hasConflict) {
            throw new Error("CONFLICT_DETECTED");
        }

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
        
        document.getElementById('title').value = "";
        document.getElementById('room').value = "";
        document.getElementById('dept').value = "";
        document.getElementById('userName').value = "";
        document.getElementById('startTime').value = "";
        document.getElementById('endTime').value = "";
        
        loadData(); 
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
// ✏️ 執行修改行程邏輯
// =======================================================
async function updateMeeting() {
    const docId = document.getElementById('editDocId').value;
    const leader = document.getElementById('editLeader').value;
    const title = document.getElementById('editTitle').value.trim();
    const room = document.getElementById('editRoom').value.trim();
    const dept = document.getElementById('editDept').value.trim();
    const userName = document.getElementById('editUserName').value.trim();
    const start = document.getElementById('editStart').value;
    const end = document.getElementById('editEnd').value;

    if (!title || !room || !dept || !userName || !start || !end) {
        alert("❌ 欄位不能留空！");
        return;
    }
    if (new Date(start) >= new Date(end)) {
        alert("❌ 結束時間必須晚於開始時間！");
        return;
    }

    if (!confirm("確定要儲存本次的行程修改嗎？")) return;

    try {
        const docRef = doc(db, "schedule", docId);
        await updateDoc(docRef, {
            leader: leader,
            title: title,
            room: room,
            dept: dept,
            userName: userName,
            startTime: start,
            endTime: end,
            updatedAt: new Date().toISOString()
        });

        alert("🎉 行程修改成功！");
        document.getElementById('eventModal').classList.add('auth-hidden');
        loadData(); 
    } catch (error) {
        alert("❌ 修改失敗：您可能沒有此權限（或網絡異常）。");
        console.error(error);
    }
}

// =======================================================
// 🗑️ 執行刪除行程邏輯
// =======================================================
async function deleteMeeting() {
    const docId = document.getElementById('editDocId').value;
    
    if (!confirm("⚠️ 警告：確定要永久刪除此筆行程嗎？刪除後將無法復原。")) return;

    try {
        const docRef = doc(db, "schedule", docId);
        await deleteDoc(docRef);

        alert("🗑️ 行程已成功刪除！");
        document.getElementById('eventModal').classList.add('auth-hidden');
        loadData(); 
    } catch (error) {
        alert("❌ 刪除失敗：您可能沒有此權限。");
        console.error(error);
    }
}

// =======================================================
// 🧹 自動清理舊資料（一鍵刪除一個月前的所有過期行程）
// =======================================================
async function autoCleanup() {
    if (!confirm("⚠️ 確定要自動清理【一個月以前】的所有舊行程嗎？\n此操作將跨越權限限制，強制刪除所有人的過期資料且無法復原！")) return;

    const cleanupBtn = document.getElementById('cleanupBtn');
    cleanupBtn.disabled = true;
    cleanupBtn.innerText = "舊資料清理中...";

    try {
        // 📅 計算 30 天前的時間切點
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const isoThreshold = thirtyDaysAgo.toISOString();

        // 🔍 獲取所有行程
        const scheduleCollRef = collection(db, "schedule");
        const snapshot = await getDocs(scheduleCollRef);
        
        // 📦 初始化批次操作 (Batch)
        const batch = writeBatch(db);
        let count = 0;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            
            // 比對建立時間 (createdAt)，早於 30 天前者塞進刪除清單
            if (data.createdAt && data.createdAt < isoThreshold) {
                batch.delete(docSnap.ref);
                count++;
            }
        });

        if (count === 0) {
            alert("✨ 檢查完畢！目前資料庫中沒有一個月前的舊資料，無需清理。");
        } else {
            // 🚀 送出批次提交
            await batch.commit();
            alert(`🧹 清理成功！已自動刪除 ${count} 筆一個月前的歷程行程。`);
            loadData(); 
        }

    } catch (error) {
        alert("❌ 清理失敗：請確認網路連線或安全規則設定。");
        console.error("自動清理失敗詳情：", error);
    } finally {
        cleanupBtn.disabled = false;
        cleanupBtn.innerText = "🧹 清理一個月前舊資料";
    }
}
