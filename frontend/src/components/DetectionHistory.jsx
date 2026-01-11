import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { checkTokenAndHandleResponse } from '../utils/auth'
import { API_BASE_URL } from '../config'
import TokenTimer from './TokenTimer'

function DetectionHistory({ setToken }) {
  const [user, setUser] = useState(null)
  const [detectionHistory, setDetectionHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [imageUrls, setImageUrls] = useState({})
  const [activeTab, setActiveTab] = useState('images')
  const navigate = useNavigate()
  const observerRef = useRef(null)

  useEffect(() => {
    const storedUser = localStorage.getItem('user')
    if (storedUser) {
      setUser(JSON.parse(storedUser))
    }
  }, [])

  useEffect(() => {
    if (user) {
      fetchDetectionHistory()
    }
  }, [user])

  const handleLogout = () => {
    setToken(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  const fetchDetectionHistory = async () => {
    if (!user) {
      console.log('No user found, skipping history fetch')
      return
    }
    
    console.log('Fetching detection history for user:', user)
    setLoadingHistory(true)
    
    try {
      const token = localStorage.getItem('token')
      console.log('Token exists:', !!token)
      
      const response = await fetch(`${API_BASE_URL}/detections`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      console.log('Response status:', response.status)
      
      await checkTokenAndHandleResponse(response, setToken)
      const result = await response.json()
      
      console.log('API Response:', result)
      
      if (result.success) {
        console.log('Setting detection history:', result.detections.length, 'items')
        setDetectionHistory(result.detections)
      } else {
        console.error('API returned success: false', result)
      }
    } catch (error) {
      console.error('Failed to fetch detection history:', error)
    } finally {
      setLoadingHistory(false)
    }
  }

  const fetchImageUrl = useCallback(async (detection) => {
    if (imageUrls[detection.id]) return
    
    console.log('Fetching image URL for detection:', detection.id, 's3Key:', detection.s3Key)
    
    const token = localStorage.getItem('token')
    try {
      const response = await fetch(`${API_BASE_URL}/image-url?key=${encodeURIComponent(detection.s3Key)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      console.log('Image URL response status:', response.status)
      
      await checkTokenAndHandleResponse(response, setToken)
      const result = await response.json()
      console.log('Image URL result:', result)
      
      if (result.success) {
        console.log('Setting image URL for detection:', detection.id)
        setImageUrls(prev => ({ ...prev, [detection.id]: result.imageUrl }))
      } else {
        console.error('Failed to get image URL:', result)
      }
    } catch (error) {
      console.error('Failed to fetch image URL:', error)
    }
  }, [imageUrls, setToken])

  const setupIntersectionObserver = useCallback(() => {
    if (observerRef.current) observerRef.current.disconnect()
    
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const detectionId = entry.target.dataset.detectionId
            console.log('Element intersecting:', detectionId)
            const detection = detectionHistory.find(d => d.id === detectionId)
            if (detection) {
              console.log('Found detection, fetching image URL:', detection)
              fetchImageUrl(detection)
            } else {
              console.log('Detection not found for ID:', detectionId)
            }
          }
        })
      },
      { rootMargin: '50px' }
    )
    console.log('Intersection observer setup complete')
  }, [detectionHistory, fetchImageUrl])

  useEffect(() => {
    setupIntersectionObserver()
    return () => {
      if (observerRef.current) observerRef.current.disconnect()
    }
  }, [setupIntersectionObserver])

  return (
    <div className="landing-container">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1>Camlytics</h1>
          <span>Detection History</span>
        </div>
        <div className="header-right">
          <span>Welcome, {user?.fullName}</span>
          <TokenTimer setToken={setToken} />
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </header>

      <div className="history-page-content">
        <div className="history-page-header">
          <button 
            className="back-btn" 
            onClick={() => navigate('/landing')}
          >
            ← Back to Dashboard
          </button>
          <div className="history-title">
            <h2>License Plate Detection History</h2>
            <button 
              className="btn-refresh" 
              onClick={fetchDetectionHistory}
              disabled={loadingHistory}
            >
              {loadingHistory ? '🔄' : '↻'} Refresh
            </button>
          </div>
        </div>

        {loadingHistory ? (
          <div className="loading-history">Loading detection history...</div>
        ) : detectionHistory.length === 0 ? (
          <div className="no-history">
            <div className="no-history-container">
              <div className="no-history-icon">
                🔍
              </div>
              <h3>No Detection History Yet</h3>
              <p>Start your AI-powered license plate recognition journey! Upload your first image to see the magic happen.</p>
              
              <div className="no-history-features">
                <div className="no-history-feature">
                  <div className="no-history-feature-icon">🤖</div>
                  <h4>AI-Powered</h4>
                  <p>Advanced recognition using Amazon Rekognition & Textract</p>
                </div>
                <div className="no-history-feature">
                  <div className="no-history-feature-icon">⚡</div>
                  <h4>Fast & Accurate</h4>
                  <p>Get results in seconds with high confidence scores</p>
                </div>
              </div>
              
              <button 
                className="btn" 
                onClick={() => navigate('/landing')}
              >
                🚀 Start Your First Detection
              </button>
            </div>
          </div>
        ) : (
          <div className="history-stats">
            <div className="stats-grid">
              <div className="stat-card">
                <h3>{detectionHistory.length}</h3>
                <p>Total Detections</p>
              </div>
              <div className="stat-card">
                <h3>{detectionHistory.filter(d => d.licensePlate !== 'NOT_DETECTED').length}</h3>
                <p>Successful Detections</p>
              </div>
              <div className="stat-card">
                <h3>{detectionHistory.filter(d => d.sourceType === 'video').length}</h3>
                <p>Video Detections</p>
              </div>
              <div className="stat-card">
                <h3>{detectionHistory.filter(d => d.sourceType === 'camera').length}</h3>
                <p>Live Camera</p>
              </div>
              <div className="stat-card">
                <h3>{Math.round(detectionHistory.reduce((acc, d) => acc + d.confidence, 0) / detectionHistory.length)}%</h3>
                <p>Average Confidence</p>
              </div>
            </div>
            
            <div className="history-tabs">
              <button 
                className={`tab-btn ${activeTab === 'images' ? 'active' : ''}`}
                onClick={() => setActiveTab('images')}
              >
                📷 Images ({detectionHistory.filter(d => !d.sourceType || d.sourceType === 'image').length})
              </button>
              <button 
                className={`tab-btn ${activeTab === 'videos' ? 'active' : ''}`}
                onClick={() => setActiveTab('videos')}
              >
                🎥 Videos ({detectionHistory.filter(d => d.sourceType === 'video').length})
              </button>
              <button 
                className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`}
                onClick={() => setActiveTab('live')}
              >
                📹 Live Camera ({detectionHistory.filter(d => d.sourceType === 'camera').length})
              </button>
            </div>
            
            <div className="history-grid">
              {detectionHistory
                .filter(d => {
                  if (activeTab === 'images') return !d.sourceType || d.sourceType === 'image'
                  if (activeTab === 'videos') return d.sourceType === 'video'
                  if (activeTab === 'live') return d.sourceType === 'camera'
                  return false
                })
                .map((detection) => (
                <div 
                  key={detection.id} 
                  className="history-item"
                  data-detection-id={detection.id}
                  ref={(el) => {
                    if (el && observerRef.current) {
                      console.log('Observing element for detection:', detection.id)
                      observerRef.current.observe(el)
                    }
                  }}
                >
                  <div className="history-image">
                    {detection.sourceType === 'video' ? (
                      <div className="video-thumbnail">
                        <div className="video-icon">🎥</div>
                        <span>Video Frame</span>
                      </div>
                    ) : detection.sourceType === 'camera' ? (
                      <div className="live-thumbnail">
                        <div className="live-icon">📹</div>
                        <span>Live Capture</span>
                      </div>
                    ) : (
                      <img 
                        src={imageUrls[detection.id] || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2Y3ZjdmNyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5Mb2FkaW5nLi4uPC90ZXh0Pjwvc3ZnPg=='} 
                        alt="Detection" 
                        loading="lazy"
                        onError={(e) => {
                          e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2Y3ZjdmNyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5JbWFnZSBOb3QgRm91bmQ8L3RleHQ+PC9zdmc+'
                        }}
                      />
                    )}
                  </div>
                  <div className="history-details">
                    <div className="license-plate-result">
                      {detection.licensePlate === 'NOT_DETECTED' ? (
                        <span className="not-detected">No Plate Detected</span>
                      ) : (
                        <span className="detected-plate">{detection.licensePlate}</span>
                      )}
                    </div>
                    <div className="detection-meta">
                      <span className="confidence">{detection.confidence}% confidence</span>
                      <span className="method">{detection.method?.toUpperCase()}</span>
                      {detection.sourceType === 'video' && <span className="source-type">VIDEO</span>}
                      {detection.sourceType === 'camera' && <span className="source-type live-source">LIVE</span>}
                      <span className="timestamp">
                        {new Date(detection.timestamp).toLocaleDateString()} {new Date(detection.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DetectionHistory