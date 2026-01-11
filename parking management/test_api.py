import requests

# Test API endpoints
base_url = "http://localhost:8001"

# Test status
try:
    response = requests.get(f"{base_url}/api/parking/status")
    print("Status:", response.status_code, response.json())
except Exception as e:
    print("Status error:", e)

# Test stats
try:
    response = requests.get(f"{base_url}/api/parking/stats")
    print("Stats:", response.status_code, response.json())
except Exception as e:
    print("Stats error:", e)