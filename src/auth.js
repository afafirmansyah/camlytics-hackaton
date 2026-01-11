const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const dynamodb = new AWS.DynamoDB.DocumentClient();

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

exports.register = async (event) => {
  try {
    const { email, password, name } = JSON.parse(event.body);
    
    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password required' })
      };
    }

    // Check if user exists
    const existingUser = await dynamodb.get({
      TableName: process.env.USERS_TABLE,
      Key: { email }
    }).promise();

    if (existingUser.Item) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'User already exists' })
      };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save user
    await dynamodb.put({
      TableName: process.env.USERS_TABLE,
      Item: {
        email,
        password: hashedPassword,
        name: name || '',
        createdAt: new Date().toISOString()
      }
    }).promise();

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ message: 'User registered successfully' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Registration failed' })
    };
  }
};

exports.login = async (event) => {
  try {
    const { email, password } = JSON.parse(event.body);
    
    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password required' })
      };
    }

    // Get user
    const result = await dynamodb.get({
      TableName: process.env.USERS_TABLE,
      Key: { email }
    }).promise();

    if (!result.Item) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid credentials' })
      };
    }

    // Verify password
    const isValid = await bcrypt.compare(password, result.Item.password);
    if (!isValid) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid credentials' })
      };
    }

    // Generate JWT
    const token = jwt.sign(
      { email: result.Item.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        token,
        user: {
          email: result.Item.email,
          name: result.Item.name
        }
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Login failed' })
    };
  }
};

exports.profile = async (event) => {
  try {
    const token = event.headers.Authorization?.replace('Bearer ', '');
    
    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'No token provided' })
      };
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const result = await dynamodb.get({
      TableName: process.env.USERS_TABLE,
      Key: { email: decoded.email }
    }).promise();

    if (!result.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        email: result.Item.email,
        name: result.Item.name,
        createdAt: result.Item.createdAt
      })
    };
  } catch (error) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Invalid token' })
    };
  }
};