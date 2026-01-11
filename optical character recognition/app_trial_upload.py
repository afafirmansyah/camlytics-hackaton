"""
AI License Plate Recognition (LPR) System - All-in-One File
- Incorporates: FastAPI API, YOLOv8, EasyOCR, Detection Stability, MQTT, and Web UI.
- Corrected MQTT publishing for uploads and file saving in debug_capture.
"""
import cv2
import time
import base64
import json
import threading
import io
import os
import easyocr
import numpy as np
from typing import List, Dict, Any
from datetime import datetime, timezone
from io import BytesIO
from PIL import Image
import paho.mqtt.client as mqtt
from ultralytics import YOLO

# FastAPI / API imports
from fastapi import FastAPI, UploadFile, File, Response
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from starlette.staticfiles import StaticFiles

# ========== CONFIGURATION (Adjust if needed) ==========
CONFIG = {
    "YOLO_MODEL_PATH": "license_plate_detector.pt", 
    "CAMERA_SOURCE": int(os.getenv('CAMERA_SOURCE', 0)),
    "CONFIDENCE_THRESHOLD": float(os.getenv('CONF_THRESH', 0.5)),
    "FRAME_SKIP": int(os.getenv('FRAME_SKIP', 5)),
    "STABILITY_COUNT": int(os.getenv('STABILITY_COUNT', 5)),
    "EXIT_TIMEOUT": float(os.getenv('EXIT_TIMEOUT', 15.0)),
    "MQTT_BROKER": os.getenv('MQTT_BROKER', "broker.hivemq.com"),
    "MQTT_PORT": int(os.getenv('MQTT_PORT', 1883)),
    "MQTT_TOPIC": os.getenv('MQTT_TOPIC', "test/parking/licenseplate"),
    "OCR_LANGS": ['en'], 
    "PUBLISH_IMAGE_BASE64": os.getenv('PUBLISH_IMAGE_BASE64', 'True') == 'True',
    "CROP_PAD": float(os.getenv('CROP_PAD', 0.08)),
    "DEBUG_SAVE": os.getenv('DEBUG_SAVE', 'True') == 'True',
    "OCR_GPU": os.getenv('OCR_GPU', 'False') == 'True',
}
# ==========================================================

if CONFIG['DEBUG_SAVE']:
    os.makedirs("debug_capture", exist_ok=True)


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat()

# ==========================================================
# ============== LPProcessor CLASS (Core Logic) ============
# ==========================================================

class LPProcessor:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        
        # Load Models
        print("Loading YOLO model...")
        self.yolo = YOLO(self.config['YOLO_MODEL_PATH'])
        print("Loading EasyOCR model...")
        self.reader = easyocr.Reader(self.config['OCR_LANGS'], gpu=self.config['OCR_GPU'])
        
        # State Management
        self.plates_seen = {}
        self.confirmed_plates = set()
        self.recorded_plates = set()
        self.lock = threading.Lock()
        
        # MQTT Setup
        self.client = None
        self.mqtt_enabled = os.getenv('MQTT_ENABLED', '1') != '0'
        if self.mqtt_enabled:
            self._connect_mqtt()
            
        # Video Stream State
        self.latest_frame_jpeg = None
        self._camera_thread = None
        self._camera_thread_stop = threading.Event()
        
        # Start background watchers
        threading.Thread(target=self._exit_watcher, daemon=True).start()

    def _connect_mqtt(self):
        try:
            self.client = mqtt.Client()
            self.client.connect(self.config['MQTT_BROKER'], self.config['MQTT_PORT'], keepalive=60)
            self.client.loop_start()
            print(f"✅ Connected to MQTT broker: {self.config['MQTT_BROKER']}")
        except Exception as e:
            print(f"⚠️ Could not connect to MQTT broker: {e}")
            self.mqtt_enabled = False
            self.client = None

    def publish_event(self, event_type, plate_text, confidence, crop_img):
        payload = {
            "plate": plate_text,
            "event": event_type,
            "confidence": float(confidence),
            "timestamp": now_iso()
        }
        if self.config['PUBLISH_IMAGE_BASE64'] and crop_img is not None:
            buf = BytesIO()
            crop_img.save(buf, format="JPEG")
            b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
            payload["image_base64"] = b64

        if self.mqtt_enabled and self.client is not None:
            try:
                self.client.publish(self.config['MQTT_TOPIC'], json.dumps(payload), qos=1)
                print(f"[MQTT] {event_type.upper()} - {plate_text} ({confidence:.2f})")
            except Exception as e:
                print(f"⚠️ Failed to publish MQTT: {e}")
        else:
            print(f"[MQTT disabled] {event_type.upper()} - {plate_text} ({confidence:.2f})")

    def run_ocr(self, pil_img):
        img_cv = np.array(pil_img.convert("RGB"))
        results = self.reader.readtext(img_cv, detail=1, paragraph=False, 
                                       allowlist='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')

        if not results:
            return "", 0.0

        best_result = max(results, key=lambda r: r[2])
        best_text = "".join([c for c in best_result[1] if c.isalnum()]).upper()
        best_conf = best_result[2]

        return best_text, best_conf

    def crop_with_padding(self, image, box):
        x1, y1, x2, y2 = box
        h, w = image.shape[:2]
        pad_frac = self.config['CROP_PAD']
        
        pad_x = int((x2 - x1) * pad_frac)
        pad_y = int((y2 - y1) * pad_frac)
        
        x1 = max(0, x1 - pad_x)
        y1 = max(0, y1 - pad_y)
        x2 = min(w - 1, x2 + pad_x)
        y2 = min(h - 1, y2 + pad_y)
        
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            return None
        return Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    
    def _encode_frame_jpeg(self, frame):
        try:
            ret, jpeg = cv2.imencode('.jpg', frame)
            if not ret: return None
            return jpeg.tobytes()
        except Exception:
            return None

    def _exit_watcher(self):
        while True:
            now_ts = time.time()
            with self.lock:
                expired = [p for p, v in self.plates_seen.items() if now_ts - v["last_seen"] > self.config['EXIT_TIMEOUT']]
                for pid in expired:
                    if pid in self.confirmed_plates:
                         print(f"[EXIT] Plate {pid} timed out.")
                         self.confirmed_plates.remove(pid)
                    del self.plates_seen[pid]
            time.sleep(1.0)
            
    def _save_debug_images(self, plate_text, crop_pil, tag='proc'):
        """Saves detection crop and a basic processed version."""
        try:
            ts = now_iso().replace(':', '-')
            # Save detection crop (det)
            det_path = os.path.join("debug_capture", f"{ts}_{plate_text}_{tag}_det.jpg")
            crop_pil.save(det_path, quality=85)

            # Save processed OCR image (ocr)
            rgb = np.array(crop_pil.convert('RGB'))
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            # Simple processing: blur + threshold
            gray_up = cv2.resize(gray, (gray.shape[1] * 2, gray.shape[0] * 2), interpolation=cv2.INTER_LINEAR)
            filtered = cv2.bilateralFilter(gray_up, 9, 75, 75)
            th = cv2.adaptiveThreshold(filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                     cv2.THRESH_BINARY, 11, 2)
            ocr_path = os.path.join("debug_capture", f"{ts}_{plate_text}_{tag}_ocr.jpg")
            Image.fromarray(th).save(ocr_path, quality=85)
            print(f"   [DEBUG SAVE] Saved {det_path} and {ocr_path}")
        except Exception as e:
             print(f"⚠️ Failed to save debug images: {e}")
            
    # --- Main Processing Methods ---

    def process_image(self, bgr_image: np.ndarray, upload_mode: bool = False) -> List[Dict[str, Any]]:
        """Process a single image (upload mode) and publishes results."""
        detections = []
        results = self.yolo.predict(bgr_image, conf=self.config['CONFIDENCE_THRESHOLD'], verbose=False)

        for r in results:
            for box in r.boxes:
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                crop = self.crop_with_padding(bgr_image, (x1, y1, x2, y2))
                
                if crop is None: continue

                plate_text, ocr_conf = self.run_ocr(crop)
                if len(plate_text) < 4: continue
                
                # 1. Debug Save (for upload test)
                if self.config['DEBUG_SAVE']:
                    self._save_debug_images(plate_text, crop, tag='upload')

                # 2. Publish MQTT (for upload test)
                self.publish_event("ENTRY", plate_text, ocr_conf, crop)
                
                # 3. Draw visualization
                cv2.rectangle(bgr_image, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(bgr_image, f"{plate_text} ({ocr_conf:.2f})", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

                detections.append({
                    'plate': plate_text,
                    'conf': conf,
                    'ocr_conf': ocr_conf,
                    'bbox': (x1, y1, x2, y2),
                })
        return detections

    def detection_loop(self, display: bool = False, stream: bool = True):
        """Camera loop for production/live stream"""
        cap = cv2.VideoCapture(self.config['CAMERA_SOURCE'])
        frame_idx = 0

        print(f"🎥 Starting camera processor (Source: {self.config['CAMERA_SOURCE']})...")
        while not self._camera_thread_stop.is_set():
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.3)
                continue

            frame_idx += 1
            if frame_idx % self.config['FRAME_SKIP'] != 0: continue

            results = self.yolo.predict(frame, conf=self.config['CONFIDENCE_THRESHOLD'], verbose=False)

            for r in results:
                for box in r.boxes:
                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    crop = self.crop_with_padding(frame, (x1, y1, x2, y2))
                    if crop is None: continue

                    plate_text, ocr_conf = self.run_ocr(crop)
                    if len(plate_text) < 4: continue

                    # Stability tracking 
                    with self.lock:
                        if plate_text not in self.plates_seen:
                             self.plates_seen[plate_text] = {"count": 1, "last_seen": time.time(), "conf": conf, "texts": [plate_text], "crop": crop}
                        else:
                            self.plates_seen[plate_text]["count"] += 1
                            self.plates_seen[plate_text]["last_seen"] = time.time()
                            self.plates_seen[plate_text]["conf"] = max(self.plates_seen[plate_text]["conf"], conf)
                            self.plates_seen[plate_text]["texts"].append(plate_text)
                            self.plates_seen[plate_text]["crop"] = crop 

                        # Confirmation Check
                        if self.plates_seen[plate_text]["count"] >= self.config['STABILITY_COUNT']:
                            texts = self.plates_seen[plate_text]["texts"]
                            final_text = max(set(texts), key=texts.count)
                            
                            if final_text not in self.confirmed_plates:
                                self.confirmed_plates.add(final_text)
                                
                                final_conf = self.plates_seen[plate_text]["conf"]
                                final_crop = self.plates_seen[plate_text]["crop"]
                                
                                # 1. Publish event ENTRY
                                self.publish_event("entry", final_text, final_conf, final_crop)
                                
                                # 2. Debug save (Saves only on first confirmation)
                                if self.config['DEBUG_SAVE']:
                                    self._save_debug_images(final_text, final_crop, tag='conf')
                                
                    # Draw for visualization
                    color = (0, 255, 0) if plate_text in self.confirmed_plates else (0, 165, 255)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(frame, plate_text, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

            # Update latest frame for streaming
            if stream:
                latest = self._encode_frame_jpeg(frame)
                if latest is not None:
                    self.latest_frame_jpeg = latest

            if display:
                cv2.imshow("LPR Capture", frame)
                if cv2.waitKey(1) & 0xFF == 27: break

        cap.release()
        if display: cv2.destroyAllWindows()


    def start_camera_in_thread(self, stream: bool = True, display: bool = False):
        if self._camera_thread and self._camera_thread.is_alive(): return
        self._camera_thread_stop.clear()
        self._camera_thread = threading.Thread(target=self.detection_loop, kwargs={'display': display, 'stream': stream}, daemon=True)
        self._camera_thread.start()

    def get_latest_frame(self) -> bytes:
        return self.latest_frame_jpeg

# ==========================================================
# ================== FASTAPI / API =========================
# ==========================================================

app = FastAPI(title="LPR Stable OCR API")
processor = LPProcessor(CONFIG) 
processor.start_camera_in_thread(stream=True) 

# --- Endpoint 1: Upload Image (Testing) ---
@app.post("/api/upload/")
async def upload_image_for_testing(file: UploadFile = File(...)):
    """Receives an image file, processes it, and returns the result, publishing an MQTT event."""
    
    content = await file.read()
    nparr = np.frombuffer(content, np.uint8)
    img_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img_np is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image format"})

    # Process image (this now includes file saving and MQTT publishing)
    detections = processor.process_image(img_np, upload_mode=True)
    
    # Encode the visualization image
    ret, jpeg = cv2.imencode('.jpg', img_np)
    if not ret:
        return JSONResponse(status_code=500, content={"error": "Failed to encode image"})

    return StreamingResponse(
        io.BytesIO(jpeg.tobytes()),
        media_type="image/jpeg",
        headers={"X-OCR-Results": json.dumps(detections)}
    )

# --- Endpoint 2 & 3 (Video Feed and UI remain the same) ---
def generate_frame():
    while True:
        frame_jpeg = processor.get_latest_frame()
        if frame_jpeg:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_jpeg + b'\r\n')
        time.sleep(1/30) 

@app.get("/api/video_feed/")
async def video_feed():
    return StreamingResponse(generate_frame(), media_type="multipart/x-mixed-replace; boundary=frame")


HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Vision - License Plate Recognition</title>
    <style>
        /* CSS from previous response */
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        h1 { color: #007bff; text-align: center; margin-bottom: 30px; }
        .tab-menu { display: flex; justify-content: center; gap: 20px; margin-bottom: 20px; }
        .tab-button { padding: 10px 20px; border: none; background: #eee; border-radius: 8px; cursor: pointer; transition: background 0.3s; font-weight: 600; }
        .tab-button.active { background: #007bff; color: white; }
        .content-area { border: 1px solid #ddd; border-radius: 8px; padding: 20px; min-height: 400px; text-align: center; }
        #output-image { max-width: 100%; border-radius: 6px; margin-top: 15px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
        .results { margin-top: 20px; padding: 15px; background: #e9f7ff; border-left: 5px solid #007bff; text-align: left; }
        input[type="file"] { padding: 10px; border: 1px solid #ccc; border-radius: 6px; }
        #liveVideoFeed { width: 100%; height: auto; max-height: 450px; background: #333; margin-top: 15px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>👁️ AI License Plate Recognition (LPR)</h1>
        <div class="tab-menu">
            <button class="tab-button active" onclick="showTab('upload')">Upload Testing Image</button>
            <button class="tab-button" onclick="showTab('livecam')">Live Cam (Production)</button>
        </div>

        <div class="content-area">
            <div id="upload-tab" class="tab-content">
                <h2>Upload License Plate Image</h2>
                <input type="file" id="imageUpload" accept="image/*">
                <button onclick="processUpload()">Process Image</button>

                <img id="output-image" style="display:none;" alt="Processed Image">
                <div id="ocrResults" class="results" style="display:none;"></div>
            </div>

            <div id="livecam-tab" class="tab-content" style="display:none;">
                <h2>Live Camera Stream (Real-Time)</h2>
                <img id="liveVideoFeed" src="" alt="Live Video Feed" onerror="this.alt='Video stream not available. Check camera source.'">
                <p>⚠️ Check the Uvicorn console for MQTT (ENTRY) logs.</p>
            </div>
        </div>
    </div>

    <script>
        function showTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));
            
            document.getElementById(tabId + '-tab').style.display = 'block';
            document.querySelector(`.tab-button[onclick*='${tabId}']`).classList.add('active');

            const liveImg = document.getElementById('liveVideoFeed');
            if (tabId === 'livecam') {
                liveImg.src = "/api/video_feed/";
            } else {
                liveImg.src = "";
            }
        }
        
        showTab('upload'); 

        async function processUpload() {
            const fileInput = document.getElementById('imageUpload');
            const outputImg = document.getElementById('output-image');
            const resultsDiv = document.getElementById('ocrResults');
            
            if (fileInput.files.length === 0) {
                alert('Please select an image file first.');
                return;
            }

            const file = fileInput.files[0];
            const formData = new FormData();
            formData.append("file", file);

            try {
                resultsDiv.innerHTML = `<p>Processing image...</p>`;
                resultsDiv.style.display = 'block';

                const response = await fetch('/api/upload/', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const ocrResultsHeader = response.headers.get('X-OCR-Results');
                const ocrData = JSON.parse(ocrResultsHeader);

                const blob = await response.blob();
                outputImg.src = URL.createObjectURL(blob);
                outputImg.style.display = 'block';

                resultsDiv.innerHTML = `<h3>✅ Detection Results:</h3>`;
                if (ocrData.length > 0) {
                    ocrData.forEach(item => {
                        resultsDiv.innerHTML += `<p>Plate: <strong>${item.plate || 'N/A'}</strong> (YOLO Conf: ${item.conf.toFixed(2)}, OCR Conf: ${item.ocr_conf.toFixed(2)})</p>`;
                    });
                } else {
                    resultsDiv.innerHTML += `<p>No license plate detected in the image.</p>`;
                }

            } catch (error) {
                console.error("Error processing image:", error);
                resultsDiv.innerHTML = `<p style="color:red;">❌ Failed to process image. Details: ${error.message}</p>`;
            }
        }
    </script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(content=HTML_TEMPLATE)

# ==========================================================

if __name__ == "__main__":
    import uvicorn
    print("🚀 Running LPR API. Go to http://127.0.0.1:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)