const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const client = new DynamoDBClient({ region: process.env.REGION });
const dynamodb = DynamoDBDocumentClient.from(client);

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

const secureHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

exports.handler = async (event) => {
  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: secureHeaders,
      body: ''
    };
  }

  try {
    const { email, password } = JSON.parse(event.body);

    // Input validation
    if (!email?.trim() || !password) {
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Email and password are required' })
      };
    }

    if (!validateEmail(email.trim())) {
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Get user from database
    const result = await dynamodb.send(new GetCommand({
      TableName: process.env.USERS_TABLE,
      Key: { email: normalizedEmail }
    }));

    if (!result.Item) {
      // Simulate processing time to prevent timing attacks
      await bcrypt.hash('dummy', 10);
      return {
        statusCode: 401,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Invalid credentials' })
      };
    }

    const user = result.Item;

    // Check if account is locked
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return {
        statusCode: 423,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Account temporarily locked. Try again later.' })
      };
    }

    // Check if account is active
    if (!user.isActive) {
      return {
        statusCode: 401,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Account is deactivated' })
      };
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      // Increment login attempts
      const loginAttempts = (user.loginAttempts || 0) + 1;
      const updateParams = {
        TableName: process.env.USERS_TABLE,
        Key: { email: normalizedEmail },
        UpdateExpression: 'SET loginAttempts = :attempts, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':attempts': loginAttempts,
          ':updatedAt': new Date().toISOString()
        }
      };

      // Lock account if max attempts reached
      if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        updateParams.UpdateExpression += ', lockedUntil = :lockedUntil';
        updateParams.ExpressionAttributeValues[':lockedUntil'] = new Date(Date.now() + LOCKOUT_TIME).toISOString();
      }

      await dynamodb.send(new UpdateCommand(updateParams));

      return {
        statusCode: 401,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Invalid credentials' })
      };
    }

    // Reset login attempts on successful login
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.USERS_TABLE,
      Key: { email: normalizedEmail },
      UpdateExpression: 'SET loginAttempts = :zero, lastLoginAt = :lastLogin, updatedAt = :updatedAt REMOVE lockedUntil',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':lastLogin': new Date().toISOString(),
        ':updatedAt': new Date().toISOString()
      }
    }));

    // Generate JWT token (30 minutes expiry)
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        iat: Math.floor(Date.now() / 1000)
      },
      process.env.JWT_SECRET,
      { 
        expiresIn: '30m',
        issuer: 'camlytics-api',
        audience: 'camlytics-client'
      }
    );

    return {
      statusCode: 200,
      headers: secureHeaders,
      body: JSON.stringify({
        message: 'Login successful',
        token,
        expiresIn: 1800, // 30 minutes in seconds
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName
        }
      })
    };

  } catch (error) {
    console.error('Login error:', error.message);
    return {
      statusCode: 500,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};