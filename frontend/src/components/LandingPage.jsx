import { useState, useEffect, useRef } from 'react'
import { checkTokenAndHandleResponse } from '../utils/auth'
import { API_BASE_URL } from '../config'
import TokenTimer from './TokenTimer'
import ParkingUseCase from './ParkingUseCase'
import VehicleParkingDetection from './VehicleParkingDetection'
import licensePlateIcon from '../assets/logos/license_plate.png'
import vehicleDetectionIcon from '../assets/logos/vehical-detection.png'
import behaviorIcon from '../assets/logos/car_behaviour.jpg'
import parkingSystemIcon from '../assets/logos/car_parking_system.jpg'

function LandingPage({ setToken }) {
  const [user, setUser] = useState(null)
  const [activeFeature, setActiveFeature] = useState('license-plate')
  const [detectionMode, setDetectionMode] = useState('upload') // 'upload' or 'live'
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const storedUser = localStorage.getItem('user')
    if (storedUser) {
      setUser(JSON.parse(storedUser))
    }
    
    // Cleanup camera on component unmount
    return () => {
      stopCamera()
    }
  }, [])

  const handleLogout = () => {
    stopCamera()
    setToken(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  const startCamera = async () => {
    try {
      setCameraError('')
      setCameraActive(false)
      console.log('Starting camera...')
      
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera not supported by this browser')
      }
      
      // Get all available video devices
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter(device => device.kind === 'videoinput')
      console.log('Available video devices:', videoDevices)
      
      // Find external camera (usually appears as index 1 or higher, or has specific labels)
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
      } else {
        constraints.video.facingMode = 'environment'
      }
      
      console.log('Camera constraints:', constraints)
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        
        // Set up event handlers before setting active
        videoRef.current.onloadedmetadata = () => {
          console.log('Video metadata loaded')
          videoRef.current.play().then(() => {
            console.log('Video playing successfully')
            setCameraActive(true)
          }).catch(err => {
            console.error('Error playing video:', err)
            setCameraError('Failed to start video playback')
          })
        }
        
        videoRef.current.onerror = (err) => {
          console.error('Video element error:', err)
          setCameraError('Video playback error')
        }
      }
    } catch (error) {
      console.error('Camera access error:', error)
      let errorMessage = 'Camera access failed'
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Camera permission denied. Please allow camera access and try again.'
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No camera found on this device.'
      } else if (error.name === 'NotSupportedError') {
        errorMessage = 'Camera not supported by this browser.'
      } else if (error.message) {
        errorMessage = error.message
      }
      
      setCameraError(errorMessage)
      setCameraActive(false)
    }
  }

  const stopCamera = () => {
    console.log('Stopping camera...')
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop()
        console.log('Stopped track:', track.kind)
      })
      streamRef.current = null
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.onloadedmetadata = null
      videoRef.current.onerror = null
    }
    
    setCameraActive(false)
    setCameraError('')
  }

  const captureFrame = async () => {
    if (!videoRef.current || !cameraActive || !user) return
    
    setAnalyzing(true)
    try {
      const video = videoRef.current
      const canvas = canvasRef.current || document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      
      // Convert canvas to blob
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8)
      })
      
      const base64Image = await convertFileToBase64(blob)
      const token = localStorage.getItem('token')
      
      const response = await fetch(`${API_BASE_URL}/detect/license-plate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          image: base64Image,
          sourceType: 'camera'
        })
      })
      
      await checkTokenAndHandleResponse(response, setToken)
      const result = await response.json()
      setAnalysisResult(result)
      
    } catch (error) {
      console.error('Capture failed:', error)
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

  const isVideoFile = (file) => {
    return file && file.type.startsWith('video/')
  }

  const extractFrameFromVideo = (videoFile) => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        
        // Seek to middle of video for best frame
        video.currentTime = video.duration / 2
      }
      
      video.onseeked = () => {
        ctx.drawImage(video, 0, 0)
        canvas.toBlob((blob) => {
          resolve(blob)
        }, 'image/jpeg', 0.8)
      }
      
      video.onerror = reject
      video.src = URL.createObjectURL(videoFile)
    })
  }

  const compressImage = (file, maxWidth = 800, quality = 0.8) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()
      
      img.onload = () => {
        const ratio = Math.min(maxWidth / img.width, maxWidth / img.height)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(resolve, 'image/jpeg', quality)
      }
      
      img.src = URL.createObjectURL(file)
    })
  }

  const convertFileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result)
      reader.onerror = error => reject(error)
    })
  }

  const analyzeMedia = async () => {
    if (!selectedFile || !user) return
    
    setAnalyzing(true)
    try {
      const token = localStorage.getItem('token')
      const isVideo = isVideoFile(selectedFile)
      let requestBody = { 
        sourceType: isVideo ? 'video' : 'image'
      }
      
      if (isVideo) {
        // Extract frame from video and process as image
        const frameBlob = await extractFrameFromVideo(selectedFile)
        const compressedFrame = frameBlob.size > 1000000 ? 
          await compressImage(frameBlob, 800, 0.7) : frameBlob
        const base64Image = await convertFileToBase64(compressedFrame)
        requestBody.image = base64Image
      } else {
        // Handle image file - compress if too large
        const compressedFile = selectedFile.size > 1000000 ? 
          await compressImage(selectedFile, 800, 0.7) : selectedFile
        const base64Image = await convertFileToBase64(compressedFile)
        requestBody.image = base64Image
      }
      
      const response = await fetch(`${API_BASE_URL}/detect/license-plate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      })
      
      await checkTokenAndHandleResponse(response, setToken)
      const result = await response.json()
      
      // Add video processing indicator to result
      if (isVideo) {
        result.processedAsVideo = true
        result.message = result.message || 'Frame extracted from video and processed successfully'
      }
      
      setAnalysisResult(result)

    } catch (error) {
      console.error('Analysis failed:', error)
      setAnalysisResult({ error: 'Analysis failed. Please try again.' })
    } finally {
      setAnalyzing(false)
    }
  }



  const features = [
    { id: 'license-plate', title: 'License Plate Recognition', icon: licensePlateIcon },
    { id: 'vehicle-parking', title: 'Vehicle Parking Detection', icon: vehicleDetectionIcon },
    { id: 'recognize-behavior', title: 'Behavior Analysis', icon: behaviorIcon },
    { id: 'parking-use-case', title: 'Smart Parking System', icon: parkingSystemIcon }
  ]

  const getFeatureTitle = () => {
    switch(activeFeature) {
      case 'license-plate': return 'License Plate Recognition'
      case 'vehicle-parking': return 'Vehicle Parking Detection'
      case 'recognize-behavior': return 'Behavior Recognition'
      case 'parking-use-case': return 'Smart Parking System'
      default: return ''
    }
  }

  const getFeatureDescription = () => {
    switch(activeFeature) {
      case 'license-plate': return 'Identify and extract license plate numbers using AI-powered OCR technology.'
      case 'vehicle-parking': return 'Analyze whether vehicles are parked properly or improperly using your trained AWS Rekognition custom model.'
      case 'recognize-behavior': return 'Analyze vehicle behaviors such as parking violations, refueling activities, or blocking access.'
      case 'parking-use-case': return 'Complete parking management system with entry/exit scanning, Citea device integration, and automated billing.'
      default: return ''
    }
  }

  const renderDetectionContent = () => {
    if (detectionMode === 'live') {
      return (
        <div className="live-section">
          <div className="live-header">
            <h3>📹 Live Camera Detection</h3>
            <p>Use your device camera for real-time license plate detection</p>
          </div>
          
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
            
            {analysisResult && detectionMode === 'live' && (
              <div className="analysis-result">
                {analysisResult.error ? (
                  <div className="error-result">
                    ❌ {analysisResult.error}
                  </div>
                ) : (
                  <div className="success-result">
                    <h3>{analysisResult.cached ? '⚡ Found in Database!' : '✅ Detection Complete!'}</h3>
                    {analysisResult.cached && (
                      <div className="cached-message">
                        This license plate was found in existing records!
                      </div>
                    )}
                    <div className="result-grid">
                      <div className="result-item license-plate">
                        <strong>License Plate Number</strong>
                        <span>{analysisResult.licensePlate || 'NOT DETECTED'}</span>
                      </div>
                      <div className="result-item">
                        <strong>Confidence Score</strong>
                        <span>{analysisResult.confidence}%</span>
                      </div>
                      <div className="result-item">
                        <strong>Detection Method</strong>
                        <span>{analysisResult.method?.toUpperCase() || 'NONE'}</span>
                      </div>
                      <div className="result-item video-indicator">
                        <strong>Source Type</strong>
                        <span>📹 Live Camera</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )
    } else {
      return (
        <div className="upload-section">
          <div className="upload-header">
            <h3>📁 Upload Media Files</h3>
            <p>Select images or videos for license plate detection</p>
          </div>
          
          <div className="upload-area">
            <div className="upload-dropzone">
              <div className="upload-icon">📎</div>
              <input 
                type="file" 
                accept="image/*,video/*" 
                onChange={handleFileSelect}
                className="file-input"
              />
              <div className="upload-text">
                <span className="upload-main">Choose File</span>
                <span className="upload-sub">or drag and drop here</span>
              </div>
            </div>
            <div className="supported-formats">
              <span>🖼️ Images: JPG, PNG</span>
              <span>🎥 Videos: MP4, MOV, AVI</span>
            </div>
          </div>
          
          {selectedFile && (
            <div className="file-preview">
              <p>Selected: {selectedFile.name} ({isVideoFile(selectedFile) ? 'Video' : 'Image'})</p>
              {isVideoFile(selectedFile) ? (
                <video 
                  src={URL.createObjectURL(selectedFile)} 
                  controls
                  className="preview-video"
                />
              ) : (
                <img 
                  src={URL.createObjectURL(selectedFile)} 
                  alt="Preview" 
                  className="preview-image"
                />
              )}
            </div>
          )}
          
          <div className="upload-actions">
            <button 
              className="btn-primary btn-standard" 
              onClick={analyzeMedia}
              disabled={!selectedFile || analyzing}
            >
              {analyzing ? (
                <>
                  <span className="btn-spinner">⏳</span>
                  {isVideoFile(selectedFile) ? 'Processing Video...' : 'Analyzing Image...'}
                </>
              ) : (
                <>
                  <span className="btn-icon">🔍</span>
                  Analyze {activeFeature === 'license-plate' ? 'License Plate' : 'Media'}
                </>
              )}
            </button>
          </div>
          
          {analysisResult && (
            <div className="analysis-result">
              {analysisResult.error ? (
                <div className="error-result">
                  ❌ {analysisResult.error}
                </div>
              ) : (
                <div className="success-result">
                  <h3>{analysisResult.cached ? '⚡ Found in Database!' : '✅ Detection Complete!'}</h3>
                  {analysisResult.cached && (
                    <div className="cached-message">
                      This license plate was found in existing records - no new processing needed!
                    </div>
                  )}
                  <div className="result-grid">
                    <div className="result-item license-plate">
                      <strong>License Plate Number</strong>
                      <span>{analysisResult.licensePlate || 'NOT DETECTED'}</span>
                    </div>
                    <div className="result-item">
                      <strong>Confidence Score</strong>
                      <span>{analysisResult.confidence}%</span>
                    </div>
                    <div className="result-item">
                      <strong>Detection Method</strong>
                      <span>{analysisResult.method?.toUpperCase() || 'NONE'}</span>
                    </div>
                    {analysisResult.processedAsVideo && (
                      <div className="result-item video-indicator">
                        <strong>Source Type</strong>
                        <span>🎥 Video Frame</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )
    }
  }

  const renderFeatureContent = () => {
    if (activeFeature === 'parking-use-case') {
      return (
        <div className="feature-content">
          <h2>{getFeatureTitle()}</h2>
          <p>{getFeatureDescription()}</p>
          <ParkingUseCase />
        </div>
      )
    }
    
    if (activeFeature === 'vehicle-parking') {
      return (
        <div className="feature-content">
          <VehicleParkingDetection setToken={setToken} />
        </div>
      )
    }
    
    return (
      <div className="feature-content">
        <h2>{getFeatureTitle()}</h2>
        <p>{getFeatureDescription()}</p>
        
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
                <span className="mode-title">Upload Media</span>
                <span className="mode-desc">Images & Videos</span>
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
                <span className="mode-desc">Real-time Detection</span>
              </div>
            </button>
            {activeFeature === 'license-plate' && (
              <button 
                className="mode-tab"
                onClick={() => window.location.href = '/history'}
              >
                <div className="mode-icon">📈</div>
                <div className="mode-text">
                  <span className="mode-title">View History</span>
                  <span className="mode-desc">Past Detections</span>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Detection Content */}
        {renderDetectionContent()}
        

      </div>
    )
  }

  return (
    <div className="landing-container">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1>Camlytics</h1>
          <span>AI-Powered Vehicle Recognition</span>
        </div>
        <div className="header-right">
          <span>Welcome, {user?.fullName}</span>
          <TokenTimer setToken={setToken} />
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </header>

      <div className="main-content">
        {/* Sidebar */}
        <aside className="sidebar">
          <nav>
            {features.map(feature => (
              <button
                key={feature.id}
                className={`sidebar-item ${activeFeature === feature.id ? 'active' : ''}`}
                onClick={() => setActiveFeature(feature.id)}
              >
                <img src={feature.icon} alt={feature.title} className="icon" />
                <span className="title">{feature.title}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Content Area */}
        <main className="content">
          {renderFeatureContent()}
        </main>
      </div>
    </div>
  )
}

export default LandingPage