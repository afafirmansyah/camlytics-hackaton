import cv2
import os
import tkinter as tk
from tkinter import filedialog, messagebox
from PIL import Image, ImageTk
from ultralytics import solutions
import threading
import yt_dlp
from datetime import datetime, timedelta
import time

class ParkingApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Parking Detection System - Location 2")
        self.root.state('zoomed')  # Fullscreen on Windows

        # Create result folder
        self.result_folder = "result"
        os.makedirs(self.result_folder, exist_ok=True)

        # Initialize Parking Manager
        self.parkingmanager = solutions.ParkingManagement(
            model=r"C:\Users\Fauzi.HEC\Desktop\Hackaton\parking_management\visdrone-best.pt",
            json_file=r"C:\Users\Fauzi.HEC\Desktop\Hackaton\parking_management\bounding_boxes_location_2.json",
        )

        self.streaming = False
        self.cap = None
        self.parking_start_times = {}  # Track when each spot was occupied
        self.setup_ui()

    def setup_ui(self):
        # Button frame
        btn_frame = tk.Frame(self.root)
        btn_frame.pack(pady=20)
        
        upload_btn = tk.Button(
            btn_frame, text="Upload Image", command=self.upload_image,
            bg="blue", fg="white", font=("Arial", 12)
        )
        upload_btn.pack(side=tk.LEFT, padx=10)
        
        self.stream_btn = tk.Button(
            btn_frame, text="Start YouTube Stream", command=self.toggle_stream,
            bg="green", fg="white", font=("Arial", 12)
        )
        self.stream_btn.pack(side=tk.LEFT, padx=10)

        self.image_frame = tk.Frame(self.root)
        self.image_frame.pack(fill=tk.BOTH, expand=True, pady=10)

        self.result_label = tk.Label(self.root, text="No image processed", font=("Arial", 10))
        self.result_label.pack(pady=10)

    def upload_image(self):
        file_path = filedialog.askopenfilename(
            title="Select Image",
            filetypes=[("Image files", "*.jpg *.jpeg *.png *.bmp")]
        )
        if file_path:
            self.process_image(file_path)

    def process_image(self, image_path):
        try:
            image = cv2.imread(image_path)
            results = self.parkingmanager(image)
            
            # Get parking stats from parkingmanager
            occupied = self.parkingmanager.pr_info["Occupancy"]
            available = self.parkingmanager.pr_info["Available"]
            
            # Print to terminal
            print(f"Occupancy: {occupied}")
            print(f"Available: {available}")
            
            # Save result
            filename = os.path.basename(image_path)
            result_path = os.path.join(self.result_folder, f"result_{filename}")
            cv2.imwrite(result_path, results.plot_im)
            
            # Display result
            self.display_image(results.plot_im)
            
            # Update result label
            self.result_label.config(text=f"Occupancy: {occupied} | Available: {available}")
            
            messagebox.showinfo("Success", f"Image processed and saved to {result_path}")
            
        except Exception as e:
            messagebox.showerror("Error", f"Failed to process image: {str(e)}")

    def display_image(self, cv_image):
        rgb_image = cv2.cvtColor(cv_image, cv2.COLOR_BGR2RGB)
        height, width = rgb_image.shape[:2]
        
        # Get screen size minus space for buttons and labels
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight() - 150  # Reserve space for UI elements
        
        # Scale image to fit screen while maintaining aspect ratio
        scale = min(screen_width / width, screen_height / height)
        new_width = int(width * scale)
        new_height = int(height * scale)
        rgb_image = cv2.resize(rgb_image, (new_width, new_height))

        pil_image = Image.fromarray(rgb_image)
        photo = ImageTk.PhotoImage(pil_image)

        for widget in self.image_frame.winfo_children():
            widget.destroy()

        image_label = tk.Label(self.image_frame, image=photo)
        image_label.image = photo
        image_label.pack()

    def get_youtube_stream_url(self, youtube_url):
        try:
            ydl_opts = {
                'format': 'best[height<=1080]',
                'quiet': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(youtube_url, download=False)
                return info['url']
        except Exception as e:
            messagebox.showerror("Error", f"Failed to get stream URL: {str(e)}")
            return None

    def toggle_stream(self):
        if not self.streaming:
            self.start_stream()
        else:
            self.stop_stream()

    def start_stream(self):
        youtube_url = "https://www.youtube.com/watch?v=EPKWu223XEg"
        stream_url = self.get_youtube_stream_url(youtube_url)
        
        if stream_url:
            self.streaming = True
            self.stream_btn.config(text="Stop Stream", bg="red")
            self.stream_thread = threading.Thread(target=self.process_stream, args=(stream_url,))
            self.stream_thread.daemon = True
            self.stream_thread.start()

    def stop_stream(self):
        self.streaming = False
        if self.cap:
            self.cap.release()
        self.parking_start_times.clear()  # Reset parking times
        self.stream_btn.config(text="Start YouTube Stream", bg="green")
        self.result_label.config(text="Stream stopped")

    def process_stream(self, stream_url):
        self.cap = cv2.VideoCapture(stream_url)
        
        # Optimize for real-time streaming
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Reduce buffer to minimize delay
        self.cap.set(cv2.CAP_PROP_FPS, 30)  # Set target FPS
        
        if not self.cap.isOpened():
            messagebox.showerror("Error", "Failed to open stream")
            self.stop_stream()
            return

        frame_count = 0
        start_time = time.time()
        
        while self.streaming:
            ret, frame = self.cap.read()
            if not ret:
                # Skip frame and continue
                continue

            frame_count += 1
            
            # Process every frame for real-time detection
            try:
                # Process frame with parking detection
                results = self.parkingmanager(frame)
                
                # Get parking stats
                occupied = self.parkingmanager.pr_info["Occupancy"]
                available = self.parkingmanager.pr_info["Available"]
                
                # Add duration overlay to frame
                frame_with_duration = self.add_duration_overlay(results.plot_im)
                
                # Calculate and display FPS at bottom left corner
                elapsed_time = time.time() - start_time
                if elapsed_time > 0:
                    fps = frame_count / elapsed_time
                    cv2.putText(frame_with_duration, f"FPS: {fps:.1f}", 
                               (10, frame_with_duration.shape[0] - 10), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                
                # Update UI in main thread (non-blocking)
                self.root.after_idle(self.update_stream_display, frame_with_duration, occupied, available)
                
                # Small delay to prevent overwhelming the UI thread
                time.sleep(0.01)  # 10ms delay for ~100 FPS max
                
            except Exception as e:
                print(f"Error processing frame: {e}")
                continue

        if self.cap:
            self.cap.release()

    def add_duration_overlay(self, frame):
        current_time = datetime.now()
        
        # Track parking durations (simplified - using occupancy count as spot ID)
        if hasattr(self.parkingmanager, 'pr_info') and 'Occupancy' in self.parkingmanager.pr_info:
            occupied_count = self.parkingmanager.pr_info['Occupancy']
            
            # Update parking times
            for spot_id in range(occupied_count):
                if spot_id not in self.parking_start_times:
                    self.parking_start_times[spot_id] = current_time
            
            # Remove spots that are no longer occupied
            spots_to_remove = []
            for spot_id in self.parking_start_times:
                if spot_id >= occupied_count:
                    spots_to_remove.append(spot_id)
            for spot_id in spots_to_remove:
                del self.parking_start_times[spot_id]
        
        # Add parking text overlay (without duration numbers)
        y_offset = 30
        for spot_id, start_time in self.parking_start_times.items():
            duration_text = "Parkir"
            
            cv2.putText(frame, duration_text, (10, y_offset), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            y_offset += 25
            minutes = int((duration.total_seconds() % 3600) // 60)
            duration_text = f"Spot {spot_id+1}: {hours:02d}:{minutes:02d}"
            
            cv2.putText(frame, duration_text, (10, y_offset), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            y_offset += 25
        
        return frame

    def update_stream_display(self, processed_frame, occupied, available):
        if self.streaming:
            try:
                self.display_image(processed_frame)
                self.result_label.config(text=f"LIVE - Occupancy: {occupied} | Available: {available}")
            except Exception as e:
                print(f"Error updating display: {e}")

def main():
    root = tk.Tk()
    app = ParkingApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()
