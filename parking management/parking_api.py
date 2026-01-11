import cv2
import os
import json
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import solutions
import base64
from io import BytesIO
from PIL import Image

app = FastAPI(title="Parking Detection API")

# Enable CORS for JavaScript integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize result folder
RESULT_FOLDER = "parking_results"
os.makedirs(RESULT_FOLDER, exist_ok=True)

# Initialize Parking Manager
parkingmanager = solutions.ParkingManagement(
    model=r"C:\Users\Fauzi.HEC\Desktop\Hackaton\parking_management\visdrone-best.pt",
    json_file=r"C:\Users\Fauzi.HEC\Desktop\Hackaton\parking_management\bounding_boxes_location_1.json",
)

@app.post("/api/parking/detect")
async def detect_parking(file: UploadFile = File(...)):
    """Process uploaded image and return parking detection results"""
    try:
        # Read uploaded image
        content = await file.read()
        nparr = np.frombuffer(content, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image format")
        
        # Process image
        results = parkingmanager(image)
        
        # Get parking stats
        occupied = parkingmanager.pr_info["Occupancy"]
        available = parkingmanager.pr_info["Available"]
        total = occupied + available
        
        # Save result image
        filename = f"parking_result_{file.filename}"
        result_path = os.path.join(RESULT_FOLDER, filename)
        cv2.imwrite(result_path, results.plot_im)
        
        # Convert result image to base64 for JavaScript
        _, buffer = cv2.imencode('.jpg', results.plot_im)
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return JSONResponse({
            "success": True,
            "data": {
                "occupied": occupied,
                "available": available,
                "total": total,
                "occupancy_rate": round((occupied / total * 100), 1) if total > 0 else 0,
                "result_image": f"data:image/jpeg;base64,{img_base64}",
                "filename": filename
            }
        })
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/parking/result/{filename}")
async def get_result_image(filename: str):
    """Serve result image file"""
    file_path = os.path.join(RESULT_FOLDER, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, media_type="image/jpeg")

@app.get("/api/parking/status")
async def get_parking_status():
    """Get current parking status"""
    return JSONResponse({
        "location": "Location 1",
        "status": "active",
        "model_loaded": True
    })

@app.get("/api/parking/stats")
def get_parking_stats():
    """Get current parking statistics"""
    if not hasattr(parkingmanager, 'pr_info') or not parkingmanager.pr_info:
        return {"total": 0, "occupied": 0, "available": 0, "occupancy_rate": 0}
    
    occupied = parkingmanager.pr_info.get("Occupancy", 0)
    available = parkingmanager.pr_info.get("Available", 0)
    total = occupied + available
    
    return {
        "total": total,
        "occupied": occupied,
        "available": available,
        "occupancy_rate": round((occupied / total * 100), 1) if total > 0 else 0
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)