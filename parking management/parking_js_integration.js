/**
 * Parking Detection JavaScript Integration
 * Minimal JavaScript class for parking detection API integration
 */

class ParkingDetector {
    constructor(apiBaseUrl = 'http://localhost:8001') {
        this.apiBase = apiBaseUrl;
    }

    /**
     * Detect parking from image file
     * @param {File} imageFile - Image file to process
     * @returns {Promise<Object>} Detection results
     */
    async detectParking(imageFile) {
        const formData = new FormData();
        formData.append('file', imageFile);

        const response = await fetch(`${this.apiBase}/api/parking/detect`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Get parking status
     * @returns {Promise<Object>} Status information
     */
    async getStatus() {
        const response = await fetch(`${this.apiBase}/api/parking/status`);
        return await response.json();
    }

    /**
     * Get result image URL
     * @param {string} filename - Result filename
     * @returns {string} Image URL
     */
    getResultImageUrl(filename) {
        return `${this.apiBase}/api/parking/result/${filename}`;
    }

    async getStats() {
        const response = await fetch(`${this.apiBase}/api/parking/stats`);
        return await response.json();
    }
}

// Usage example:
/*
const detector = new ParkingDetector();

// Detect parking from file input
document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        try {
            const result = await detector.detectParking(file);
            console.log('Parking stats:', result.data);
            // Display result.data.result_image
        } catch (error) {
            console.error('Detection failed:', error);
        }
    }
});
*/