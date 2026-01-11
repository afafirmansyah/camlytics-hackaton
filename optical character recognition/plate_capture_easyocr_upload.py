"""
AI License Plate Recognition (LPR) System - All-in-One File
- Incorporates: FastAPI API, YOLOv8, EasyOCR (Optimized), Detection Stability, MQTT, and Web UI.
- FIXES: Improved camera aspect ratio, enhanced OCR, corrected MQTT/Debug saving.
- NEW: Modern Minimalist UI using Tailwind CSS and Debug Capture Gallery.
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
from fastapi import FastAPI, UploadFile, File, Response, Depends
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse
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
    # Camera Resolution for Fixing Aspect Ratio
    "CAM_WIDTH": int(os.getenv('CAM_WIDTH', 1280)), 
    "CAM_HEIGHT": int(os.getenv('CAM_HEIGHT', 720)),
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
        """Processes the cropped image using CLAHE, blur, and thresholding for better OCR accuracy."""
        
        img_cv = np.array(pil_img.convert("RGB"))
        gray = cv2.cvtColor(img_cv, cv2.COLOR_RGB2GRAY)
        
        # Enhancement 1: Contrast Limited Adaptive Histogram Equalization (CLAHE)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4,4)) 
        normalized_img = clahe.apply(gray)
        
        # Enhancement 2: Optimized Gaussian Blur
        blur = cv2.GaussianBlur(normalized_img, (3, 3), 0)
        
        # Enhancement 3: Optimized Adaptive Threshold
        thresh = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                       cv2.THRESH_BINARY_INV, 15, 1)
        
        # Eksekusi EasyOCR 
        results = self.reader.readtext(thresh, detail=1, paragraph=False, 
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
        if not self.config['DEBUG_SAVE']: return
        
        try:
            ts = now_iso().replace(':', '-').split('.')[0] # Use only seconds for cleaner file name
            # Save detection crop (det)
            det_path = os.path.join("debug_capture", f"{ts}_{plate_text}_{tag}_det.jpg")
            crop_pil.save(det_path, quality=85)

            # Generate and save processed OCR image (ocr)
            img_cv = np.array(crop_pil.convert("RGB"))
            gray = cv2.cvtColor(img_cv, cv2.COLOR_RGB2GRAY)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4,4)) 
            normalized_img = clahe.apply(gray)
            blur = cv2.GaussianBlur(normalized_img, (3, 3), 0)
            thresh = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                           cv2.THRESH_BINARY_INV, 15, 1)

            ocr_path = os.path.join("debug_capture", f"{ts}_{plate_text}_{tag}_ocr.jpg")
            Image.fromarray(thresh).save(ocr_path, quality=85)
            print(f"   [DEBUG SAVE] Saved {det_path} and {ocr_path}")
        except Exception as e:
             print(f"⚠️ Failed to save debug images: {e}")
            
    # --- Main Processing Methods ---

    def process_image(self, bgr_image: np.ndarray, upload_mode: bool = False) -> List[Dict[str, Any]]:
        """Process a single image (upload mode), saves debug, and publishes results."""
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
                # Using 'upload_test' event type
                self.publish_event("upload_test", plate_text, ocr_conf, crop)
                
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
        
        # FIX: Set Camera Resolution Explicitly to prevent aspect ratio issues
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.config['CAM_WIDTH'])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config['CAM_HEIGHT'])
        
        print(f"Set resolution to {cap.get(cv2.CAP_PROP_FRAME_WIDTH)}x{cap.get(cv2.CAP_PROP_FRAME_HEIGHT)}")

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

# --- NEW ENDPOINT: Fetch Debug Files ---
@app.get("/api/debug_files/")
def get_debug_files():
    if not CONFIG['DEBUG_SAVE']:
        return JSONResponse(content={"error": "Debug saving is disabled."}, status_code=403)
    
    # Filter files and sort by timestamp (newest first)
    files = [f for f in os.listdir("debug_capture") if f.endswith(('.jpg', '.jpeg'))]
    
    # Use the timestamp prefix for sorting (YYYY-MM-DDTHH:MM:SS)
    files.sort(key=lambda x: x.split('_')[0], reverse=True)
    
    # Structure data to easily match det/ocr pairs in frontend
    debug_data = []
    
    # Group pairs (det/ocr) and limit to top 10 results
    temp_dict = {}
    for f in files:
        parts = f.rsplit('_', 2) # Splits by the last two underscores
        if len(parts) < 3: continue
        
        base_name = parts[0] + '_' + parts[1] # e.g., 2025-11-11T10:00:00_PLATEID_tag
        file_type = parts[2].split('.')[0]    # e.g., det or ocr
        
        if base_name not in temp_dict:
            temp_dict[base_name] = {'det': None, 'ocr': None, 'plate': parts[1], 'timestamp': parts[0].replace('T', ' ')}
        
        if file_type == 'det':
            temp_dict[base_name]['det'] = f
        elif file_type == 'ocr':
            temp_dict[base_name]['ocr'] = f
            
    # Add pairs to final list (only complete pairs are needed for the gallery)
    for key, data in temp_dict.items():
        if data['det'] and data['ocr']:
            debug_data.append(data)
            
    # Return top 10 (or desired limit)
    return debug_data[:10]

# --- NEW ENDPOINT: Serve individual debug files ---
@app.get("/debug_capture/{filename}")
async def serve_debug_file(filename: str):
    file_path = os.path.join("debug_capture", filename)
    if not os.path.exists(file_path):
        return Response(status_code=404)
    # Ensure the file is served with the correct image type
    return FileResponse(file_path, media_type="image/jpeg")


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

# --- Endpoint 2: Video Feed ---
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


# --- Endpoint 3: UI (HTML - Tailwind Modern Dashboard) ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LPR Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        /* Custom styles for the minimal dashboard */
        .tab-button { transition: all 0.2s; }
        .tab-button.active { border-color: #3b82f6; color: #3b82f6; background-color: #eff6ff; }
        .debug-image-container { display: flex; flex-direction: column; }
    </style>
</head>
<body class="bg-gray-50 min-h-screen p-4 md:p-8">
    <div class="max-w-7xl mx-auto bg-white shadow-xl rounded-lg p-6">
        <h1 class="text-3xl font-bold text-center text-gray-800 mb-6 flex items-center justify-center">
            <svg class="w-8 h-8 mr-2 text-indigo-500" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zM5 9a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd" fill-rule="evenodd"></path></svg>
            AI License Plate Recognition Dashboard
        </h1>

        <div class="flex justify-center border-b border-gray-200 mb-6">
            <button class="tab-button py-2 px-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300" onclick="showTab('upload')">
                Upload Testing Image
            </button>
            <button class="tab-button py-2 px-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300" onclick="showTab('livecam')">
                Live Camera Processing
            </button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div class="lg:col-span-2">
                
                <div id="upload-tab" class="tab-content bg-gray-50 p-4 rounded-lg border">
                    <h2 class="text-xl font-semibold mb-4 text-gray-700">Test Image Analysis</h2>
                    <input type="file" id="imageUpload" accept="image/*" class="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 mb-4">
                    <button onclick="processUpload()" class="w-full py-2 px-4 bg-indigo-600 text-white font-medium rounded-lg shadow hover:bg-indigo-700 transition duration-150">
                        Process Image
                    </button>

                    <img id="output-image" class="mt-6 w-full max-h-96 object-contain rounded-lg shadow-md border" style="display:none;" alt="Processed Image">
                    <div id="ocrResults" class="mt-4 results bg-white border-l-4 border-indigo-400 p-3 rounded-md shadow-sm" style="display:none;"></div>
                </div>

                <div id="livecam-tab" class="tab-content" style="display:none;">
                    <div class="bg-gray-900 p-2 rounded-lg shadow-md border border-gray-700">
                        <img id="liveVideoFeed" class="w-full object-contain max-h-[500px] rounded-md" src="" alt="Live Video Feed">
                    </div>
                    <p class="text-xs text-gray-500 mt-2 text-center">Video stream for real-time monitoring. MQTT logs appear in the console upon plate confirmation.</p>
                </div>
            </div>

            <div class="lg:col-span-1 bg-white p-4 rounded-lg shadow-md border">
                <h2 class="text-xl font-semibold text-gray-700 mb-4 border-b pb-2">Recent Debug Captures</h2>
                <div id="debugGallery" class="space-y-4">
                    <p class="text-gray-500 text-sm">Loading captures...</p>
                </div>
            </div>
        </div>
    </div>

    <script>
        const API_URL = window.location.origin;

        function showTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active', 'border-indigo-500', 'text-indigo-600', 'bg-indigo-50'));
            
            document.getElementById(tabId + '-tab').style.display = 'block';
            document.querySelector(`.tab-button[onclick*='${tabId}']`).classList.add('active', 'border-indigo-500', 'text-indigo-600', 'bg-indigo-50');

            const liveImg = document.getElementById('liveVideoFeed');
            if (tabId === 'livecam') {
                liveImg.src = "/api/video_feed/";
                fetchDebugFiles(); // Start fetching debug files
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
                resultsDiv.innerHTML = `<p class="text-indigo-600 flex items-center"><svg class="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 15m15.356-2H15m-5 3v5h.582"></path></svg>Processing image...</p>`;
                resultsDiv.style.display = 'block';
                outputImg.style.display = 'none';

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

                resultsDiv.innerHTML = `<h3 class="text-lg font-bold text-green-600 mb-2">✅ Detection Results:</h3>`;
                if (ocrData.length > 0) {
                    ocrData.forEach(item => {
                        resultsDiv.innerHTML += `<div class="p-2 border-b border-gray-100 text-sm"><span class="font-semibold text-gray-800">Plate: ${item.plate || 'N/A'}</span> (YOLO: ${item.conf.toFixed(2)}, OCR: ${item.ocr_conf.toFixed(2)})</div>`;
                    });
                } else {
                    resultsDiv.innerHTML += `<p class="text-red-500">No license plate detected in the image.</p>`;
                }
                fetchDebugFiles(); // Refresh gallery after upload
            } catch (error) {
                console.error("Error processing image:", error);
                resultsDiv.innerHTML = `<p class="text-red-600">❌ Failed to process image. Check console for details.</p>`;
            }
        }

        async function fetchDebugFiles() {
            const gallery = document.getElementById('debugGallery');
            try {
                const response = await fetch('/api/debug_files/');
                if (!response.ok) {
                    gallery.innerHTML = '<p class="text-red-500 text-sm">Error fetching debug files.</p>';
                    return;
                }
                const files = await response.json();
                
                if (files.length === 0) {
                    gallery.innerHTML = '<p class="text-gray-500 text-sm">No confirmed plates captured yet.</p>';
                    return;
                }

                gallery.innerHTML = files.map(item => `
                    <div class="border rounded-lg shadow-sm p-3 bg-white hover:shadow-md transition">
                        <p class="text-base font-bold text-indigo-600 mb-2">${item.plate} <span class="text-xs font-normal text-gray-500 ml-2">${item.timestamp}</span></p>
                        <div class="grid grid-cols-2 gap-2 text-center text-xs">
                            <div class="debug-image-container">
                                <span class="text-gray-600 font-semibold mb-1">Detection Crop</span>
                                <img class="w-full h-auto object-contain border rounded" src="/debug_capture/${item.det}" alt="Detection">
                            </div>
                            <div class="debug-image-container">
                                <span class="text-gray-600 font-semibold mb-1">OCR Pre-process</span>
                                <img class="w-full h-auto object-contain border rounded" src="/debug_capture/${item.ocr}" alt="OCR">
                            </div>
                        </div>
                    </div>
                `).join('');
            } catch (error) {
                console.error("Error fetching debug files:", error);
            }
        }
        
        // Polling for continuous update of the debug gallery when Live Cam is active
        setInterval(() => {
            if (document.getElementById('livecam-tab').style.display !== 'none') {
                fetchDebugFiles();
            }
        }, 5000); // Refresh gallery every 5 seconds
    </script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(content=HTML_TEMPLATE)

# Static file mount for serving debug images directly (Crucial for the Gallery)
app.mount("/debug_capture", StaticFiles(directory="debug_capture"), name="debug_capture")

# ==========================================================

if __name__ == "__main__":
    import uvicorn
    print("🚀 Running LPR API. Go to http://127.0.0.1:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)