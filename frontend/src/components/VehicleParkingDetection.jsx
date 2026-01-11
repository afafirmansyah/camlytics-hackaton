import { useState, useRef } from 'react'
import { checkTokenAndHandleResponse } from '../utils/auth'
import { API_BASE_URL } from '../config'

function VehicleParkingDetection({ setToken }) {
  const [detectionMode, setDetectionMode] = useState('upload')
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)

  const startCamera = async () => {
    try {
      setCameraError('')
      setCameraActive(false)
      
      // Get all available video devices
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter(device => device.kind === 'videoinput')
      console.log('Available video devices:', videoDevices)
      
      // Find external camera
      let selectedDeviceId = undefined
      
      if (videoDevices.length > 1) {
        // Try to find external camera by label patterns
        const externalCamera = videoDevices.find(device => {
          const label = device.label.toLowerCase()
          return label.includes('usb') || 
                 label.includes('external') || 
                 label.includes('webcam') ||
                 label.includes('camera') && !label.includes('facetime') && !label.includes('integrated')
        })
        
        // If no specific external camera found, use the second camera (usually external)
        selectedDeviceId = externalCamera ? externalCamera.deviceId : videoDevices[1].deviceId
        console.log('Selected camera:', externalCamera ? externalCamera.label : videoDevices[1].label)
      } else {
        console.log('Only one camera available, using default')
      }
      
      const constraints = { 
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 }
        } 
      }
      
      if (selectedDeviceId) {
        constraints.video.deviceId = { exact: selectedDeviceId }
      }
      
      console.log('Camera constraints:', constraints)
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().then(() => {
            setCameraActive(true)
          }).catch(err => {
            setCameraError('Failed to start video playback')
          })
        }
      }
    } catch (error) {
      let errorMessage = 'Camera access failed'
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Camera permission denied. Please allow camera access.'
      }
      setCameraError(errorMessage)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraActive(false)
    setCameraError('')
  }

  const captureFrame = async () => {
    if (!videoRef.current || !cameraActive) return
    
    setAnalyzing(true)
    try {
      const video = videoRef.current
      const canvas = canvasRef.current || document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8)
      })
      
      const base64Image = await convertFileToBase64(blob)
      await analyzeVehicleParking(base64Image, 'camera')
      
    } catch (error) {
      setAnalysisResult({ error: 'Capture failed. Please try again.' })
    } finally {
      setAnalyzing(false)
    }
  }

  const handleFileSelect = (event) => {
    const file = event.target.files[0]
    if (file) {
      setSelectedFile(file)
      setAnalysisResult(null)
    }
  }

  const convertFileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result)
      reader.onerror = error => reject(error)
    })
  }

  const analyzeVehicleParking = async (base64Image, sourceType) => {
    try {
      const token = localStorage.getItem('token')
      
      const response = await fetch(`${API_BASE_URL}/detect/vehicle-parking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          image: base64Image,
          sourceType
        })
      })
      
      await checkTokenAndHandleResponse(response, setToken)
      const result = await response.json()
      setAnalysisResult(result)
      
    } catch (error) {
      setAnalysisResult({ error: 'Analysis failed. Please try again.' })
    }
  }

  const analyzeUploadedImage = async () => {
    if (!selectedFile) return
    
    setAnalyzing(true)
    try {
      const base64Image = await convertFileToBase64(selectedFile)
      await analyzeVehicleParking(base64Image, 'image')
    } catch (error) {
      setAnalysisResult({ error: 'Analysis failed. Please try again.' })
    } finally {
      setAnalyzing(false)
    }
  }

  const getParkingStatusDisplay = (status) => {
    switch(status) {
      case 'properly_parked': return { text: 'Perfectly Parked', icon: '✅', color: '#10b981' }
      case 'improperly_parked': return { text: 'Wrongly Parked', icon: '❌', color: '#ef4444' }
      default: return { text: status.replace(/_/g, ' '), icon: '❓', color: '#6b7280' }
    }
  }

  return (
    <div className="vehicle-parking-detection">
      <div className="detection-header">
        <h2>Vehicle Parking Detection</h2>
        <p>Analyze if vehicles are perfectly parked or wrongly parked using AI</p>
      </div>

      {/* Mode Selection */}
      <div className="mode-selection">
        <div className="mode-tabs">
          <button 
            className={`mode-tab ${detectionMode === 'upload' ? 'active' : ''}`}
            onClick={() => {
              stopCamera()
              setDetectionMode('upload')
              setAnalysisResult(null)
            }}
          >
            <div className="mode-icon">📁</div>
            <div className="mode-text">
              <span className="mode-title">Upload Image</span>
              <span className="mode-desc">Analyze uploaded photos</span>
            </div>
          </button>
          <button 
            className={`mode-tab ${detectionMode === 'live' ? 'active' : ''}`}
            onClick={() => {
              setDetectionMode('live')
              setAnalysisResult(null)
              setSelectedFile(null)
            }}
          >
            <div className="mode-icon">📹</div>
            <div className="mode-text">
              <span className="mode-title">Live Camera</span>
              <span className="mode-desc">Real-time detection</span>
            </div>
          </button>
        </div>
      </div>

      {/* Detection Content */}
      {detectionMode === 'upload' ? (
        <div className="upload-section">
          <div className="upload-area">
            <div className="upload-dropzone">
              <div className="upload-icon">📎</div>
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleFileSelect}
                className="file-input"
              />
              <div className="upload-text">
                <span className="upload-main">Choose Image</span>
                <span className="upload-sub">JPG, PNG supported</span>
              </div>
            </div>
          </div>
          
          {selectedFile && (
            <div className="file-preview">
              <p>Selected: {selectedFile.name}</p>
              <img 
                src={URL.createObjectURL(selectedFile)} 
                alt="Preview" 
                className="preview-image"
              />
            </div>
          )}
          
          <div className="upload-actions">
            <button 
              className="btn-primary btn-standard" 
              onClick={analyzeUploadedImage}
              disabled={!selectedFile || analyzing}
            >
              {analyzing ? (
                <>
                  <span className="btn-spinner">⏳</span>
                  Analyzing Parking...
                </>
              ) : (
                <>
                  <span className="btn-icon">🔍</span>
                  Analyze Parking
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="live-section">
          <div className="camera-container">
            {cameraError && (
              <div className="camera-error">
                ⚠️ {cameraError}
              </div>
            )}
            
            <div className="camera-video-container">
              {!cameraActive && !cameraError && (
                <div className="camera-placeholder">
                  📹 Camera Feed Will Appear Here
                </div>
              )}
              
              <video 
                ref={videoRef}
                autoPlay 
                playsInline
                muted
                className={`camera-video ${cameraActive ? 'active' : 'hidden'}`}
                style={{ display: cameraActive ? 'block' : 'none' }}
              />
              
              <canvas 
                ref={canvasRef}
                style={{ display: 'none' }}
              />
            </div>
            
            <div className="camera-controls">
              {!cameraActive ? (
                <button className="btn-primary btn-standard" onClick={startCamera}>
                  <span className="btn-icon">📹</span>
                  Start Camera
                </button>
              ) : (
                <div className="camera-actions">
                  <button className="btn-secondary btn-standard" onClick={stopCamera}>
                    <span className="btn-icon">⏹️</span>
                    Stop Camera
                  </button>
                  <button 
                    className="btn-primary btn-standard"
                    onClick={captureFrame}
                    disabled={analyzing}
                  >
                    {analyzing ? (
                      <>
                        <span className="btn-spinner">⏳</span>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <span className="btn-icon">📸</span>
                        Capture & Analyze
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Analysis Results */}
      {analysisResult && (
        <div className="analysis-result">
          {analysisResult.error ? (
            <div className="error-result">
              ❌ {analysisResult.error}
            </div>
          ) : (
            <div className="success-result">
              <h3>Vehicle Parking Analysis Complete!</h3>
              <div className="result-grid">
                <div className="result-item parking-status">
                  <strong>Parking Status</strong>
                  <span style={{ color: getParkingStatusDisplay(analysisResult.parkingStatus).color }}>
                    {getParkingStatusDisplay(analysisResult.parkingStatus).icon} {getParkingStatusDisplay(analysisResult.parkingStatus).text}
                  </span>
                </div>
                <div className="result-item">
                  <strong>Confidence Score</strong>
                  <span>{analysisResult.confidence}%</span>
                </div>
                <div className="result-item">
                  <strong>Detection ID</strong>
                  <span>{analysisResult.detectionId}</span>
                </div>
                <div className="result-item">
                  <strong>Source Type</strong>
                  <span>{detectionMode === 'live' ? '📹 Live Camera' : '📁 Uploaded Image'}</span>
                </div>
              </div>
              
              {analysisResult.detectedLabels && analysisResult.detectedLabels.length > 0 && (
                <div className="detected-labels">
                  <strong>All Detected Labels:</strong>
                  <div className="labels-list">
                    {analysisResult.detectedLabels.map((label, index) => (
                      <span key={index} className="label-tag">
                        {label.name} ({label.confidence}%)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default VehicleParkingDetection