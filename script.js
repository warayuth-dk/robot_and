// ================= CONFIG & DATA =================
const CONFIG_SHEET_URL = 'https://script.google.com/macros/s/AKfycbzkaX_ETSZP6iu4mBgg6M9LLlP6jaG98l9gNTvtVkzvd8d2gtnvp_XioH5sMQbLJTio0A/exec'; 

const LEVELS = [
  { lv: 0, name: "ใส", color: "#ffffff" },          // เน้นจูนตัวนี้เป็นพิเศษ
  { lv: 1, name: "เหลืองจาง", color: "#FEEFC6" },   
  { lv: 2, name: "เหลือง", color: "#FDD771" },       
  { lv: 3, name: "ส้ม/ขาดน้ำ", color: "#FFB300" },   
  { lv: 4, name: "น้ำตาล/อันตราย", color: "#795548" } 
];

let state = "IDLE", currentLV = 0, cameraStream = null;
let currentNumber = "", currentName = "", currentBuble = "", isFlashOn = false;
let historyData = JSON.parse(localStorage.getItem('urine_history_v2') || '[]');

const video = document.getElementById("video");
const canvasElement = document.getElementById("canvas");
const canvas = canvasElement.getContext("2d", { willReadFrequently: true });

// ================= INIT =================
document.addEventListener('DOMContentLoaded', () => {
    renderHistory();
    startClock();
    autoStartCamera();
    document.getElementById('currentDate').textContent = new Date().toLocaleDateString('th-TH');
});

async function autoStartCamera() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (devices.some(d => d.kind === 'videoinput')) initCamera();
    } catch (e) { console.log("Camera access denied"); }
}

async function initCamera() {
    try {
        // 1. ขออนุญาตใช้งานกล้องก่อน (เพื่อให้ได้สิทธิ์เข้าถึง Label ของกล้อง)
        const initialStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        initialStream.getTracks().forEach(track => track.stop()); // ปิดตัวที่ขอสิทธิ์ไปก่อน

        // 2. ค้นหารายการกล้องทั้งหมดในเครื่อง
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');

        let selectedDeviceId = null;

        // 3. กรองหากล้องหลัง (Back/Rear)
        const backCameras = videoDevices.filter(d => 
            d.label.toLowerCase().includes('back') || 
            d.label.toLowerCase().includes('rear')
        );

        if (backCameras.length > 0) {
            // พยายามหาตัวที่ไม่ใช่เลนส์ "ultra" หรือ "wide-angle" (ซึ่งมักจะเป็น 0.5x)
            // โดยปกติกล้องหลักจะมีคำว่า "camera 0" หรือไม่มีคำว่า "ultra" อยู่เลย
            const mainCamera = backCameras.find(c => 
                !c.label.toLowerCase().includes('ultra') && 
                !c.label.toLowerCase().includes('wide-angle')
            );

            // ถ้าเจอตัวที่ดูเหมือนเป็นกล้องหลักให้เลือกตัวนั้น ถ้าไม่เจอให้ใช้ตัวแรกของกล้องหลัง
            selectedDeviceId = mainCamera ? mainCamera.deviceId : backCameras[0].deviceId;
        }

        // 4. ตั้งค่า Constraints ใหม่โดยระบุ deviceId
        const constraints = { 
            video: { 
                deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
                facingMode: selectedDeviceId ? undefined : "environment", // fallback
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        };
        
        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = cameraStream;
        
        video.setAttribute("playsinline", true); 
        await video.play();
        
        // เปิดโหมด Auto Focus สำหรับ Android
        const track = cameraStream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();
        if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
            await track.applyConstraints({
                advanced: [{ focusMode: 'continuous' }]
            });
        }

        document.getElementById("instructionOverlay").style.display = "none";
        state = "SCAN_QR";
        document.body.setAttribute('data-state', 'SCAN_QR');
        requestAnimationFrame(loop);
    } catch(e) { 
        alert("กล้องมีปัญหา: " + e.message); 
    }
}

// ================= CORE LOGIC =================
let lastScanTime = 0;

function loop(time) {
    if (state === "COMPLETED") return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // สำคัญมาก: ปรับขนาด Canvas ให้เท่ากับขนาดวิดีโอที่ส่งมาจากกล้องจริงๆ
        if (canvasElement.width !== video.videoWidth) {
            canvasElement.width = video.videoWidth;
            canvasElement.height = video.videoHeight;
        }

        // วาดภาพจากกล้อง
        canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
        
        if (state === "SCAN_QR") {
            // สแกนทุก 200ms (ไม่ช้าไม่เร็วเกินไป)
            if (time - lastScanTime > 200) { 
                lastScanTime = time;

                // ดึงข้อมูลภาพทั้งเฟรม
                const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
                
                // ใช้ Library jsQR สแกน
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "dontInvert", // เปลี่ยนเป็น "attemptBoth" ถ้าใช้ในที่มืดแล้วไม่ติด
                });

                if (code) {
                    // ถ้าเจอ QR ให้สั่นและจัดการข้อมูล
                    if ("vibrate" in navigator) navigator.vibrate(100);
                    handleQRCode(code.data);
                }
            }
        } else if (state === "SNAP_BOTTLE") {
            analyzeColor();
        }
    }
    requestAnimationFrame(loop);
}
function handleQRCode(data) {
    try {
        const url = new URL(data);
        currentNumber = url.searchParams.get('Number') || "-";
        currentName = url.searchParams.get('name') || "Unknown";
        currentBuble = url.searchParams.get('Buble') || "-";
        document.getElementById("displayUserName").innerText = `ทหาร: ${currentName} (${currentNumber})`;
        document.getElementById("targetNameDisplay").innerText = currentName;
        state = "SNAP_BOTTLE";
        document.body.setAttribute('data-state', 'SNAP_BOTTLE'); // เพิ่มบรรทัดนี้
        document.getElementById("qrGuide").style.display = "none"; // ปิดกรอบ QR
        document.getElementById("btnSnap").style.display = "flex";
        document.getElementById("bottleGuide").classList.add("show");
        document.getElementById("liveStatusBadge").classList.add("show");
        document.getElementById("stepTag").textContent = "STEP 2: SNAP BOTTLE";
    } catch (e) { console.log("QR Format Error"); }
}

// ================= CIELAB CONVERSION =================
function rgbToLab(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;

    x /= 95.047; y /= 100.000; z /= 108.883;
    x = (x > 0.008856) ? Math.pow(x, 1/3) : (7.787 * x) + (16 / 116);
    y = (y > 0.008856) ? Math.pow(y, 1/3) : (7.787 * y) + (16 / 116);
    z = (z > 0.008856) ? Math.pow(z, 1/3) : (7.787 * z) + (16 / 116);

    return { l: (116 * y) - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

// ================= ANALYZE COLOR (TUNED FOR LV 0) =================
function analyzeColor() {
    const centerX = canvasElement.width / 2, centerY = canvasElement.height / 2;
    const urineRGB = getAvgRGB(centerX, centerY, 30);
    const lab = rgbToLab(urineRGB[0], urineRGB[1], urineRGB[2]);

    let lv = 1;

    // --- จูนพิเศษสำหรับความใส (LV 0) ---
    // ปรับให้ L (ความสว่าง) ยืดหยุ่นขึ้น และยอมรับค่า b (เหลืองสะท้อน) ได้ถึง 14
    if (lab.l > 75 && lab.b < 25) {
        lv = 0; 
    }
    else if (lab.l < 42) { 
        lv = 4; 
    }
    else if (lab.b > 58 || (lab.b > 45 && lab.l < 60)) {
        lv = 3; 
    }
    else if (lab.b > 28) {
        lv = 2; 
    }
    else {
        lv = 1; 
    }

    currentLV = lv;
    const info = LEVELS[lv];
    
    const liveText = document.getElementById("liveText");
    const liveDot = document.getElementById("liveDot");
    if(liveText) liveText.innerText = `LV.${lv} - ${info.name}`;
    if(liveDot) liveDot.style.backgroundColor = info.color;
    
    const popupBadge = document.getElementById("popupColorBadge");
    if(popupBadge) {
        popupBadge.innerText = `ผลวิเคราะห์: ${info.name} (LV.${lv})`;
        popupBadge.style.backgroundColor = info.color;
        popupBadge.style.color = (lv >= 3) ? "#fff" : "#000";
    }
}

// ================= SNAP & SAVE =================
function takePhoto() {
    document.getElementById("photoSnapshot").src = canvasElement.toDataURL('image/jpeg', 0.8);
    document.getElementById("dataPopup").classList.add("show");
    document.getElementById("btnSnap").style.display = "none";
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    state = "COMPLETED";
    setTimeout(() => document.getElementById("modalBodyTemp").focus(), 400);
}

async function confirmSave() {
    const temp = document.getElementById('modalBodyTemp').value;
    if(!temp || temp < 35 || temp > 42) return alert("กรอกอุณหภูมิที่ถูกต้อง (35.0 - 42.0)");
    
    const record = { 
        date: new Date().toLocaleDateString('th-TH'), 
        Number: currentNumber, 
        name: currentName, 
        buble: currentBuble, 
        temp: temp, 
        level: currentLV, 
        status: LEVELS[currentLV].name, 
        time: new Date().toLocaleTimeString('th-TH') 
    };

    try {
        await fetch(CONFIG_SHEET_URL, { method: "POST", mode: "no-cors", body: JSON.stringify(record) });
        historyData.unshift(record);
        localStorage.setItem('urine_history_v2', JSON.stringify(historyData.slice(0, 10)));
        renderHistory();
        alert("บันทึกสำเร็จ");
        resetApp();
    } catch { alert("บันทึกล้มเหลว"); }
}

// ================= UTILS =================
function getAvgRGB(x, y, size) {
    const data = canvas.getImageData(x - size/2, y - size/2, size, size).data;
    let r=0, g=0, b=0;
    for (let i=0; i<data.length; i+=4) { r+=data[i]; g+=data[i+1]; b+=data[i+2]; }
    const pixels = data.length / 4;
    return [r/pixels, g/pixels, b/pixels];
}

function renderHistory() {
  const body = document.getElementById("historyBody");
  if (!body) return;
  body.innerHTML = historyData.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${r.time}</td>
      <td>${r.Number}</td>
      <td>${r.name}</td>
      <td>${r.temp}°</td>
      <td style="font-weight:bold; color:${LEVELS[r.level].lv >= 3 ? '#e67e22' : '#2ecc71'}">LV.${r.level}</td>
    </tr>
  `).join('');
}

function resetApp() { location.reload(); }

async function toggleFlash() {
    if (!cameraStream) return;
    const track = cameraStream.getVideoTracks()[0];
    isFlashOn = !isFlashOn;
    await track.applyConstraints({ advanced: [{ torch: isFlashOn }] });
}

function startClock() {
    setInterval(() => { 
        const el = document.getElementById('clock');
        if(el) el.textContent = new Date().toLocaleTimeString('th-TH'); 
    }, 1000);
}