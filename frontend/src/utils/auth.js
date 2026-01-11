// Check if token is expired
export const isTokenExpired = (token) => {
  if (!token) return true;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Date.now() / 1000;
    return payload.exp < currentTime;
  } catch (error) {
    return true;
  }
};

// Handle automatic logout
export const handleAutoLogout = (setToken) => {
  setToken(null);
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
};

// Check token and handle API responses
export const checkTokenAndHandleResponse = async (response, setToken) => {
  if (response.status === 401) {
    handleAutoLogout(setToken);
    throw new Error('Session expired');
  }
  return response;
};