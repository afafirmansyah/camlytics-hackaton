import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { isTokenExpired, handleAutoLogout } from './utils/auth'
import Login from './components/Login'
import Register from './components/Register'
import LandingPage from './components/LandingPage'
import DetectionHistory from './components/DetectionHistory'

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))

  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token)
    } else {
      localStorage.removeItem('token')
    }
  }, [token])

  // Check token expiry on app load and periodically
  useEffect(() => {
    const checkToken = () => {
      const storedToken = localStorage.getItem('token')
      if (storedToken && isTokenExpired(storedToken)) {
        handleAutoLogout(setToken)
      }
    }

    // Check immediately
    checkToken()

    // Check every minute
    const interval = setInterval(checkToken, 60000)
    return () => clearInterval(interval)
  }, [])

  return (
    <Router>
      <Routes>
        <Route 
          path="/login" 
          element={!token ? <Login setToken={setToken} /> : <Navigate to="/landing" />} 
        />
        <Route 
          path="/register" 
          element={!token ? <Register setToken={setToken} /> : <Navigate to="/landing" />} 
        />
        <Route 
          path="/landing" 
          element={token ? <LandingPage setToken={setToken} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/history" 
          element={token ? <DetectionHistory setToken={setToken} /> : <Navigate to="/login" />} 
        />
        <Route path="/" element={<Navigate to={token ? "/landing" : "/login"} />} />
      </Routes>
    </Router>
  )
}

export default App