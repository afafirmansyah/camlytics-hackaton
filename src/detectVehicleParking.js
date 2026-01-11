const { RekognitionClient, DetectCustomLabelsCommand } = require('@aws-sdk/client-rekognition');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const rekognition = new RekognitionClient({ region: process.env.REGION });
const s3 = new S3Client({ region: process.env.REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

exports.handler = async (event) => {
  console.log('Vehicle parking detection started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    console.log('Processing vehicle parking detection request');
    
    if (!event.body) {
      console.log('No request body provided');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    const { image, sourceType } = JSON.parse(event.body);
    console.log('Request data:', { sourceType, imageLength: image?.length });
    
    if (!image) {
      console.log('No image provided in request');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Image required' })
      };
    }

    const modelArn = 'arn:aws:rekognition:eu-central-1:718154142916:project/Camlytics/version/Camlytics.2025-11-12T01.37.05/1762891626211';
    console.log('Using model ARN:', modelArn);

    // Extract userId from JWT token
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      console.log('No token provided in headers');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'No token provided' })
      };
    }

    console.log('Verifying JWT token');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    console.log('User ID from token:', userId);

    // Convert base64 to buffer
    console.log('Converting image to buffer');
    const imageBuffer = Buffer.from(image.replace(/^data:image\/[a-z]+;base64,/, ''), 'base64');
    console.log('Image buffer size:', imageBuffer.length);
    
    // Detect custom labels using your trained model
    console.log('Calling AWS Rekognition DetectCustomLabels');
    const result = await rekognition.send(new DetectCustomLabelsCommand({
      Image: { Bytes: imageBuffer },
      ProjectVersionArn: modelArn,
      MinConfidence: 60
    }));
    
    console.log('Rekognition response:', JSON.stringify(result, null, 2));
    console.log('Number of custom labels detected:', result.CustomLabels?.length || 0);

    let parkingStatus = 'unknown';
    let confidence = 0;
    let detectedLabels = [];

    if (result.CustomLabels && result.CustomLabels.length > 0) {
      console.log('Processing detected labels');
      detectedLabels = result.CustomLabels.map(label => ({
        name: label.Name,
        confidence: Math.round(label.Confidence || 0)
      }));
      console.log('All detected labels:', detectedLabels);

      // Find parking-related labels (ignore licenseplate)
      const parkingLabels = result.CustomLabels.filter(label => 
        label.Name !== 'licenseplate'
      );
      console.log('Parking-related labels:', parkingLabels);

      if (parkingLabels.length > 0) {
        // Use the highest confidence parking label
        const bestLabel = parkingLabels.reduce((prev, current) => 
          (prev.Confidence > current.Confidence) ? prev : current
        );
        console.log('Best parking label:', bestLabel);
        
        if (bestLabel.Name === 'perfectly parked') {
          parkingStatus = 'properly_parked';
        } else if (bestLabel.Name === 'wrongly parked') {
          parkingStatus = 'improperly_parked';
        } else {
          parkingStatus = bestLabel.Name.toLowerCase().replace(/\s+/g, '_');
        }
        
        confidence = Math.round(bestLabel.Confidence);
        console.log('Final parking status:', parkingStatus, 'with confidence:', confidence);
      } else {
        console.log('No parking-related labels found');
      }
    } else {
      console.log('No custom labels detected');
    }

    // Store image and detection result
    const detectionId = uuidv4();
    const s3Key = `vehicle-parking/${userId}/${detectionId}.jpg`;
    console.log('Generated detection ID:', detectionId);
    console.log('S3 key:', s3Key);

    // Upload to S3
    console.log('Uploading image to S3');
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
      Body: imageBuffer,
      ContentType: 'image/jpeg'
    }));
    console.log('Image uploaded to S3 successfully');

    // Store result in DynamoDB
    const detectionRecord = {
      id: detectionId,
      userId,
      s3Key,
      imageUrl: `s3://${process.env.S3_BUCKET}/${s3Key}`,
      parkingStatus,
      confidence,
      detectedLabels,
      timestamp: new Date().toISOString(),
      featureType: 'vehicle-parking',
      sourceType: sourceType || 'image'
    };
    console.log('Detection record to store:', JSON.stringify(detectionRecord, null, 2));

    console.log('Storing detection record in DynamoDB');
    await dynamodb.send(new PutCommand({
      TableName: process.env.DETECTIONS_TABLE,
      Item: detectionRecord
    }));
    console.log('Detection record stored successfully');

    const response = {
      success: true,
      detectionId,
      parkingStatus,
      confidence,
      detectedLabels,
      imageUrl: `https://${process.env.S3_BUCKET}.s3.${process.env.REGION}.amazonaws.com/${s3Key}`
    };
    console.log('Returning response:', JSON.stringify(response, null, 2));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Vehicle parking detection error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', JSON.stringify(error, null, 2));
    
    if (error instanceof SyntaxError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }
    
    if (error.name === 'JsonWebTokenError') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }
    
    if (error.Code === 'ResourceNotReadyException') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Model not running. Please start your Custom Labels model in AWS Console first.',
          details: 'Go to AWS Rekognition > Custom Labels and start the model version.'
        })
      };
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Vehicle parking detection failed',
        details: error.message 
      })
    };
  }
};