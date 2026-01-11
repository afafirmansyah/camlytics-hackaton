"""
License Plate Capture - Stable OCR (EasyOCR) + MQTT
- YOLOv8 + EasyOCR + Stabilized Detection + MQTT
- Designed for consistent and accurate plate recognition
"""

import cv2
import time
import base64
import json
import threading
from io import BytesIO
from datetime import datetime, timezone
import numpy as np
from ultralytics import YOLO
from PIL import Image
import paho.mqtt.client as mqtt
import os
import easyocr
from typing import List, Dict, Any

# ========== CONFIGURATION ==========
YOLO_MODEL_PATH = "license_plate_detector.pt"
CAMERA_SOURCE = 0
CONFIDENCE_THRESHOLD = 0.5
FRAME_SKIP = 5
STABILITY_COUNT = 5      # min frames a plate must appear to confirm
EXIT_TIMEOUT = 15.0      # seconds to forget unseen plates

# MQTT
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
MQTT_TOPIC = "test/parking/licenseplate"

# OCR (EasyOCR)
OCR_LANGS = ['en']  # English/alphanumeric plates
reader = easyocr.Reader(OCR_LANGS, gpu=False)

# Image handling
PUBLISH_IMAGE_BASE64 = True
CROP_PAD = 0.08
DEBUG_SAVE = True  # Save cropped plates for debugging
os.makedirs("debug_capture", exist_ok=True)
# ==================================


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat()


# --- MQTT Client ---
# --- MQTT Client ---
MQTT_ENABLED = os.getenv('MQTT_ENABLED', '1') != '0'
if MQTT_ENABLED:
    client = mqtt.Client()
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        client.loop_start()
    except Exception as e:
        # Don't crash if broker unavailable in dev/test
        print(f"⚠️ Could not connect to MQTT broker: {e}")
        MQTT_ENABLED = False
else:
    client = None

# Lazy-loaded YOLO model (for upload processing)
_yolo_model = None


def get_yolo():
    global _yolo_model
    if _yolo_model is None:
        _yolo_model = YOLO(YOLO_MODEL_PATH)
    return _yolo_model


def publish_event(event_type, plate_text, confidence, crop_img):
    payload = {
        "plate": plate_text,
        "event": event_type,
        "confidence": float(confidence),
        "timestamp": now_iso()
    }
    if PUBLISH_IMAGE_BASE64 and crop_img is not None:
        buf = BytesIO()
        crop_img.save(buf, format="JPEG")
        b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
        payload["image_base64"] = b64

    if MQTT_ENABLED and client is not None:
        try:
            client.publish(MQTT_TOPIC, json.dumps(payload), qos=1)
            print(f"[MQTT] {event_type.upper()} - {plate_text} ({confidence:.2f})")
        except Exception as e:
            print(f"⚠️ Failed to publish MQTT: {e}")
    else:
        # MQTT disabled; log to stdout for dev
        print(f"[MQTT disabled] {event_type.upper()} - {plate_text} ({confidence:.2f})")


# --- OCR with EasyOCR ---
def run_ocr(pil_img):
    img_cv = np.array(pil_img.convert("RGB"))
    results = reader.readtext(img_cv, detail=1, paragraph=False)

    if not results:
        return ""

    # Pilih teks dengan confidence tertinggi
    best_text = max(results, key=lambda r: r[2])[1]
    best_text = "".join([c for c in best_text if c.isalnum()]).upper()

    return best_text


def crop_with_padding(image, box, pad_frac=CROP_PAD):
    x1, y1, x2, y2 = box
    h, w = image.shape[:2]
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


def save_debug_images(crop_pil, plate_text):
    """Save two images for a confirmed plate:
    - detection crop (color)
    - processed OCR image (grayscale, upscaled, filtered, thresholded)
    """
    ts = now_iso().replace(':', '-')
    det_path = os.path.join("debug_capture", f"{ts}_{plate_text}_det.jpg")
    ocr_path = os.path.join("debug_capture", f"{ts}_{plate_text}_ocr.jpg")

    # Save color detection crop
    crop_pil.save(det_path, quality=85)

    # Prepare processed OCR image
    try:
        rgb = np.array(crop_pil.convert('RGB'))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        h, w = gray.shape
        # upscale to help OCR on small plates
        scale = 2
        gray_up = cv2.resize(gray, (w * scale, h * scale), interpolation=cv2.INTER_LINEAR)
        filtered = cv2.bilateralFilter(gray_up, 9, 75, 75)
        th = cv2.adaptiveThreshold(filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY, 11, 2)
        Image.fromarray(th).save(ocr_path, quality=85)
    except Exception:
        # fallback: save original crop as OCR image
        crop_pil.save(ocr_path, quality=85)


def process_image(bgr_image, save_debug: bool = True, upload_mode: bool = False) -> List[Dict[str, Any]]:
    """Process a single BGR image (numpy array). Returns list of detection dicts:
    [{ 'plate': str, 'conf': float, 'bbox': (x1,y1,x2,y2), 'det_path': str or None, 'ocr_path': str or None }]
    If upload_mode is True, saved debug images will include 'upload' tag and won't mark recorded_plates.
    """
    yolo = get_yolo()
    results = yolo.predict(bgr_image, conf=CONFIDENCE_THRESHOLD, verbose=False)
    detections = []

    for r in results:
        for box in r.boxes:
            conf = float(box.conf[0])
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            crop = crop_with_padding(bgr_image, (x1, y1, x2, y2))
            if crop is None:
                continue

            plate_text = run_ocr(crop)
            if len(plate_text) < 1:
                continue

            det_path = None
            ocr_path = None
            # Save debug images for upload/test mode without marking recorded_plates
            if save_debug:
                try:
                    ts = now_iso().replace(':', '-')
                    tag = 'upload' if upload_mode else 'proc'
                    det_path = os.path.join('debug_capture', f"{ts}_{plate_text}_{tag}_det.jpg")
                    ocr_path = os.path.join('debug_capture', f"{ts}_{plate_text}_{tag}_ocr.jpg")
                    crop.save(det_path, quality=85)
                    # try to produce processed OCR image
                    try:
                        rgb = np.array(crop.convert('RGB'))
                        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
                        h, w = gray.shape
                        gray_up = cv2.resize(gray, (w * 2, h * 2), interpolation=cv2.INTER_LINEAR)
                        filtered = cv2.bilateralFilter(gray_up, 9, 75, 75)
                        th = cv2.adaptiveThreshold(filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                                   cv2.THRESH_BINARY, 11, 2)
                        Image.fromarray(th).save(ocr_path, quality=85)
                    except Exception:
                        crop.save(ocr_path, quality=85)
                except Exception:
                    det_path = None
                    ocr_path = None

            detections.append({
                'plate': plate_text,
                'conf': conf,
                'bbox': (x1, y1, x2, y2),
                'det_path': det_path,
                'ocr_path': ocr_path,
            })

    return detections


# --- Detection State ---
plates_seen = {}
confirmed_plates = set()
recorded_plates = set()
lock = threading.Lock()

# For web streaming: latest JPEG frame (bytes) and camera thread control
latest_frame_jpeg = None
_camera_thread = None
_camera_thread_stop = threading.Event()


def exit_watcher():
    while True:
        now_ts = time.time()
        with lock:
            expired = [p for p, v in plates_seen.items() if now_ts - v["last_seen"] > EXIT_TIMEOUT]
            for pid in expired:
                del plates_seen[pid]
        time.sleep(1.0)


def _encode_frame_jpeg(frame):
    try:
        ret, jpeg = cv2.imencode('.jpg', frame)
        if not ret:
            return None
        return jpeg.tobytes()
    except Exception:
        return None


def detection_loop(display: bool = True, stream: bool = True):
    """Run camera detection loop.
    - display: if True, show cv2.imshow window
    - stream: if True, set latest_frame_jpeg for web streaming
    """
    global latest_frame_jpeg
    cap = cv2.VideoCapture(CAMERA_SOURCE)
    yolo = YOLO(YOLO_MODEL_PATH)
    frame_idx = 0

    print("🎥 Starting camera processor (headless=%s, stream=%s)" % (not display, stream))
    while not _camera_thread_stop.is_set():
        ret, frame = cap.read()
        if not ret:
            print("⚠️  Failed to read camera frame")
            time.sleep(0.3)
            continue

        frame_idx += 1
        if frame_idx % FRAME_SKIP != 0:
            continue

        results = yolo.predict(frame, conf=CONFIDENCE_THRESHOLD, verbose=False)

        for r in results:
            for box in r.boxes:
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                crop = crop_with_padding(frame, (x1, y1, x2, y2))
                if crop is None:
                    continue

                # Run EasyOCR
                plate_text = run_ocr(crop)
                if len(plate_text) < 4:
                    continue

                # Stability tracking (collect texts over consecutive frames)
                with lock:
                    if plate_text not in plates_seen:
                        plates_seen[plate_text] = {"count": 1, "last_seen": time.time(), "conf": conf, "texts": [plate_text]}
                    else:
                        plates_seen[plate_text]["count"] += 1
                        plates_seen[plate_text]["last_seen"] = time.time()
                        plates_seen[plate_text]["conf"] = max(plates_seen[plate_text]["conf"], conf)
                        plates_seen[plate_text]["texts"].append(plate_text)

                    # Confirm plate once stable and not already recorded
                    if plates_seen[plate_text]["count"] >= STABILITY_COUNT:
                        texts = plates_seen[plate_text]["texts"]
                        final_text = max(set(texts), key=texts.count)
                        if final_text not in confirmed_plates:
                            confirmed_plates.add(final_text)
                            # Save debug images only once per confirmed plate
                            if DEBUG_SAVE and final_text not in recorded_plates:
                                try:
                                    save_debug_images(crop, final_text)
                                    recorded_plates.add(final_text)
                                except Exception as e:
                                    print(f"⚠️  Failed saving debug images: {e}")

                            publish_event("entry", final_text, plates_seen[plate_text]["conf"], crop)

                # Draw for visualization
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(frame, plate_text, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        # update latest frame for streaming
        if stream:
            latest = _encode_frame_jpeg(frame)
            if latest is not None:
                latest_frame_jpeg = latest

        if display:
            cv2.imshow("YOLO License Plate Capture (EasyOCR)", frame)
            if cv2.waitKey(1) & 0xFF == 27:
                break

    cap.release()
    if display:
        cv2.destroyAllWindows()


def start_camera_in_thread(stream: bool = False, display: bool = False):
    global _camera_thread, _camera_thread_stop
    if _camera_thread and _camera_thread.is_alive():
        print("Camera thread already running")
        return
    _camera_thread_stop.clear()
    _camera_thread = threading.Thread(target=detection_loop, kwargs={'display': display, 'stream': stream}, daemon=True)
    _camera_thread.start()


def stop_camera_thread():
    global _camera_thread_stop, _camera_thread
    _camera_thread_stop.set()
    if _camera_thread:
        _camera_thread.join(timeout=2.0)


if __name__ == "__main__":
    print("🚗 YOLO License Plate MQTT started (EasyOCR Stable Mode)...")
    t = threading.Thread(target=exit_watcher, daemon=True)
    t.start()
    detection_loop()
