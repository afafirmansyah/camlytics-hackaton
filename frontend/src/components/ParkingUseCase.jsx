import { useState, useRef } from 'react'
import citeaImage from '../assets/Citea_LCD_2025.jpg'

function ParkingUseCase() {
  const [parkingStep, setParkingStep] = useState('entry') // 'entry', 'citea', 'exit'
  const [entryData, setEntryData] = useState(null)
  const [exitData, setExitData] = useState(null)
  const [scannedPlates, setScannedPlates] = useState([])
  const [selectedPlate, setSelectedPlate] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [showCiteaModal, setShowCiteaModal] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)

  const startCamera = async () => {
    try {
      setCameraActive(false)
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'environment'
        } 
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().then(() => {
            setCameraActive(true)
          })
        }
      }
    } catch (error) {
      console.error('Camera access failed:', error)
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
  }

  const scanLicensePlate = async () => {
    if (!videoRef.current || !cameraActive) return
    
    setScanning(true)
    try {
      const video = videoRef.current
      const canvas = canvasRef.current || document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      
      // Simulate license plate detection (replace with actual API call later)
      const mockPlates = ['MH12AB1234', 'KA05CD5678', 'DL08EF9012']
      const detectedPlate = mockPlates[Math.floor(Math.random() * mockPlates.length)]
      const currentTime = new Date()
      
      if (parkingStep === 'entry') {
        const entry = {
          licensePlate: detectedPlate,
          entryTime: currentTime,
          timestamp: currentTime.toISOString()
        }
        setEntryData(entry)
        setScannedPlates(prev => [...prev, detectedPlate])
        setShowCiteaModal(true)
      } else if (parkingStep === 'exit') {
        const exit = {
          licensePlate: detectedPlate,
          exitTime: currentTime,
          timestamp: currentTime.toISOString()
        }
        setExitData(exit)
        calculateParkingCost(entryData, exit)
      }
      
      stopCamera()
    } catch (error) {
      console.error('Scan failed:', error)
    } finally {
      setScanning(false)
    }
  }

  const generateReceipt = () => {
    if (!selectedPlate) return
    
    const receiptData = {
      licensePlate: selectedPlate,
      entryTime: entryData?.entryTime,
      receiptTime: new Date(),
      receiptId: `RCP-${Date.now()}`,
      status: 'ACTIVE'
    }
    
    setReceipt(receiptData)
    setShowCiteaModal(false)
    // Add a small delay to show the receipt before moving to exit step
    setTimeout(() => {
      setParkingStep('exit')
    }, 2000)
  }

  const calculateParkingCost = (entry, exit) => {
    if (!entry || !exit) return
    
    const durationMs = exit.exitTime - entry.entryTime
    const durationHours = Math.ceil(durationMs / (1000 * 60 * 60))
    const ratePerHour = 50 // ₹50 per hour
    const totalCost = durationHours * ratePerHour
    
    const bill = {
      ...exit,
      entryTime: entry.entryTime,
      duration: durationHours,
      rate: ratePerHour,
      totalCost,
      billId: `BILL-${Date.now()}`
    }
    
    setExitData(bill)
  }

  const handleFileSelect = (event) => {
    const file = event.target.files[0]
    if (file) {
      setSelectedFile(file)
    }
  }

  const analyzeUploadedImage = async () => {
    if (!selectedFile) return
    
    setAnalyzing(true)
    try {
      // Simulate license plate detection (replace with actual API call later)
      const mockPlates = ['MH12AB1234', 'KA05CD5678', 'DL08EF9012']
      const detectedPlate = mockPlates[Math.floor(Math.random() * mockPlates.length)]
      const currentTime = new Date()
      
      if (parkingStep === 'entry') {
        const entry = {
          licensePlate: detectedPlate,
          entryTime: currentTime,
          timestamp: currentTime.toISOString()
        }
        setEntryData(entry)
        setScannedPlates(prev => [...prev, detectedPlate])
        setShowCiteaModal(true)
      } else if (parkingStep === 'exit') {
        const exit = {
          licensePlate: detectedPlate,
          exitTime: currentTime,
          timestamp: currentTime.toISOString()
        }
        setExitData(exit)
        calculateParkingCost(entryData, exit)
      }
      
      setSelectedFile(null)
    } catch (error) {
      console.error('Analysis failed:', error)
    } finally {
      setAnalyzing(false)
    }
  }

  const resetParking = () => {
    setParkingStep('entry')
    setEntryData(null)
    setExitData(null)
    setScannedPlates([])
    setSelectedPlate('')
    setReceipt(null)
    setSelectedFile(null)
    setShowCiteaModal(false)
    stopCamera()
  }

  const renderEntryStep = () => (
    <div className="parking-step">
      <div className="step-header">
        <h3>Vehicle Entry Scanning</h3>
        <p>Scan or upload license plate image of the entering vehicle</p>
      </div>
      
      <div className="detection-methods-inline">
        <div className="method-inline">
          <h4>📹 Live Camera Scan</h4>
          <div className="camera-controls">
            {!cameraActive ? (
              <button className="btn-primary btn-standard" onClick={startCamera}>
                <span className="btn-icon">📹</span>
                Start Entry Scan
              </button>
            ) : (
              <div className="camera-actions">
                <button className="btn-secondary btn-standard" onClick={stopCamera}>
                  <span className="btn-icon">⏹️</span>
                  Stop Camera
                </button>
                <button 
                  className="btn-primary btn-standard"
                  onClick={scanLicensePlate}
                  disabled={scanning}
                >
                  {scanning ? (
                    <>
                      <span className="btn-spinner">⏳</span>
                      Scanning...
                    </>
                  ) : (
                    <>
                      <span className="btn-icon">🔍</span>
                      Scan License Plate
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
        
        <div className="method-divider-inline">
          <span>OR</span>
        </div>
        
        <div className="method-inline">
          <h4>📁 Upload Image</h4>
          <div className="upload-controls">
            <div className="upload-dropzone-inline">
              <div className="upload-icon">📁</div>
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleFileSelect}
                className="file-input"
              />
              <div className="upload-text">
                <span className="upload-main">Upload Entry Image</span>
                <span className="upload-sub">JPG, PNG supported</span>
              </div>
            </div>
            
            {selectedFile && (
              <button 
                className="btn-primary btn-standard"
                onClick={analyzeUploadedImage}
                disabled={analyzing}
                style={{ marginTop: '10px' }}
              >
                {analyzing ? (
                  <>
                    <span className="btn-spinner">⏳</span>
                    Analyzing...
                  </>
                ) : (
                  <>
                    <span className="btn-icon">🔍</span>
                    Analyze Entry Image
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      
      {cameraActive && (
        <div className="camera-video-container">
          <video 
            ref={videoRef}
            autoPlay 
            playsInline
            muted
            className="camera-video active"
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
      )}
      
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
      
      {entryData && (
        <div className="scan-result">
          <h4>✅ Entry Recorded</h4>
          <div className="result-details">
            <p><strong>License Plate:</strong> {entryData.licensePlate}</p>
            <p><strong>Entry Time:</strong> {entryData.entryTime.toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  )

  const renderCiteaModal = () => (
    <div className="citea-modal-overlay">
      <div className="citea-modal-split">
        <div className="modal-header">
          <h3>Hectronic Citea Terminal</h3>
          <button 
            className="modal-close"
            onClick={() => setShowCiteaModal(false)}
          >
            ×
          </button>
        </div>
        
        <div className="citea-split-content">
          <div className="citea-device-side">
            <div className="device-container">
              <div className="actual-device">
                <img src={citeaImage} alt="Hectronic Citea Device" className="citea-hardware" />
              </div>
            </div>
          </div>
          
          <div className="citea-card-side">
            <div className="selection-card">
              <div className="card-header">
                <h4>Vehicle Selection</h4>
                <p>Please select your vehicle from detected plates</p>
              </div>
              
              <div className="license-selection">
                <div className="selection-label">Detected Vehicles:</div>
                <div className="plate-buttons">
                  {scannedPlates.map((plate, index) => (
                    <button 
                      key={index}
                      className={`plate-button ${selectedPlate === plate ? 'selected' : ''}`}
                      onClick={() => setSelectedPlate(plate)}
                    >
                      <div className="plate-number">{plate}</div>
                      <div className="plate-time">Entry: {entryData?.entryTime.toLocaleTimeString()}</div>
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="card-actions">
                <button 
                  className={`btn-primary btn-standard ${!selectedPlate ? 'disabled' : ''}`}
                  onClick={generateReceipt}
                  disabled={!selectedPlate}
                >
                  <span className="btn-icon">🎫</span>
                  Issue Parking Ticket
                </button>
                
                {selectedPlate && (
                  <button 
                    className="btn-secondary btn-standard"
                    onClick={() => {
                      setShowCiteaModal(false)
                      setParkingStep('exit')
                    }}
                    style={{ marginTop: '10px' }}
                  >
                    <span className="btn-icon">➡️</span>
                    Skip to Exit Scan
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderExitStep = () => (
    <div className="parking-step">
      <div className="step-header">
        <h3>🚪 Vehicle Exit Scanning</h3>
        <p>Scan or upload license plate image of the exiting vehicle</p>
      </div>
      
      <div className="detection-methods-inline">
        <div className="method-inline">
          <h4>📹 Live Camera Scan</h4>
          <div className="camera-controls">
            {!cameraActive ? (
              <button className="btn-primary btn-standard" onClick={startCamera}>
                <span className="btn-icon">📹</span>
                Start Exit Scan
              </button>
            ) : (
              <div className="camera-actions">
                <button className="btn-secondary btn-standard" onClick={stopCamera}>
                  <span className="btn-icon">⏹️</span>
                  Stop Camera
                </button>
                <button 
                  className="btn-primary btn-standard"
                  onClick={scanLicensePlate}
                  disabled={scanning}
                >
                  {scanning ? (
                    <>
                      <span className="btn-spinner">⏳</span>
                      Scanning...
                    </>
                  ) : (
                    <>
                      <span className="btn-icon">🔍</span>
                      Scan License Plate
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
        
        <div className="method-divider-inline">
          <span>OR</span>
        </div>
        
        <div className="method-inline">
          <h4>📁 Upload Image</h4>
          <div className="upload-controls">
            <div className="upload-dropzone-inline">
              <div className="upload-icon">📁</div>
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleFileSelect}
                className="file-input"
              />
              <div className="upload-text">
                <span className="upload-main">Upload Exit Image</span>
                <span className="upload-sub">JPG, PNG supported</span>
              </div>
            </div>
            
            {selectedFile && (
              <button 
                className="btn-primary btn-standard"
                onClick={analyzeUploadedImage}
                disabled={analyzing}
                style={{ marginTop: '10px' }}
              >
                {analyzing ? (
                  <>
                    <span className="btn-spinner">⏳</span>
                    Analyzing...
                  </>
                ) : (
                  <>
                    <span className="btn-icon">🔍</span>
                    Analyze Exit Image
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      
      {cameraActive && (
        <div className="camera-video-container">
          <video 
            ref={videoRef}
            autoPlay 
            playsInline
            muted
            className="camera-video active"
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
      )}
      
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
      
      {exitData && exitData.totalCost && (
        <div className="parking-bill">
          <h4>💰 Parking Bill</h4>
          <div className="bill-details">
            <p><strong>Bill ID:</strong> {exitData.billId}</p>
            <p><strong>License Plate:</strong> {exitData.licensePlate}</p>
            <p><strong>Entry Time:</strong> {exitData.entryTime.toLocaleString()}</p>
            <p><strong>Exit Time:</strong> {exitData.exitTime.toLocaleString()}</p>
            <p><strong>Duration:</strong> {exitData.duration} hour(s)</p>
            <p><strong>Rate:</strong> ₹{exitData.rate}/hour</p>
            <p className="total-cost"><strong>Total Cost: ₹{exitData.totalCost}</strong></p>
          </div>
          
          <button className="btn-primary btn-standard" onClick={resetParking}>
            <span className="btn-icon">🔄</span>
            Start New Parking Session
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="parking-use-case">
      <div className="parking-progress">
        <div className={`progress-step ${parkingStep === 'entry' ? 'active' : entryData ? 'completed' : ''}`}>
          <span className="step-number">1</span>
          <span className="step-label">Entry Scan</span>
        </div>
        <div className={`progress-step ${showCiteaModal || (entryData && !receipt) ? 'active' : receipt ? 'completed' : ''}`}>
          <span className="step-number">2</span>
          <span className="step-label">Citea Device</span>
        </div>
        <div className={`progress-step ${parkingStep === 'exit' ? 'active' : exitData?.totalCost ? 'completed' : ''}`}>
          <span className="step-number">3</span>
          <span className="step-label">Exit Scan</span>
        </div>
      </div>
      
      {parkingStep === 'entry' && renderEntryStep()}
      {parkingStep === 'exit' && renderExitStep()}
      {showCiteaModal && renderCiteaModal()}
      
      {receipt && (
        <div className="parking-ticket-overlay">
          <div className="parking-ticket">
            <div className="ticket-header">
              <div className="ticket-logo">HECTRONIC citea</div>
              <div className="ticket-title">PARKING TICKET</div>
            </div>
            <div className="ticket-content">
              <div className="ticket-row">
                <span>Ticket No:</span>
                <span>{receipt.receiptId}</span>
              </div>
              <div className="ticket-row">
                <span>License Plate:</span>
                <span className="plate-highlight">{receipt.licensePlate}</span>
              </div>
              <div className="ticket-row">
                <span>Entry Time:</span>
                <span>{receipt.entryTime.toLocaleString()}</span>
              </div>
              <div className="ticket-row">
                <span>Issued:</span>
                <span>{receipt.receiptTime.toLocaleString()}</span>
              </div>
              <div className="ticket-row status-row">
                <span>Status:</span>
                <span className="status-badge">{receipt.status}</span>
              </div>
            </div>
            <div className="ticket-footer">
              <div className="qr-placeholder">📱 QR Code</div>
              <div className="ticket-note">Keep this ticket for exit validation</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ParkingUseCase