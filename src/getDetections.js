const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const jwt = require('jsonwebtoken');

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    console.log('GetDetections called with headers:', JSON.stringify(event.headers));
    
    // Verify JWT token
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      console.log('No token provided');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'No token provided' })
      };
    }

    console.log('Token found, verifying...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    console.log('UserId from token:', userId);

    // Query detections by userId
    console.log('Querying detections table:', process.env.DETECTIONS_TABLE);
    const result = await dynamodb.send(new QueryCommand({
      TableName: process.env.DETECTIONS_TABLE,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      ScanIndexForward: false, // Sort by timestamp descending
      Limit: 50 // Limit to last 50 detections
    }));

    console.log('Query result:', JSON.stringify({
      Count: result.Count,
      ItemsLength: result.Items?.length,
      FirstItem: result.Items?.[0]
    }));

    const detections = result.Items?.map(item => ({
      id: item.id,
      licensePlate: item.licensePlate,
      confidence: item.confidence,
      method: item.detectionMethod,
      timestamp: item.timestamp,
      sourceType: item.sourceType || 'image',
      s3Key: item.imageUrl?.replace(`s3://${process.env.S3_BUCKET}/`, '') || ''
    })) || [];

    console.log('Mapped detections:', detections.length);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        detections,
        total: result.Count || 0
      })
    };

  } catch (error) {
    console.error('Get detections error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch detections',
        details: error.message 
      })
    };
  }
};