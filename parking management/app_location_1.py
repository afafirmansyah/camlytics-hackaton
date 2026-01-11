import cv2
import os
import tkinter as tk
from tkinter import filedialog, messagebox
from PIL import Image, ImageTk
from ultralytics import solutions

class ParkingApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Parking Detection System - Location 1")
        self.root.geometry("800x600")

        # Create result folder
        self.result_folder = "result"
        os.makedirs(self.result_folder, exist_ok=True)

        # Initialize Parking Manager
        self.parkingmanager = solutions.ParkingManagement(
            model=r"C:\Users\Fauzi.HEC\Desktop\Hackaton\parking_management\visdrone-best.pt",
            json_file=r"C:\Users\Fauzi.HEC\Desktop\Hackaton\parking_management\bounding_boxes_location_1.json",
        )

        self.setup_ui()

    def setup_ui(self):
        upload_btn = tk.Button(
            self.root, text="Upload Image", command=self.upload_image,
            bg="blue", fg="white", font=("Arial", 12)
        )
        upload_btn.pack(pady=20)

        self.image_frame = tk.Frame(self.root)
        self.image_frame.pack(pady=10)

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
        max_size = 500
        if width > max_size or height > max_size:
            scale = min(max_size / width, max_size / height)
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

def main():
    root = tk.Tk()
    app = ParkingApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()
