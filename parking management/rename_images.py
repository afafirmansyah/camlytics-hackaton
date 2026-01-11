import os

# Path folder dataset
folder_path = r"C:\Users\Fauzi.HEC\Desktop\New\dataset"

# Ambil semua file di folder
files = [f for f in os.listdir(folder_path) if os.path.isfile(os.path.join(folder_path, f))]

# Urutkan berdasarkan nama file (bisa diubah ke sorted by date modified kalau mau)
files.sort()

# Ganti nama satu per satu
for index, filename in enumerate(files, start=1):
    # Pisahkan ekstensi file
    _, ext = os.path.splitext(filename)
    new_name = f"{index}{ext}"
    
    # Path lama dan baru
    old_path = os.path.join(folder_path, filename)
    new_path = os.path.join(folder_path, new_name)
    
    os.rename(old_path, new_path)

print("✅ Semua nama file berhasil diubah menjadi angka urut mulai dari 1.")
