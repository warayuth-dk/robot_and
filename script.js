// ================= CONFIG & DATA =================
const CONFIG_SHEET_URL = [
  "https://script.google.com/macros/s/AKfycbyBz5dqDwwVrgLCnEcavza0krwszulbGFUaZOtwDttrVb3G5AAHK3-TaIhh05bzDWLwYQ/exec",
  "https://script.google.com/macros/s/AKfycbx9n8sXo7l3m1j2h5a9eXqj0ZtHkKz6n8u2b4/exec",
]; // เปลี่ยน URL ตามต้องการ

const LEVELS = [
  { lv: 0, name: "ใส", color: "#ffffff" },
  { lv: 1, name: "เหลืองจาง", color: "#FEEFC6" },
  { lv: 2, name: "เหลือง", color: "#FDD771" },
  { lv: 3, name: "ส้ม/ขาดน้ำ", color: "#FFB300" },
  { lv: 4, name: "น้ำตาล/อันตราย", color: "#795548" },
];

let state = "IDLE"; // IDLE, SCAN_QR, SNAP_BOTTLE, COMPLETED
let currentLV = 0;
let cameraStream = null;
let html5QrCodeInstance = null; // Instance ตัวสแกนเนอร์ของ html5-qrcode

let currentNumber = "";
let currentName = "";
let currentBuble = "";
let isFlashOn = false;
let historyData = JSON.parse(localStorage.getItem("urine_history_v2") || "[]");

// 🎥 ตัวเลือกกล้องหลายตัว
let cameraMode = "main"; // "main" หรือ "wide"
let availableCameras = { main: null, wide: null };

const video = document.getElementById("video");
const canvasElement = document.getElementById("canvas");
const canvas = canvasElement.getContext("2d", { willReadFrequently: true });

// ================= INIT =================
document.addEventListener("DOMContentLoaded", async () => {
  renderHistory();
  startClock();
  document.getElementById("currentDate").textContent =
    new Date().toLocaleDateString("th-TH");
  initDepartmentSelection();

  // 🟢 ตรวจสอบกล้องที่มีอยู่ และแสดงปุ่มเปลี่ยนกล้องเมื่อมีกล้องที่สองที่มี
  await initCameraDetection();
});

// 🟢 ตัวเริ่มต้นตรวจหากล้อง และแสดงปุ่มสลับกล้องถ้าหากมีกล้องที่สอง
async function initCameraDetection() {
  try {
    // เพียงแค่ check enumerateDevices ไม่ต้องขอ permission ทำให้เกิด constraint error
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoCameras = devices.filter((d) => d.kind === "videoinput");

    availableCameras.main = await getMainCameraId();
    availableCameras.wide = await getWideCameraId();

    console.log("🎥 ตรวจพบกล้อง:", {
      main: availableCameras.main ? "✓" : "✗",
      wide: availableCameras.wide ? "✓" : "✗",
      totalCameras: videoCameras.length,
    });

    // แสดงปุ่มสลับกล้องเฉพาะเมื่อมีกล้องที่สอง
    const btnSwitch = document.getElementById("btnCameraSwitch");
    if (btnSwitch) {
      if (availableCameras.wide) {
        btnSwitch.style.display = "block";
      } else {
        btnSwitch.style.display = "none"; // ซ่อนปุ่มถ้าไม่มีกล้องที่สอง
      }
    }
  } catch (err) {
    console.warn("⚠️ ไม่สามารถตรวจหากล้องได้:", err);
    // ตรวจสอบกล้องใหม่เมื่อผู้ใช้ขออนุญาต
  }
}

// ================= QR SCANNER SYSTEM (html5-qrcode) =================

async function initQRScanner() {
  // ตรวจสอบว่าไลบรารีสแกนโหลดเสร็จหรือไม่
  if (typeof Html5Qrcode === "undefined") {
    alert(
      "❌ ไม่สามารถรันระบบสแกนได้: ไลบรารี html5-qrcode โหลดไม่สำเร็จ\nกรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองรีโหลดหน้าเว็บใหม่อีกครั้ง",
    );
    return;
  }

  // เคลียร์กล้องตัวสแน็ปขวดปัสสาวะก่อนหน้า (ถ้าค้างอยู่)
  stopBottleCamera();

  state = "SCAN_QR";
  document.getElementById("stepTag").textContent = "STEP 1: SCAN QR CODE";
  document.getElementById("stepTag").classList.add("active");

  // จัดการการแสดงผลของ Viewfinder
  document.getElementById("qrScannerContainer").style.display = "block";
  document.getElementById("video").style.display = "none";
  document.getElementById("qrGuide").classList.add("show");
  document.getElementById("bottleGuide").classList.remove("show");
  document.getElementById("liveStatusBadge").classList.remove("show");
  document.getElementById("btnSnap").style.display = "none";
  document.getElementById("instructionOverlay").style.display = "none";

  // รีเซ็ตข้อมูลทหารเดิม
  currentNumber = "";
  currentName = "";
  currentBuble = "";
  document.getElementById("displayUserName").innerText = "รอสแกน QR CODE...";
  document.getElementById("targetNameDisplay").innerText = "--";

  // หน่วงเวลาเล็กน้อย (300ms) เพื่อรอให้เบราว์เซอร์จัดวางเลย์เอาท์และรอให้ระบบปฏิบัติการปล่อยสิทธิ์กล้องเดิม
  // ช่วยป้องกันปัญหาการแจ้งเตือนเรื่องความกว้างความสูงเป็น 0 (Width/Height 0px error) บนมือถือบางรุ่น
  setTimeout(async () => {
    try {
      if (!html5QrCodeInstance) {
        html5QrCodeInstance = new Html5Qrcode("qrScannerContainer");
      }

      if (!html5QrCodeInstance.isScanning) {
        // 🟢 ไม่ระบุ qrbox เพื่อให้สแกนภาพเต็มเฟรม (Full Frame Scan)
        // ช่วยให้ผู้ใช้ถอยกล้องออกห่างในระยะที่เลนส์หลักโฟกัสได้คมชัด แล้วระบบยังสามารถสแกนอ่านค่าได้
        const config = { fps: 20 };

        // ค้นหารหัสกล้องหลัก พร้อมระบุความละเอียดภาพแบบ Full HD (1920x1080) เพื่อให้ภาพ QR คมชัดที่สุด
        const cameraId = await getSelectedCameraId(); // 🟢 ใช้กล้องที่เลือก
        const cameraConfig = {
          deviceId: cameraId ? { exact: cameraId } : undefined,
          facingMode: cameraId ? undefined : "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        };

        await html5QrCodeInstance.start(
          cameraConfig,
          config,
          (decodedText) => {
            handleQRCode(decodedText);
          },
          (errorMessage) => {
            // ข้ามการแจ้งเตือน Error ทั่วไปในขณะสแกน
          },
        );
        console.log("QR Scanner started.");
      }
    } catch (e) {
      console.error("QR Scanner initialization failed:", e);
      // ลองดูว่า e.name คืออะไร
      if (e.name === "NotAllowedError") {
        alert("ผู้ใช้ปฏิเสธการเข้าถึงกล้อง");
      } else if (e.name === "NotFoundError") {
        alert("ไม่พบตัวฮาร์ดแวร์กล้อง");
      } else if (e.name === "NotReadableError") {
        alert("กล้องกำลังถูกแอปอื่นใช้งานอยู่");
      } else if (e.name === "SecurityError") {
        alert("ต้องใช้ HTTPS เท่านั้น");
      } else {
        const errorName = e.name || typeof e;
        const errorMsg = e.message || String(e) || "ข้อมูลข้อผิดพลาดไม่ชัดเจน";
        alert("Error อื่นๆ: " + errorName + " - " + errorMsg);
      }
      document.getElementById("instructionOverlay").style.display = "flex";
    }
  }, 300);
}

async function handleQRCode(data) {
  try {
    const url = new URL(data);
    currentNumber = url.searchParams.get("Number") || "-";
    currentName = url.searchParams.get("name") || "Unknown";
    currentBuble = url.searchParams.get("Buble") || "-";

    document.getElementById("displayUserName").innerText =
      `ทหาร: ${currentName} (${currentNumber} - ${currentBuble})`;
    document.getElementById("targetNameDisplay").innerText = currentName;

    // 🟢 หยุดตัวสแกนเนอร์ของ html5-qrcode ทันที
    await stopQRScanner();

    // เปลี่ยนสเตทไปยังหน้าถ่ายรูปขวดปัสสาวะ
    state = "SNAP_BOTTLE";
    document.getElementById("stepTag").textContent =
      "STEP 2: ถ่ายรูปขวดปัสสาวะ";
    document.getElementById("qrGuide").classList.remove("show");
    document.getElementById("bottleGuide").classList.add("show");
    document.getElementById("liveStatusBadge").classList.add("show");
    document.getElementById("btnSnap").style.display = "flex";

    // 🟢 หน่วงเวลา 350ms ให้ระบบปฏิบัติการปล่อยสิทธิ์ฮาร์ดแวร์กล้อง (Camera Hardware Session Release) ให้เสร็จสิ้นก่อน
    // ป้องกันอาการ "กล้องดำ" ในขั้นตอนที่ 2
    setTimeout(async () => {
      await startBottleCamera();
    }, 350);
  } catch (e) {
    console.log("QR Format Error:", e);
  }
}

function stopQRScanner() {
  return new Promise((resolve) => {
    if (html5QrCodeInstance && html5QrCodeInstance.isScanning) {
      html5QrCodeInstance
        .stop()
        .then(() => {
          console.log("QR Scanner stopped.");
          document.getElementById("qrScannerContainer").innerHTML = ""; // ล้าง HTML ในกล่องออกเพื่อเคลียร์สตรีม
          html5QrCodeInstance = null; // 🟢 ล้างไอดีอินสแตนซ์เดิมออกเพื่อเปิดการรันใหม่หมดจด
          resolve();
        })
        .catch((err) => {
          console.error("Failed to stop QR Scanner:", err);
          html5QrCodeInstance = null; // 🟢 ล้างเพื่อป้องกันการติดขัดสถานะค้าง
          resolve(); // ปลดล็อกให้ไหลไปสเตปถัดไปแม้เกิดข้อผิดพลาด
        });
    } else {
      resolve();
    }
  });
}

// ================= BOTTLE CAMERA & ANALYZE COLOR =================

async function startBottleCamera() {
  try {
    stopBottleCamera(); // เคลียร์สตรีมเก่าออกก่อนเสมอ

    document.getElementById("qrScannerContainer").style.display = "none";
    document.getElementById("video").style.display = "block";

    const isAndroid = /Android/i.test(navigator.userAgent);
    const selectedId = await getSelectedCameraId(); // 🟢 ใช้กล้องที่เลือก

    const constraints = isAndroid
      ? {
          video: selectedId
            ? {
                deviceId: { exact: selectedId },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 24 },
              }
            : {
                facingMode: "environment",
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 24 },
              },
        }
      : {
          video: selectedId
            ? {
                deviceId: { exact: selectedId },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              }
            : {
                facingMode: "environment",
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
        };

    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = cameraStream;
    await video.play();

    // บังคับการตรวจโฟกัส
    await applyAutofocus(cameraStream);

    // เปิดลูปวิเคราะห์สีขวดปัสสาวะ
    requestAnimationFrame(bottleAnalysisLoop);
  } catch (e) {
    console.error("Failed to start bottle camera:", e);
    // กรณีพิเศษ: ลองเข้ากล้องแบบ Standard ทั่วไป
    try {
      const fallbackConstraints = {
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      };
      cameraStream =
        await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      video.srcObject = cameraStream;
      await video.play();
      await applyAutofocus(cameraStream);
      requestAnimationFrame(bottleAnalysisLoop);
    } catch (err) {
      alert("เปิดกล้องวิเคราะห์ปัสสาวะไม่ได้");
    }
  }
}

let lastColorAnalyzeTime = 0;
function bottleAnalysisLoop() {
  if (state !== "SNAP_BOTTLE") return; // หยุดการทำงานถ้าพ้นสเตท
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    const now = Date.now();
    if (now - lastColorAnalyzeTime >= 250) {
      drawVideoToCanvas();
      analyzeColor();
      lastColorAnalyzeTime = now;
    }
  }
  requestAnimationFrame(bottleAnalysisLoop);
}

function stopBottleCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  if (video) {
    video.srcObject = null;
  }
}

function drawVideoToCanvas() {
  const maxDim = 640; // บีบอัดขนาดเพื่อเพิ่มความเร็วในการคำนวณและประหยัดแบนด์วิธส่งข้อมูล
  let w = video.videoWidth;
  let h = video.videoHeight;
  if (w > maxDim) {
    h = Math.round((maxDim / w) * h);
    w = maxDim;
  }
  if (canvasElement.width !== w || canvasElement.height !== h) {
    canvasElement.width = w;
    canvasElement.height = h;
  }
  canvas.drawImage(video, 0, 0, w, h);
}

// ================= COLOR ANALYZE (Lab Space) =================
function rgbToLab(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;
  x /= 95.047;
  y /= 100.0;
  z /= 108.883;
  x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

function analyzeColor() {
  const w = canvasElement.width;
  const h = canvasElement.height;

  // 1. ดึงสีตัวอย่างขวดปัสสาวะ (ตรงกลางกล้อง)
  const urineRGB = getAvgRGB(w / 2, h / 2, 30);
  const urineLab = rgbToLab(urineRGB[0], urineRGB[1], urineRGB[2]);

  // 2. ดึงสีแผ่นเทียบอ้างอิงรอบมุมกล้อง
  const ref1 = rgbToLab(...getAvgRGB(w * 0.22, h * 0.25, 20)); // แผ่น LV:1
  const ref2 = rgbToLab(...getAvgRGB(w * 0.78, h * 0.25, 20)); // แผ่น LV:2
  const ref3 = rgbToLab(...getAvgRGB(w * 0.22, h * 0.65, 20)); // แผ่น LV:3
  const ref4 = rgbToLab(...getAvgRGB(w * 0.78, h * 0.65, 20)); // แผ่น LV:4

  function getColorDist(color1, color2) {
    return Math.sqrt(
      Math.pow(color1.l - color2.l, 2) +
        Math.pow(color1.a - color2.a, 2) +
        Math.pow(color1.b - color2.b, 2),
    );
  }

  const diffs = [
    { lv: 1, diff: getColorDist(urineLab, ref1) },
    { lv: 2, diff: getColorDist(urineLab, ref2) },
    { lv: 3, diff: getColorDist(urineLab, ref3) },
    { lv: 4, diff: getColorDist(urineLab, ref4) },
  ];

  diffs.sort((a, b) => a.diff - b.diff);
  let detectedLV = diffs[0].lv;

  // เงื่อนไขสำหรับเลเวล 0 (ปัสสาวะสีใส)
  if (urineLab.l > 85 && urineLab.b < 18) {
    detectedLV = 0;
  }

  currentLV = detectedLV;
  const info = LEVELS[currentLV];

  // อัปเดตการแสดงผลเรดาร์สด
  document.getElementById("liveText").innerText =
    `LV.${currentLV} - ${info.name}`;
  document.getElementById("liveDot").style.backgroundColor = info.color;
}

// ================= SNAP & SAVE SYSTEM =================

function takePhoto() {
  // บันทึกและวาดภาพล่าสุด
  drawVideoToCanvas();

  const photoData = canvasElement.toDataURL("image/jpeg", 0.6);
  document.getElementById("photoSnapshot").src = photoData;

  // 🟢 ปิดใช้งานสตรีมกล้องทั้งหมดทันทีเพื่อถอนทรัพยากรการแสดงผล
  stopBottleCamera();

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
  if (badge) {
    badge.innerText = `ผลวิเคราะห์: ${info.name} (LV.${currentLV})`;
    badge.style.backgroundColor = info.color;
    badge.style.color = currentLV >= 3 ? "#fff" : "#000";
  }
}

async function confirmSave() {
  const temp = document.getElementById("modalBodyTemp").value;
  if (!temp || temp < 35 || temp > 43)
    return alert("กรุณาตรวจสอบอุณหภูมิ (35.0 - 43.0)");

  const selectedDept = localStorage.getItem("selected_department");
  if (!selectedDept) {
    alert("ไม่พบข้อมูลหน่วยงานปฏิบัติการ กรุณาเลือกหน่วยงานก่อน");
    showDeptModal();
    return;
  }

  const deptIndex = departmentsList.indexOf(selectedDept);
  let targetUrl = null;
  if (deptIndex !== -1 && deptIndex < CONFIG_SHEET_URL.length) {
    targetUrl = CONFIG_SHEET_URL[deptIndex];
  }

  if (!targetUrl) {
    alert(
      `ไม่พบ Google Sheet URL ที่ตรงกับหน่วยงานลำดับที่ ${deptIndex + 1} (${selectedDept})\nกรุณาเพิ่ม URL ในตัวแปร CONFIG_SHEET_URL ของสคริปต์`,
    );
    return;
  }

  const imageData = document.getElementById("photoSnapshot").src;

  const record = {
    date: new Date().toLocaleDateString("th-TH"),
    Number: currentNumber,
    name: currentName,
    buble: currentBuble,
    temp: temp,
    level: String(currentLV),
    status: LEVELS[currentLV].name,
    time: new Date().toLocaleTimeString("th-TH"),
    image: imageData,
    department: DEPARTMENT_MAP[selectedDept] || selectedDept, // 🏢 ชื่อหน่วยงาน (เช่น หน่วย A)
  };

  document.getElementById("syncSpinner").style.display = "block";
  try {
    await fetch(targetUrl, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify(record),
    });
    historyData.unshift(record);
    localStorage.setItem(
      "urine_history_v2",
      JSON.stringify(historyData.slice(0, 10)),
    );
    renderHistory();
    alert("บันทึกข้อมูลเรียบร้อย");
    resetApp(); // 🟢 รีเซ็ตหน้าแอปรองรับสตรีมรอบถัดไปโดยไม่รีโหลดเบราว์เซอร์
  } catch {
    alert("บันทึกล้มเหลว");
  }
  document.getElementById("syncSpinner").style.display = "none";
}

// ================= UTILITIES =================

async function toggleFlash() {
  if (!cameraStream) return;
  const track = cameraStream.getVideoTracks()[0];
  const capabilities = track.getCapabilities();
  if (!capabilities.torch) return alert("ไม่รองรับแฟลช");
  isFlashOn = !isFlashOn;
  await track.applyConstraints({ advanced: [{ torch: isFlashOn }] });
}

function getAvgRGB(x, y, size) {
  const data = canvas.getImageData(x - size / 2, y - size / 2, size, size).data;
  let r = 0,
    g = 0,
    b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return [r / (data.length / 4), g / (data.length / 4), b / (data.length / 4)];
}

function renderHistory() {
  const body = document.getElementById("historyBody");
  if (!body) return;
  body.innerHTML = historyData
    .map(
      (r) => `
    <tr>
      <td>${r.date}</td>
      <td>${r.time}</td>
      <td>${r.Number}</td>
      <td>${r.name}</td>
      <td>${r.buble}</td>
      <td>${r.temp}°</td>
      <td style="font-weight:bold; color:${LEVELS[r.level].color}">LV.${r.level}</td>
    </tr>
  `,
    )
    .join("");
}

function resetApp() {
  // ล้างการแสดงผลโมเดลและ Popup ที่ป๊อปมาทับหน้าจอหลัก
  document.getElementById("dataPopup").classList.remove("show");
  document.getElementById("modalBodyTemp").value = "";
  document.getElementById("btnSnap").style.display = "none";

  // มั่นใจว่าดับและเคลียร์กล้องขวดค้างออกเรียบร้อย
  stopBottleCamera();

  // หน่วงเวลา 400ms ก่อนเริ่มสแกนใหม่ เพื่อเผื่อเวลาให้ระบบเคลียร์กล้องของขั้นตอนก่อนหน้า
  setTimeout(() => {
    stopQRScanner().then(() => {
      initQRScanner();
    });
  }, 400);
}

function startClock() {
  setInterval(() => {
    const el = document.getElementById("clock");
    if (el) el.textContent = new Date().toLocaleTimeString("th-TH");
  }, 1000);
}

// 🟢 ตัวกรองอัจฉริยะกล้องหลักตัวที่คมชัดโฟกัสชัดที่สุด
async function getMainCameraId() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((d) => d.kind === "videoinput");

  const hasLabels = videoDevices.some(
    (d) => d.label && d.label.trim().length > 0,
  );
  if (!hasLabels) {
    return null; // ไม่มีสิทธิ์หรือ labels คืนค่า null เพื่อบังคับใช้ facingMode: "environment" แทน
  }

  const isAndroid = /Android/i.test(navigator.userAgent);

  let backCameras = videoDevices.filter((d) => {
    const label = d.label.toLowerCase();
    return (
      label.includes("back") ||
      label.includes("rear") ||
      label.includes("camera 0") ||
      label.includes("main")
    );
  });

  if (backCameras.length === 0) {
    return null;
  }

  let mainCamera = backCameras.find((d) => {
    const label = d.label.toLowerCase();
    return label.includes("1x") || label.includes("main");
  });

  if (mainCamera) return mainCamera.deviceId;

  mainCamera = backCameras.find((d) => {
    const label = d.label.toLowerCase();
    return (
      !label.includes("0.5") &&
      !label.includes("0.6") &&
      !label.includes("0.7") &&
      !label.includes("0.8") &&
      !label.includes("ultra") &&
      !label.includes("wide") &&
      !label.includes("macro") &&
      !label.includes("0.25") &&
      !label.includes("periscope") &&
      !label.includes("aux") &&
      !label.includes("logical")
    );
  });

  if (mainCamera) return mainCamera.deviceId;

  if (isAndroid && backCameras.length > 0) {
    return backCameras[0].deviceId;
  }

  return backCameras[0] ? backCameras[0].deviceId : null;
}

// 🟢 ตัวกรองกล้องมุมกว้าง (Wide-angle) ของ Samsung A57
async function getWideCameraId() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((d) => d.kind === "videoinput");

  const hasLabels = videoDevices.some(
    (d) => d.label && d.label.trim().length > 0,
  );
  if (!hasLabels) {
    return null;
  }

  let backCameras = videoDevices.filter((d) => {
    const label = d.label.toLowerCase();
    return (
      label.includes("back") ||
      label.includes("rear") ||
      label.includes("camera 0") ||
      label.includes("main")
    );
  });

  if (backCameras.length < 2) {
    return null; // ไม่มีกล้องที่สอง
  }

  // ค้นหากล้องมุมกว้าง
  let wideCamera = backCameras.find((d) => {
    const label = d.label.toLowerCase();
    return label.includes("wide") || label.includes("0.5");
  });

  if (wideCamera) return wideCamera.deviceId;

  // ถ้าไม่มี wide ให้ลองหา ultra wide
  wideCamera = backCameras.find((d) => {
    const label = d.label.toLowerCase();
    return (
      label.includes("ultra") || label.includes("0.6") || label.includes("0.7")
    );
  });

  if (wideCamera) return wideCamera.deviceId;

  // ถ้าเป็น Samsung A57 ลองใช้กล้องที่ 2 (มักจะเป็น wide)
  if (backCameras.length > 1) {
    return backCameras[1].deviceId;
  }

  return null;
}

// 🟢 ตัวสแกนกล้องที่มีจำนวนเท่าไหร่
async function enumerateAllCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((d) => d.kind === "videoinput");

  console.log("📹 พบกล้องทั้งหมด:", videoDevices.length);
  videoDevices.forEach((d, idx) => {
    console.log(`  [${idx}] ${d.label} (${d.deviceId.substring(0, 10)}...)`);
  });

  return videoDevices;
}

// 🟢 ตัวสลับกล้อง (Main <-> Wide)
async function switchCamera() {
  cameraMode = cameraMode === "main" ? "wide" : "main";

  // อัปเดตข้อความปุ่ม
  const btn = document.getElementById("btnCameraSwitch");
  if (btn) {
    btn.textContent = cameraMode === "main" ? "📷 Main (1x)" : "📷 Wide (0.5x)";
  }

  // ถ้าอยู่ในโหมดกล้องอยู่แล้ว ให้สลับกล้องทันที
  if (state === "SNAP_BOTTLE") {
    await stopBottleCamera();
    await startBottleCamera();
  }
}

// 🟢 ตัวเลือกกล้องโดยใช้ cameraMode
async function getSelectedCameraId() {
  if (cameraMode === "wide") {
    const wideId = await getWideCameraId();
    if (wideId) return wideId;
  }

  return await getMainCameraId();
}

// 🟢 ตัวสั่งโฟกัสต่อเนื่อง
async function applyAutofocus(stream) {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (track) {
    try {
      const capabilities = track.getCapabilities();
      if (
        capabilities.focusMode &&
        capabilities.focusMode.includes("continuous")
      ) {
        await track.applyConstraints({
          advanced: [{ focusMode: "continuous" }],
        });
        console.log("Continuous autofocus enabled!");
      }
    } catch (err) {
      console.log("Autofocus constraint not supported:", err);
    }
  }
}

// ================= DEPARTMENT SELECTION SYSTEM =================
const DEPARTMENT_MAP = {
  482917: "หน่วย A",
  105638: "หน่วย B",
  764291: "หน่วย C",
  390584: "หน่วย D",
  827163: "หน่วย E",
  651029: "หน่วย F",
  214875: "หน่วย G",
  938406: "หน่วย H",
  570318: "หน่วย I",
  146792: "หน่วย J",
};

let departmentsList = [];

async function initDepartmentSelection() {
  try {
    const response = await fetch("department.txt");
    const text = await response.text();
    departmentsList = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const select = document.getElementById("deptSelect");
    if (select) {
      select.innerHTML =
        '<option value="" disabled selected>-- เลือกรหัสหน่วยงาน --</option>' +
        departmentsList
          .map((code) => {
            const name = DEPARTMENT_MAP[code] || "หน่วยงานนิรนาม";
            return `<option value="${code}">${name} (${code})</option>`;
          })
          .join("");
    }

    const savedDept = localStorage.getItem("selected_department");
    if (savedDept && departmentsList.includes(savedDept)) {
      updateDeptDisplay(savedDept);
      // เริ่มต้นเปิดสแกนเนอร์ทันทีหากรันเครื่องด้วยหน่วยเดิมอยู่แล้ว
      initQRScanner();
    } else {
      showDeptModal();
    }
  } catch (e) {
    console.error("Error loading departments:", e);
    showDeptModal();
  }
}

function showDeptModal() {
  const savedDept = localStorage.getItem("selected_department");
  const select = document.getElementById("deptSelect");
  if (select && savedDept) {
    select.value = savedDept;
  }
  document.getElementById("deptModal").style.display = "flex";
}

function saveDepartment() {
  const select = document.getElementById("deptSelect");
  if (!select) return;

  const value = select.value;
  if (!value) {
    alert("กรุณาเลือกหน่วยงานปฏิบัติการ");
    return;
  }

  localStorage.setItem("selected_department", value);
  updateDeptDisplay(value);
  document.getElementById("deptModal").style.display = "none";
  // เปิดระบบแสกนเนอร์
  initQRScanner();
}

function updateDeptDisplay(deptCode) {
  const display = document.getElementById("selectedDeptDisplay");
  if (display) {
    const name = DEPARTMENT_MAP[deptCode] || "หน่วยงานนิรนาม";
    display.innerText = `🏢 ${name}`;
  }
}
