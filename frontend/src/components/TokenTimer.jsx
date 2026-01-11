import { useState, useEffect } from 'react'

function TokenTimer({ setToken }) {
  const [timeLeft, setTimeLeft] = useState(null)

  useEffect(() => {
    const updateTimer = () => {
      const token = localStorage.getItem('token')
      if (!token) {
        setTimeLeft(null)
        return
      }

      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        const expiryTime = payload.exp * 1000
        const currentTime = Date.now()
        const remaining = expiryTime - currentTime

        if (remaining <= 0) {
          setToken(null)
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          return
        }

        setTimeLeft(remaining)
      } catch (error) {
        console.error('Error parsing token:', error)
        setTimeLeft(null)
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)
  }, [setToken])

  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  if (!timeLeft) return null

  const isExpiringSoon = timeLeft < 300000 // 5 minutes

  return (
    <span className={`token-timer ${isExpiringSoon ? 'expiring' : ''}`}>
      ⏱️ {formatTime(timeLeft)}
    </span>
  )
}

export default TokenTimer