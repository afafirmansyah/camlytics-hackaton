const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const client = new DynamoDBClient({ region: process.env.REGION });
const dynamodb = DynamoDBDocumentClient.from(client);

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password) => {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  return password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
};

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
    const { fullName, email, password, confirmPassword } = JSON.parse(event.body);

    // Input validation
    if (!fullName?.trim() || !email?.trim() || !password || !confirmPassword) {
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'All fields are required' })
      };
    }

    if (!validateEmail(email.trim().toLowerCase())) {
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }

    if (password !== confirmPassword) {
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Passwords do not match' })
      };
    }

    if (!validatePassword(password)) {
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character' })
      };
    }

    if (fullName.trim().length < 2 || fullName.trim().length > 50) {
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Full name must be between 2 and 50 characters' })
      };
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await dynamodb.send(new GetCommand({
      TableName: process.env.USERS_TABLE,
      Key: { email: normalizedEmail }
    }));

    if (existingUser.Item) {
      return {
        statusCode: 409,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'User already exists' })
      };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = {
      id: uuidv4(),
      email: normalizedEmail,
      fullName: fullName.trim(),
      password: hashedPassword,
      isActive: true,
      loginAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await dynamodb.send(new PutCommand({
      TableName: process.env.USERS_TABLE,
      Item: user
    }));

    return {
      statusCode: 201,
      headers: secureHeaders,
      body: JSON.stringify({
        message: 'User registered successfully',
        user: { id: user.id, email: user.email, fullName: user.fullName }
      })
    };

  } catch (error) {
    console.error('Registration error:', error.message);
    return {
      statusCode: 500,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};