// ================= CONFIG & DATA =================
const CONFIG_SHEET_URL = ["https://script.google.com/macros/s/AKfycbyBz5dqDwwVrgLCnEcavza0krwszulbGFUaZOtwDttrVb3G5AAHK3-TaIhh05bzDWLwYQ/exec", "https://script.google.com/macros/s/AKfycbx9n8sXo7l3m1j2h5a9eXqj0ZtHkKz6n8u2b4/exec"]; // เปลี่ยน URL ตามต้องการ

const LEVELS = [
  { lv: 0, name: "ใส", color: "#ffffff" },          
  { lv: 1, name: "เหลืองจาง", color: "#FEEFC6" },   
  { lv: 2, name: "เหลือง", color: "#FDD771" },       
  { lv: 3, name: "ส้ม/ขาดน้ำ", color: "#FFB300" },   
  { lv: 4, name: "น้ำตาล/อันตราย", color: "#795548" } 
];

let state = "IDLE", currentLV = 0, cameraStream = null;
let currentNumber = "", currentName = "", currentBuble = "", isFlashOn = false;
let historyData = JSON.parse(localStorage.getItem('urine_history_v2') || '[]');

// 🟢 เพิ่ม: ตัวแปรควบคุมประสิทธิภาพกล้องสำหรับ Android
let lastQRScanTime = 0;
let frameSkipCounter = 0;
const QR_SCAN_THROTTLE = 500; // Scan QR ทุก 500ms เพื่อลด jitter
const ANDROID_FRAME_SKIP = 2; // Android: ประมวลผลทุก 3 เฟรม (30fps/3 = ~10fps สำหรับวิเคราะห์)

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

// 🟢 ฟังก์ชันค้นหา ID กล้องหลัก (1x) - ปรับให้ดีขึ้นสำหรับ Android
async function getMainCameraId() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    
    // ตรวจสอบว่าเป็น Android หรือไม่
    const isAndroid = /Android/i.test(navigator.userAgent);
    
    // กรองเฉพาะกล้องหลัง
    let backCameras = videoDevices.filter(d => {
        const label = d.label.toLowerCase();
        return label.includes('back') || 
               label.includes('rear') ||
               label.includes('camera 0') ||
               label.includes('main') ||
               (isAndroid && label === '') // Android มักมีกล้องหลัก labels ว่าง
    });

    if (backCameras.length === 0) {
        // ถ้าไม่เจอ back camera ให้เอาตัวแรก
        return videoDevices.length > 0 ? videoDevices[0].deviceId : null;
    }

    // ลำดับความสำคัญสำหรับเลือกกล้อง:
    // 1. กล้องที่ชื่อมี "1x" หรือ "Main"
    let mainCamera = backCameras.find(d => {
        const label = d.label.toLowerCase();
        return label.includes('1x') || label.includes('main');
    });
    
    if (mainCamera) return mainCamera.deviceId;

    // 2. หลีกเลี่ยงกล้องที่ชื่อมี 0.5x, Ultra, Wide, Macro, หรือตัวเลขเศษส่วน
    mainCamera = backCameras.find(d => {
        const label = d.label.toLowerCase();
        return !label.includes('0.5') && 
               !label.includes('ultra') &&
               !label.includes('wide') &&
               !label.includes('macro') &&
               !label.includes('0.25') &&
               !label.includes('0.6') &&
               !label.includes('periscope')
    });
    
    if (mainCamera) return mainCamera.deviceId;

    // 3. ถ้าเป็น Android และไม่เจอ, ให้ลองใช้ constraints ตรงกันข้ามแทน
    if (isAndroid && backCameras.length > 0) {
        return backCameras[0].deviceId;
    }

    return backCameras[0] ? backCameras[0].deviceId : null;
}

async function initCamera() {
    try {
        // เคลียร์ Stream เก่า
        if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());

        // ตรวจสอบ OS
        const isAndroid = /Android/i.test(navigator.userAgent);

        // 🟢 เลือกใช้ ID กล้องที่ค้นหาได้
        const mainId = await getMainCameraId();
        
        // ปรับ constraints สำหรับ Android ให้ลด jitter
        const constraints = isAndroid ? {
            video: mainId ? { 
                deviceId: { exact: mainId },
                width: { ideal: 1280 }, 
                height: { ideal: 720 },
                frameRate: { ideal: 24 } // 🟢 จำกัด framerate บน Android เพื่อลด jitter
            } : { 
                facingMode: "environment",
                width: { ideal: 1280 }, 
                height: { ideal: 720 },
                frameRate: { ideal: 24 }
            }
        } : {
            video: mainId ? { 
                deviceId: { exact: mainId },
                width: { ideal: 1280 }, 
                height: { ideal: 720 } 
            } : { 
                facingMode: "environment",
                width: { ideal: 1280 }, 
                height: { ideal: 720 }
            }
        };

        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = cameraStream;
        await video.play();
        
        document.getElementById("instructionOverlay").style.display = "none";
        state = "SCAN_QR";
        document.getElementById("qrGuide").classList.add("show");
        requestAnimationFrame(loop);
    } catch(e) { 
        console.error("Camera error:", e);
        // Fallback: ถ้า Error เพราะระบุ ID เจาะจงเกินไป ให้ลองแบบปกติ
        if (e.name === "OverconstrainedError" || e.name === "NotFoundError") {
            const isAndroid = /Android/i.test(navigator.userAgent);
            const fallbackConstraints = isAndroid ? {
                video: { 
                    facingMode: "environment", 
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 },
                    frameRate: { ideal: 24 }
                } 
            } : {
                video: { 
                    facingMode: "environment", 
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 }
                }
            };
            cameraStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            video.srcObject = cameraStream;
            await video.play();
        } else {
            alert("เปิดกล้องไม่ได้"); 
        }
    }
}

// ================= CORE LOOP =================
function loop() {
    if (state === "COMPLETED") return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // 🟢 Frame Skip สำหรับ Android เพื่อลด jitter
        frameSkipCounter++;
        const isAndroid = /Android/i.test(navigator.userAgent);
        const skipFrames = isAndroid ? ANDROID_FRAME_SKIP : 0;
        
        if (frameSkipCounter % (skipFrames + 1) !== 0) {
            requestAnimationFrame(loop);
            return; // ข้ามเฟรมนี้
        }

        canvasElement.width = video.videoWidth; 
        canvasElement.height = video.videoHeight;
        canvas.drawImage(video, 0, 0);

        if (state === "SCAN_QR") {
            // 🟢 Throttle QR detection - ทำทุก 500ms เพื่อลด jitter
            const now = Date.now();
            if (now - lastQRScanTime >= QR_SCAN_THROTTLE) {
                const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
                const code = jsQR(imageData.data, canvasElement.width, canvasElement.height);
                if (code) handleQRCode(code.data);
                lastQRScanTime = now;
            }
        } 
        else if (state === "SNAP_BOTTLE") {
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
        
        document.getElementById("displayUserName").innerText = `ทหาร: ${currentName} (${currentNumber} - ${currentBuble})`;
        document.getElementById("targetNameDisplay").innerText = currentName;
        
        // 🟢 เพิ่ม: ตั้งเวลาโดยให้ต้องสแกน QR ใหม่หลังจากประมาณ 2 วินาที
        // เพื่อหลีกเลี่ยงการกระตุกจากการตรวจหลายครั้ง
        lastQRScanTime = Date.now() + 2000;
        
        state = "SNAP_BOTTLE";
        document.getElementById("stepTag").textContent = "STEP 2: ถ่ายรูปขวดปัสสาวะ";
        document.getElementById("qrGuide").classList.remove("show");
        document.getElementById("bottleGuide").classList.add("show");
        document.getElementById("liveStatusBadge").classList.add("show");
        document.getElementById("btnSnap").style.display = "flex";
    } catch (e) { console.log("QR Format Error"); }
}

// ================= COLOR ANALYZE (Lab Space) =================
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

// ================= ANALYZE COLOR (เปรียบเทียบกับแผ่นอ้างอิง) =================
function analyzeColor() {
    const w = canvasElement.width;
    const h = canvasElement.height;

    // 1. อ่านสีจากขวดปัสสาวะ (ตรงกลาง)
    const urineRGB = getAvgRGB(w / 2, h / 2, 30);
    const urineLab = rgbToLab(urineRGB[0], urineRGB[1], urineRGB[2]);

    // 2. อ่านสีจากแผ่นอ้างอิงทั้ง 4 จุด (ปรับ x, y ให้ตรงกับตำแหน่งที่คุณแปะจริง)
    // หมายเหตุ: ตัวเลข 0.2, 0.8 คือการกะระยะเป็น % ของหน้าจอ
    const ref1 = rgbToLab(...getAvgRGB(w * 0.22, h * 0.25, 20)); // ตำแหน่งแผ่น LV:1
    const ref2 = rgbToLab(...getAvgRGB(w * 0.78, h * 0.25, 20)); // ตำแหน่งแผ่น LV:2
    const ref3 = rgbToLab(...getAvgRGB(w * 0.22, h * 0.65, 20)); // ตำแหน่งแผ่น LV:3
    const ref4 = rgbToLab(...getAvgRGB(w * 0.78, h * 0.65, 20)); // ตำแหน่งแผ่น LV:4

    // 3. ฟังก์ชันคำนวณหาความใกล้เคียงของสี (Delta E แบบง่าย)
    function getColorDist(color1, color2) {
        return Math.sqrt(
            Math.pow(color1.l - color2.l, 2) +
            Math.pow(color1.a - color2.a, 2) +
            Math.pow(color1.b - color2.b, 2)
        );
    }

    // 4. วัดระยะห่างระหว่าง "สีฉี่" กับ "แผ่นอ้างอิง" ทั้ง 4
    const diffs = [
        { lv: 1, diff: getColorDist(urineLab, ref1) },
        { lv: 2, diff: getColorDist(urineLab, ref2) },
        { lv: 3, diff: getColorDist(urineLab, ref3) },
        { lv: 4, diff: getColorDist(urineLab, ref4) }
    ];

    // 5. เลือกแผ่นที่สี "เหมือนที่สุด" (ระยะห่างน้อยที่สุด)
    diffs.sort((a, b) => a.diff - b.diff);
    let detectedLV = diffs[0].lv;

    // 🟢 ข้อยกเว้นสำหรับ LV.0 (ใส): ถ้าสว่างมากและเหลืองน้อยจริงๆ ให้เป็น 0
    if (urineLab.l > 85 && urineLab.b < 18) {
        detectedLV = 0;
    }

    currentLV = detectedLV;
    const info = LEVELS[currentLV];
    
    // อัปเดต UI
    document.getElementById("liveText").innerText = `LV.${currentLV} - ${info.name}`;
    document.getElementById("liveDot").style.backgroundColor = info.color;
}

// ================= SNAP & SAVE =================

function takePhoto() {
    // 📸 บีบอัดรูปเป็น JPEG คุณภาพ 0.6 เพื่อความเร็วในการส่งข้อมูล
    const photoData = canvasElement.toDataURL('image/jpeg', 0.6);
    document.getElementById("photoSnapshot").src = photoData;
    
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    state = "COMPLETED";
    showSavePopup();
}

function showSavePopup() {
    document.getElementById("dataPopup").classList.add("show");
    document.getElementById("btnSnap").style.display = "none";
    document.getElementById("bottleGuide").classList.remove("show");
    document.getElementById("qrGuide").classList.remove("show");
    document.getElementById("liveStatusBadge").classList.remove("show");
    
    const info = LEVELS[currentLV];
    const badge = document.getElementById("popupColorBadge");
    if(badge) {
        badge.innerText = `ผลวิเคราะห์: ${info.name} (LV.${currentLV})`;
        badge.style.backgroundColor = info.color;
        badge.style.color = (currentLV >= 3) ? "#fff" : "#000";
    }
}

async function confirmSave() {
    const temp = document.getElementById('modalBodyTemp').value;
    if(!temp || temp < 35 || temp > 43) return alert("กรุณาตรวจสอบอุณหภูมิ (35.0 - 43.0)");
    
    const imageData = document.getElementById("photoSnapshot").src;
    
    const record = { 
        date: new Date().toLocaleDateString('th-TH'), 
        Number: currentNumber, 
        name: currentName,
        buble: currentBuble, 
        temp: temp, 
        level: String(currentLV), 
        status: LEVELS[currentLV].name, 
        time: new Date().toLocaleTimeString('th-TH'),
        image: imageData // 🟢 ส่งรูปไปด้วย
    };

    document.getElementById("syncSpinner").style.display = "block";
    try {
        for ( var index = 0; index < CONFIG_SHEET_URL.length; index++ ) {
        await fetch(CONFIG_SHEET_URL[index], { method: "POST", mode: "no-cors", body: JSON.stringify(record) });
        historyData.unshift(record);
        localStorage.setItem('urine_history_v2', JSON.stringify(historyData.slice(0, 10)));
        renderHistory();
        alert("บันทึกข้อมูลเรียบร้อย");
        resetApp(); }
    } catch { alert("บันทึกล้มเหลว"); }
    document.getElementById("syncSpinner").style.display = "none";
}

// ================= UTILS =================

async function toggleFlash() {
    if (!cameraStream) return;
    const track = cameraStream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();
    if (!capabilities.torch) return alert("ไม่รองรับแฟลช");
    isFlashOn = !isFlashOn;
    await track.applyConstraints({ advanced: [{ torch: isFlashOn }] });
}

function getAvgRGB(x, y, size) {
    const data = canvas.getImageData(x - size/2, y - size/2, size, size).data;
    let r=0, g=0, b=0;
    for (let i=0; i<data.length; i+=4) { r+=data[i]; g+=data[i+1]; b+=data[i+2]; }
    return [r/(data.length/4), g/(data.length/4), b/(data.length/4)];
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
      <td>${r.buble}</td>
      <td>${r.temp}°</td>
      <td style="font-weight:bold; color:${LEVELS[r.level].color}">LV.${r.level}</td>
    </tr>
  `).join('');
}

function resetApp() { location.reload(); }

function startClock() {
    setInterval(() => { 
        const el = document.getElementById('clock');
        if(el) el.textContent = new Date().toLocaleTimeString('th-TH'); 
    }, 1000);
}