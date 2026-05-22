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

        // 🎴 客製化卡片式呈現邏輯
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
    // 5. 監聽 Firebase 登入狀態並控制元件顯示（順暢不卡死防線）
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
            document.getElementById('printBtn').style.display = 'inline-block'; 

            // 🔓 登入後：移除隱藏類別，秀出所有功能
            if (calendarSection) calendarSection.classList.remove('auth-hidden');
            if (filterSection) filterSection.classList.remove('auth-hidden');
            if (formSection) formSection.classList.remove('auth-hidden'); 

            // 💡 完全不建表、不寫死 true/false 變數！登入後前端一律先大方秀出清理按鈕
            const cleanupBtn = document.getElementById('cleanupBtn');
            if (cleanupBtn) cleanupBtn.style.display = 'inline-block';

            // 載入資料與更新日曆尺寸
            loadData(); 
            setTimeout(() => { if (calendar) calendar.updateSize(); }, 100);
            
        } else {
            // 🔒 登出狀態：重設權限與隱藏所有元件
            currentUserEmail = "";
            
            document.getElementById('userInfo').style.display = 'none';
            document.getElementById('loginBtn').style.display = 'inline-block';
            document.getElementById('printBtn').style.display = 'none'; 
            document.getElementById('cleanupBtn').style.display = 'none';
            
            if (calendarSection) calendarSection.classList.add('auth-hidden');
            if (filterSection) filterSection.classList.add('auth-hidden');
            if (formSection) formSection.classList.add('auth-hidden');
            
            const eventModal = document.getElementById('eventModal');
            if (eventModal) eventModal.classList.add('auth-hidden'); 
            
            if (calendar) calendar.removeAllEvents();
        }
    });

    // =======================================================
    // 6. 現代事件監聽器綁定
    // =======================================================
    
    // A. 綁定「Google 登入」按鈕
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            try {
                loginBtn.disabled = true; 
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
                loginBtn.disabled = false; 
            }
        });
    }

    // 綁定「列印目前行程」按鈕
    const printBtn = document.getElementById('printBtn');
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            window.print(); 
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

    // E. 彈出詳情視窗內部的控制功能
    const eventModal = document.getElementById('eventModal');
    if (eventModal) {
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            eventModal.classList.add('auth-hidden');
        });
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
                    userEmail: m.userEmail 
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
        
        // ✨ 已將欄位清空的 ID 修正為正確的 'start' 與 'end'
        document.getElementById('title').value = "";
        document.getElementById('room').value = "";
        document.getElementById('dept').value = "";
        document.getElementById('userName').value = "";
        document.getElementById('start').value = "";
        document.getElementById('end').value = "";
        
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
// =======================================================
// 🧹 自動清理舊資料（一鍵刪除一個月前的所有過期行程）
// =======================================================
async function autoCleanup() {
    // 📢 點擊時的前置警示提示
    alert("⚠️ 系統提示：全系統清理作業將跨越權限限制。\n非最高管理員（或未配置後端安全性規則者），後端將會直接拒絕此刪除請求。");

    // 💡 為了測試，提示訊息微調
    if (!confirm("⚠️ 確定要自動清理【行事曆上一個月以前】的所有舊行程嗎？\n（此版本將以行程本身的『開始時間』作為過期依據！）")) return;

    const cleanupBtn = document.getElementById('cleanupBtn');
    cleanupBtn.disabled = true;
    cleanupBtn.innerText = "舊資料清理中...";

    try {
        // 📅 計算 30 天前的時間切點
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // 🛠️ 測試小技巧：如果您想連今天建的這筆 4/1 行程一起清掉，可以把上面兩行註解，改用下面這行：
        // const thirtyDaysAgo = new Date(); // 這代表「只要行程在今天以前」全部都清掉！

        // 🔍 步驟 1：獲取所有行程
        const scheduleCollRef = collection(db, "schedule");
        let snapshot;
        
        try {
            snapshot = await getDocs(scheduleCollRef);
        } catch (readError) {
            if (readError.code === 'permission-denied') {
                throw new Error("READ_PERMISSION_DENIED");
            }
            throw readError;
        }
        
        // 📦 步驟 2：初始化批次操作 (Batch)
        const batch = writeBatch(db);
        let count = 0;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            
            // 💡 「行程哪一天發生(startTime)」！
            if (data.startTime) {
                const meetingStartDate = new Date(data.startTime); 
                
                // 如果行程的發生時間，早於我們設定的切點（30天前），就打包刪除
                if (meetingStartDate < thirtyDaysAgo) {
                    batch.delete(docSnap.ref);
                    count++;
                }
            }
        });

        // 💡 最佳化防呆：如果算出來根本沒舊資料
        if (count === 0) {
            alert("✨ 檢查完畢！目前行事曆中沒有一個月前的舊行程，無需清理。");
            return; 
        }

        // 🚀 步驟 3：送出批次提交
        try {
            await batch.commit();
            alert(`🧹 清理成功！已自動刪除 ${count} 筆一個月前的歷程行程。`);
            loadData(); 
        } catch (writeError) {
            if (writeError.code === 'permission-denied') {
                throw new Error("WRITE_PERMISSION_DENIED");
            }
            throw writeError;
        }

    } catch (error) {
        if (error.message === "READ_PERMISSION_DENIED") {
            alert("🔒 安全性拒絕 (Read)：您的帳號無權讀取全系統原始資料，拒絕清理請求。");
        } else if (error.message === "WRITE_PERMISSION_DENIED") {
            alert("🔒 安全性拒絕 (Write)：後端安全規則驗證失敗！您的 Google 帳號並非最高管理員，無權刪除他人資料。");
        } else if (error.code === 'permission-denied') {
            alert("🔒 系統安全性拒絕：後端驗證失敗，已拒絕您的全系統清理請求！");
        } else {
            alert("❌ 清理失敗：請確認網路連線或安全規則設定。");
        }
        console.error("自動清理失敗詳情：", error);
    } finally {
        cleanupBtn.disabled = false;
        cleanupBtn.innerText = "🧹 清理一個月前舊資料";
    }
}
