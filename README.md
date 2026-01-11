# Camlytics - AI-Powered Vehicle Recognition

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
cp .env.example .env
# Edit .env with your JWT secret
```

3. Deploy to AWS:
```bash
npm run deploy
```

## API Endpoints

### Authentication
- `POST /v1/hackathon/camlytics/auth/register` - Register new user
- `POST /v1/hackathon/camlytics/auth/login` - Login user
- `GET /v1/hackathon/camlytics/auth/profile` - Get user profile (requires token)

### Vehicle Detection
- `POST /v1/hackathon/camlytics/detect/license-plate` - Detect license plates
- `POST /v1/hackathon/camlytics/detect/vehicle-parking` - Analyze vehicle parking compliance
- `GET /v1/hackathon/camlytics/detections` - Get detection history

### Request Examples

**Register:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe"
}
```

**Login:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Profile (Header):**
```
Authorization: Bearer <your-jwt-token>
```

**Vehicle Parking Detection:**
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...",
  "sourceType": "image",
  "modelArn": "arn:aws:rekognition:region:account:project/project-name/version/version-name/timestamp"
}
```

**Response:**
```json
{
  "success": true,
  "detectionId": "uuid",
  "parkingStatus": "properly_parked",
  "confidence": 85,
  "detectedLabels": [
    {"name": "properly_parked", "confidence": 85}
  ],
  "imageUrl": "https://bucket.s3.region.amazonaws.com/path"
}
```