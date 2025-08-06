# Patient Lab Results Processing System

A healthcare microservice built with TypeScript and Node.js for processing patient lab results asynchronously using BullMQ and Redis.

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   HTTP API      │    │   Redis Queue    │    │  Background     │
│   (Express)     │───▶│   (BullMQ)       │───▶│  Worker         │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ Dead Letter      │    │   Logging       │
                       │ Queue            │    │   (Winston)     │
                       └──────────────────┘    └─────────────────┘
```

## 🚀 Features

- **RESTful API** for lab result submission
- **Asynchronous processing** with BullMQ and Redis
- **Retry mechanism** with exponential backoff (3 attempts)
- **Dead letter queue** for permanently failed jobs
- **Comprehensive logging** with Winston
- **Type safety** with strict TypeScript
- **Input validation** with Joi
- **Unit tests** with Jest
- **Docker support** for easy deployment
- **Health checks** and monitoring endpoints

## 📋 Requirements

- Node.js 18+
- Redis 6+
- TypeScript 5+

## 🛠️ Installation

```bash
# Clone the repository
git clone <repository-url>
cd patient-lab-results-system

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Build the project
npm run build
```

## 🏃‍♂️ Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Docker (includes Redis)
```bash
# Build and run with Docker
npm run docker:build
npm run docker:run
```

## 📡 API Endpoints

### Submit Lab Result
```http
POST /api/lab-results
Content-Type: application/json

{
  "patientId": "12345",
  "labType": "blood",
  "result": "positive",
  "receivedAt": "2025-07-08T10:00:00Z"
}
```

**Valid lab types:** `blood`, `urine`, `tissue`, `other`

**Response:**
```json
{
  "success": true,
  "message": "Lab result queued for processing",
  "jobId": "uuid-job-id"
}
```

### Get System Statistics
```http
GET /api/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "waiting": 5,
    "active": 2,
    "completed": 100,
    "failed": 3,
    "delayed": 1,
    "deadLettered": 2
  }
}
```

### Health Check
```http
GET /api/health
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm test -- --coverage
```

## 📊 Manual Testing Instructions

### 1. Start the Application
```bash
# Option A: With Docker (recommended)
npm run docker:build && npm run docker:run

# Option B: Local Redis + App
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start the application
npm run dev
```

### 2. Submit Lab Results
```bash
# Single valid lab result
curl -X POST http://localhost:3000/api/lab-results \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "12345",
    "labType": "blood",
    "result": "positive",
    "receivedAt": "2025-07-08T10:00:00Z"
  }'

# Batch test - submit multiple results
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/lab-results \
    -H "Content-Type: application/json" \
    -d "{
      \"patientId\": \"patient-$i\",
      \"labType\": \"blood\",
      \"result\": \"test-result-$i\",
      \"receivedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }"
  echo ""
done

# Batch aleatorio LabType, note if labType='generic' must fail for validations
for i in {1..25}; do
  # Array of possible lab types
  labTypes=('blood' 'urine' 'tissue' 'other' 'generic')
  
  # Select random lab type
  randomIndex=$((RANDOM % 5))
  labType=${labTypes[$randomIndex]}
  
  curl -X POST http://localhost:3000/api/lab-results \
    -H "Content-Type: application/json" \
    -d "{
      \"patientId\": \"patient-$i\",
      \"labType\": \"$labType\",
      \"result\": \"test-result-$i\",
      \"receivedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }"
  echo ""
done
```

### 3. Monitor Processing
```bash
# Check system statistics (run multiple times to see changes)
curl http://localhost:3000/api/stats

# Check health
curl http://localhost:3000/api/health
```

### 4. Test Error Handling
```bash
# Invalid lab type
curl -X POST http://localhost:3000/api/lab-results \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "12345",
    "labType": "invalid-type",
    "result": "positive",
    "receivedAt": "2025-07-08T10:00:00Z"
  }'

# Missing required field
curl -X POST http://localhost:3000/api/lab-results \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "12345",
    "result": "positive",
    "receivedAt": "2025-07-08T10:00:00Z"
  }'

# Invalid date format
curl -X POST http://localhost:3000/api/lab-results \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "12345",
    "labType": "blood",
    "result": "positive",
    "receivedAt": "invalid-date"
  }'
```

## 🔧 Configuration 

### Environment Variables (.env) 
```bash 
NODE_ENV=development 
PORT=3000 
REDIS_URL=redis://localhost:6379 
LOG_LEVEL=info 
MAX_RETRIES=3 
JOB_DELAY=1000 
PROCESSING_DELAY=2000 
```

### Processing Behavior 
- **Retry Logic**: Jobs are retried up to 3 times with exponential backoff 
- **Failure Simulation**: ~30% of jobs fail randomly for testing retry mechanism 
- **Processing Time**: Each job takes ~2 seconds to process 
- **Dead Letter**: Jobs moved to dead letter queue after 3 failed attempts 

## 📈 System Monitoring 

Watch the console logs to see: 
- ✅ Job received and queued 
- 🔄 Job processing started 
- ✅ Job completed successfully 
- ❌ Job failed (with retry info) 
- 💀 Job moved to dead letter queue 

## 🚀 Production Considerations 

- **Redis Persistence**: Configure Redis persistence in production 
- **Scaling**: Add multiple worker instances for high throughput 
- **Monitoring**: Add metrics collection (Prometheus, etc.) 
- **Security**: Add rate limiting and request validation 
- **Database**: Replace simulation with actual database operations 

## 🐛 Troubleshooting 

### Common Issues: 
1. **Redis Connection Error**: Ensure Redis is running on port 6379 
2. **Port Already in Use**: Change PORT in .env file 
3. **TypeScript Errors**: Run `npm run build` to check compilation 
4. **Missing Dependencies**: Run `npm install` 

### Logs Location:
- All logs output to console with structured JSON format 
- Use `LOG_LEVEL=debug` for verbose logging 