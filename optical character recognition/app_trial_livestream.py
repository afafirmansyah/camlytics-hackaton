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

# ========== CONFIGURATION ==========
YOLO_MODEL_PATH = "license_plate_detector.pt"
CAMERA_SOURCE = 0
CONFIDENCE_THRESHOLD = 0.5
FRAME_SKIP = 3
STABILITY_COUNT = 3      # min frames a plate must appear to confirm
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
client = mqtt.Client()
client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
client.loop_start()


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

    client.publish(MQTT_TOPIC, json.dumps(payload), qos=1)
    print(f"[MQTT] {event_type.upper()} - {plate_text} ({confidence:.2f})")


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


# --- Detection State ---
plates_seen = {}
confirmed_plates = set()
lock = threading.Lock()


def exit_watcher():
    while True:
        now_ts = time.time()
        with lock:
            expired = [p for p, v in plates_seen.items() if now_ts - v["last_seen"] > EXIT_TIMEOUT]
            for pid in expired:
                del plates_seen[pid]
        time.sleep(1.0)


def detection_loop():
    cap = cv2.VideoCapture(CAMERA_SOURCE)
    yolo = YOLO(YOLO_MODEL_PATH)
    frame_idx = 0

    print("🎥 Starting camera stream... Press ESC to stop.")
    while True:
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

                if DEBUG_SAVE:
                    crop.save(f"debug_capture/{now_iso().replace(':','-')}_{plate_text}.jpg")

                # Stability tracking
                with lock:
                    if plate_text not in plates_seen:
                        plates_seen[plate_text] = {"count": 1, "last_seen": time.time(), "conf": conf, "texts": [plate_text]}
                    else:
                        plates_seen[plate_text]["count"] += 1
                        plates_seen[plate_text]["last_seen"] = time.time()
                        plates_seen[plate_text]["conf"] = max(plates_seen[plate_text]["conf"], conf)
                        plates_seen[plate_text]["texts"].append(plate_text)

                    # Confirm plate once stable
                    if plates_seen[plate_text]["count"] >= STABILITY_COUNT and plate_text not in confirmed_plates:
                        texts = plates_seen[plate_text]["texts"]
                        final_text = max(set(texts), key=texts.count)
                        confirmed_plates.add(final_text)
                        publish_event("entry", final_text, plates_seen[plate_text]["conf"], crop)

                # Draw for visualization
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(frame, plate_text, (x1, y1 - 5),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        cv2.imshow("YOLO License Plate Capture (EasyOCR)", frame)
        if cv2.waitKey(1) & 0xFF == 27:
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    print("🚗 YOLO License Plate MQTT started (EasyOCR Stable Mode)...")
    t = threading.Thread(target=exit_watcher, daemon=True)
    t.start()
    detection_loop()
