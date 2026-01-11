const { RekognitionClient, DetectCustomLabelsCommand, DetectTextCommand } = require('@aws-sdk/client-rekognition');
const { TextractClient, DetectDocumentTextCommand } = require('@aws-sdk/client-textract');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const rekognition = new RekognitionClient({ region: process.env.REGION });
const textract = new TextractClient({ region: process.env.REGION });
const s3 = new S3Client({ region: process.env.REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};



const extractLicensePlateText = (textDetections) => {
  console.log('Starting license plate text extraction...');
  console.log('Input text detections:', JSON.stringify(textDetections, null, 2));
  
  // Extract and clean all text lines
  const cleanedLines = textDetections
    .filter(detection => detection.Type === 'LINE')
    .map(detection => {
      let text = detection.DetectedText
        .replace(/[^A-Z0-9]/g, '')  // Remove all non-alphanumeric
        .toUpperCase();
      
      // Fix common OCR mistakes
      text = text
        .replace(/O/g, '0')  // O to 0
        .replace(/I/g, '1')  // I to 1
        .replace(/S/g, '5')  // S to 5
        .replace(/Z/g, '2'); // Z to 2
      
      return {
        text,
        geometry: detection.Geometry,
        confidence: detection.Confidence || 0
      };
    })
    .filter(item => item.text.length >= 2 && item.text.length <= 8)  // Individual line length
    .sort((a, b) => {
      // Sort by vertical position (top to bottom)
      const aTop = a.geometry?.BoundingBox?.Top || 0;
      const bTop = b.geometry?.BoundingBox?.Top || 0;
      return aTop - bTop;
    });

  console.log('Cleaned lines:', cleanedLines);
  
  // Return the longest text that looks like a license plate
  const singleLineTexts = cleanedLines.map(item => item.text)
    .filter(text => text.length >= 4 && text.length <= 10)
    .sort((a, b) => b.length - a.length);
  
  console.log('Single line candidates:', singleLineTexts);
  
  if (singleLineTexts.length > 0) {
    console.log('Returning single line result:', singleLineTexts[0]);
    return singleLineTexts[0];
  }

  // Try multi-line combinations for autorickshaw/scooter plates
  if (cleanedLines.length >= 2) {
    const multiLineCombinations = [];
    
    // Try combining consecutive lines
    for (let i = 0; i < cleanedLines.length - 1; i++) {
      const line1 = cleanedLines[i].text;
      const line2 = cleanedLines[i + 1].text;
      
      // Check if lines are close vertically (likely same plate)
      const top1 = cleanedLines[i].geometry?.BoundingBox?.Top || 0;
      const top2 = cleanedLines[i + 1].geometry?.BoundingBox?.Top || 0;
      const verticalDistance = Math.abs(top2 - top1);
      
      if (verticalDistance < 0.1) {  // Lines are close (same plate)
        multiLineCombinations.push(line1 + line2);  // MH12 + 1234 = MH121234
        
        // For autorickshaw format: MH12 + 1234 should become MH121234
        // But we need to handle cases like: MH + 12 + 12 + 34
        if (line1.length <= 4 && line2.length <= 4) {
          multiLineCombinations.push(line1 + line2);
        }
      }
    }
    
    // Return the longest reasonable combination
    const validCombinations = multiLineCombinations
      .filter(text => text.length >= 4 && text.length <= 12)
      .sort((a, b) => b.length - a.length);
    
    if (validCombinations.length > 0) {
      return validCombinations[0];
    }
  }
  
  return null;
};

// Extract license plate text from bounding box area
const extractLicensePlateFromBoundingBox = async (imageBuffer, boundingBox) => {
  try {
    console.log('Extracting text from license plate bounding box:', boundingBox);
    
    // Use OCR on the full image and filter results within bounding box area
    const textResult = await rekognition.send(new DetectTextCommand({
      Image: { Bytes: imageBuffer }
    }));
    
    if (!textResult.TextDetections || textResult.TextDetections.length === 0) {
      return null;
    }
    
    // Filter text detections that overlap with license plate bounding box
    const licensePlateTexts = textResult.TextDetections
      .filter(detection => {
        if (!detection.Geometry?.BoundingBox || detection.Type !== 'LINE') return false;
        
        const textBox = detection.Geometry.BoundingBox;
        const plateBox = boundingBox;
        
        // Check if text box overlaps with license plate box
        const overlap = (
          textBox.Left < plateBox.Left + plateBox.Width &&
          textBox.Left + textBox.Width > plateBox.Left &&
          textBox.Top < plateBox.Top + plateBox.Height &&
          textBox.Top + textBox.Height > plateBox.Top
        );
        
        return overlap;
      })
      .map(detection => detection.DetectedText.replace(/[^A-Z0-9]/g, '').toUpperCase())
      .filter(text => text.length >= 4 && text.length <= 10)
      .sort((a, b) => b.length - a.length);
    
    console.log('Filtered license plate texts from bounding box:', licensePlateTexts);
    return licensePlateTexts.length > 0 ? licensePlateTexts[0] : null;
  } catch (error) {
    console.error('Error extracting license plate text from bounding box:', error);
    return null;
  }
};

const checkExistingLicensePlate = async (licensePlate, userId) => {
  if (!licensePlate || licensePlate === 'NOT_DETECTED') return null;
  
  try {
    const result = await dynamodb.send(new ScanCommand({
      TableName: process.env.DETECTIONS_TABLE,
      FilterExpression: 'licensePlate = :plate AND userId = :userId',
      ExpressionAttributeValues: {
        ':plate': licensePlate,
        ':userId': userId
      },
      Limit: 1
    }));
    
    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
  } catch (error) {
    console.error('Error checking existing license plate:', error);
    return null;
  }
};



exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    console.log('DetectLicensePlate called with body:', event.body);
    console.log('Headers:', JSON.stringify(event.headers));
    
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    const { image, sourceType } = JSON.parse(event.body);
    
    if (!image) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Image required' })
      };
    }

    // Extract userId from JWT token
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      console.log('No token found in headers');
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

    // Convert base64 to buffer for AI processing
    const imageBuffer = Buffer.from(image.replace(/^data:image\/[a-z]+;base64,/, ''), 'base64');
    
    let licensePlate = null;
    let confidence = 0;
    let method = 'none';

    const modelArn = 'arn:aws:rekognition:eu-central-1:718154142916:project/Camlytics/version/Camlytics.2025-11-12T01.37.05/1762891626211';
    console.log('Using custom model ARN:', modelArn);

    try {
      console.log('Starting Custom Labels detection...');
      // Try Custom Labels first
      const customResult = await rekognition.send(new DetectCustomLabelsCommand({
        Image: { Bytes: imageBuffer },
        ProjectVersionArn: modelArn,
        MinConfidence: 60
      }));

      console.log('Custom Labels response:', JSON.stringify(customResult, null, 2));
      console.log('Number of custom labels detected:', customResult.CustomLabels?.length || 0);

      // Find license plate label
      const licensePlateLabel = customResult.CustomLabels?.find(label => 
        label.Name === 'licenseplate'
      );
      
      if (licensePlateLabel && licensePlateLabel.Geometry?.BoundingBox) {
        console.log('License plate detected by custom model, extracting text from bounding box');
        licensePlate = await extractLicensePlateFromBoundingBox(imageBuffer, licensePlateLabel.Geometry.BoundingBox);
        confidence = Math.round(licensePlateLabel.Confidence);
        method = 'custom-model';
        console.log('Extracted license plate:', licensePlate, 'with confidence:', confidence);
      } else {
        console.log('No license plate detected by custom model');
      }
    } catch (customError) {
      console.error('Custom Labels failed:', customError);
      if (customError.Code === 'ResourceNotReadyException') {
        console.log('Custom model not running, falling back to OCR');
      }
    }

    // Fallback to OCR if custom model didn't work
    if (!licensePlate) {
      try {
        console.log('Falling back to OCR text detection...');
        const rekognitionResult = await rekognition.send(new DetectTextCommand({
          Image: { Bytes: imageBuffer }
        }));

        console.log('OCR response received:', JSON.stringify(rekognitionResult, null, 2));
        console.log('Number of text detections:', rekognitionResult.TextDetections?.length || 0);

        if (rekognitionResult.TextDetections && rekognitionResult.TextDetections.length > 0) {
          console.log('Extracting license plate from OCR detections...');
          licensePlate = extractLicensePlateText(rekognitionResult.TextDetections);
          console.log('Extracted license plate:', licensePlate);
          
          if (licensePlate) {
            method = 'ocr-fallback';
            const confidenceValues = rekognitionResult.TextDetections
              .filter(d => d.DetectedText && d.DetectedText.includes(licensePlate))
              .map(d => d.Confidence || 0)
              .filter(c => c > 0 && isFinite(c));
            confidence = confidenceValues.length > 0 ? Math.max(...confidenceValues) : 75;
            console.log('OCR confidence values:', confidenceValues);
            console.log('Final confidence:', confidence);
          }
        }
      } catch (ocrError) {
        console.error('OCR failed:', ocrError);
      }
    }

    // Final fallback to Textract
    if (!licensePlate) {
      try {
        console.log('Final fallback to Textract...');
        const textractResult = await textract.send(new DetectDocumentTextCommand({
          Document: { Bytes: imageBuffer }
        }));

        if (textractResult.Blocks) {
          const textBlocks = textractResult.Blocks
            .filter(block => block.BlockType === 'LINE')
            .map(block => ({ DetectedText: block.Text, Type: 'LINE' }));
          
          licensePlate = extractLicensePlateText(textBlocks);
          if (licensePlate) {
            method = 'textract-fallback';
            confidence = 85;
            console.log('Textract extracted:', licensePlate);
          }
        }
      } catch (textractError) {
        console.log('Textract also failed:', textractError.message);
      }
    }

    console.log('Final detection results:', {
      licensePlate,
      confidence,
      method,
      sourceType: sourceType || 'image'
    });

    // Check if license plate already exists for this user
    if (licensePlate && licensePlate !== 'NOT_DETECTED') {
      console.log('Checking for existing license plate:', licensePlate);
      const existingRecord = await checkExistingLicensePlate(licensePlate, userId);
      if (existingRecord) {
        console.log('Found existing record, returning cached result:', existingRecord);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            licensePlate,
            confidence: existingRecord.confidence,
            method: existingRecord.detectionMethod,
            sourceType: sourceType || 'image',
            cached: true,
            message: 'License plate already exists in your records'
          })
        };
      } else {
        console.log('No existing record found, proceeding with new detection');
      }
    }

    // Store new detection (only if not duplicate)
    const imageId = uuidv4();
    const s3Key = `license-plates/${userId}/${imageId}.jpg`;

    // Upload to S3
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
      Body: imageBuffer,
      ContentType: 'image/jpeg'
    }));

    // Store result in DynamoDB
    const finalConfidence = isFinite(confidence) && confidence > 0 ? Math.round(confidence) : 0;
    const detectionRecord = {
      id: imageId,
      userId,
      s3Key,
      imageUrl: `s3://${process.env.S3_BUCKET}/${s3Key}`,
      licensePlate: licensePlate || 'NOT_DETECTED',
      confidence: finalConfidence,
      detectionMethod: method,
      timestamp: new Date().toISOString(),
      featureType: 'license-plate',
      sourceType: sourceType || 'image'
    };

    await dynamodb.send(new PutCommand({
      TableName: process.env.DETECTIONS_TABLE,
      Item: detectionRecord
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        detectionId: imageId,
        licensePlate,
        confidence: finalConfidence,
        method,
        cached: false,
        imageUrl: `https://${process.env.S3_BUCKET}.s3.${process.env.REGION}.amazonaws.com/${s3Key}`
      })
    };

  } catch (error) {
    console.error('Detection error:', error);
    
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
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Detection failed',
        details: error.message 
      })
    };
  }
};