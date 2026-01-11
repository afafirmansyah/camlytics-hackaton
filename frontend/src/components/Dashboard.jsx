import { useState, useEffect } from 'react'
import axios from 'axios'

const API_BASE = 'https://6sdtr7ql6h.execute-api.eu-central-1.amazonaws.com/develop'

function Dashboard({ setToken }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    try {
      const storedUser = localStorage.getItem('user')
      if (storedUser) {
        setUser(JSON.parse(storedUser))
      } else {
        handleLogout()
      }
    } catch (err) {
      console.error('Failed to load user data')
      handleLogout()
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    setToken(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  if (loading) {
    return (
      <div className="container">
        <div className="auth-card">
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="auth-card">
        <div className="logo">
          <h1>Camlytics</h1>
          <p>AI-Powered Vehicle Recognition</p>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ color: '#ef4444', marginBottom: '10px' }}>Welcome!</h2>
          <p><strong>Name:</strong> {user?.fullName}</p>
          <p><strong>Email:</strong> {user?.email}</p>
        </div>

        <button onClick={handleLogout} className="btn">
          Logout
        </button>
      </div>
    </div>
  )
}

export default Dashboard