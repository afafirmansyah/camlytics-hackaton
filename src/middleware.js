const jwt = require('jsonwebtoken');

exports.verifyToken = (event) => {
  try {
    const token = event.headers.Authorization || event.headers.authorization;
    
    if (!token) {
      throw new Error('No token provided');
    }

    if (!token.startsWith('Bearer ')) {
      throw new Error('Invalid token format');
    }

    const bearerToken = token.slice(7);
    
    if (!bearerToken || bearerToken.length < 10) {
      throw new Error('Invalid token');
    }

    const decoded = jwt.verify(bearerToken, process.env.JWT_SECRET, {
      issuer: 'camlytics-api',
      audience: 'camlytics-client'
    });
    
    // Check token age (additional security)
    const tokenAge = Date.now() / 1000 - decoded.iat;
    if (tokenAge > 1800) { // 30 minutes
      throw new Error('Token expired');
    }
    
    return {
      isValid: true,
      user: {
        userId: decoded.userId,
        email: decoded.email
      }
    };
  } catch (error) {
    return {
      isValid: false,
      error: error.name === 'JsonWebTokenError' ? 'Invalid token' : error.message
    };
  }
};

exports.authMiddleware = async (event) => {
  const tokenValidation = exports.verifyToken(event);
  
  if (!tokenValidation.isValid) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      },
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }
  
  return tokenValidation.user;
};