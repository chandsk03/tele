const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const cors = require('cors');
const { URLSearchParams } = require('url');
const app = express();

// Enhanced configuration
app.use(cors({
  origin: ['https://telegram.org', 'https://web.telegram.org'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data']
}));
app.use(bodyParser.json());
require('dotenv').config();

// Database connection with retry
const connectWithRetry = () => {
  mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    retryWrites: true
  })
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    setTimeout(connectWithRetry, 5000);
  });
};
connectWithRetry();

// Enhanced schemas
const userSchema = new mongoose.Schema({
  user_id: { type: Number, required: true, unique: true, index: true },
  first_name: { type: String, required: true },
  last_name: String,
  created_at: { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
  room_id: { type: String, required: true, unique: true, index: true },
  room_name: { type: String, required: true, trim: true, minlength: 1 },
  created_by: { type: Number, required: true, index: true },
  members: [{ type: Number, index: true }],
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);

// Improved Telegram validation middleware
const validateInitData = (req, res, next) => {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const dataCheckString = Array.from(params.entries())
      .filter(([key]) => key !== 'hash')
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();
    
    const computedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== hash) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  } catch (error) {
    console.error('Validation error:', error);
    res.status(400).json({ error: 'Invalid initData format' });
  }
};

// Enhanced API endpoints

// Updated validation middleware to extract user data
const parseInitData = (req, res, next) => {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const params = new URLSearchParams(initData);
    req.telegramUser = {
      id: parseInt(params.get('user_id')),
      first_name: params.get('user_first_name'),
      last_name: params.get('user_last_name') || '',
      username: params.get('user_username') || '',
      language: params.get('user_language_code') || 'en'
    };
    next();
  } catch (error) {
    console.error('InitData parsing error:', error);
    res.status(400).json({ error: 'Invalid initData format' });
  }
};

// Combined validation middleware
const validateAndParseInitData = [validateInitData, parseInitData];

// Auth endpoint
app.post('/api/auth', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    
    // Validate initData
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const dataCheckString = Array.from(params.entries())
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();
    
    const computedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== hash) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Extract user data
    const userData = {
      id: parseInt(params.get('user_id')),
      first_name: params.get('user_first_name'),
      last_name: params.get('user_last_name') || '',
      username: params.get('user_username') || ''
    };

    // Create/update user
    const user = await User.findOneAndUpdate(
      { user_id: userData.id },
      userData,
      { new: true, upsert: true }
    );

    res.json({ success: true, user });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Room creation with validation
app.post('/rooms', validateInitData, async (req, res) => {
  try {
    const { room_name, user_id } = req.body;
    if (!room_name?.trim() || !user_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const user = await User.findById(user_id).session(session);
      if (!user) throw new Error('User not found');

      const room = new Room({
        room_id: crypto.randomBytes(8).toString('hex'),
        room_name: room_name.trim(),
        created_by: user_id,
        members: [user_id]
      });

      await room.save({ session });
      await session.commitTransaction();
      res.json({ success: true, room });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Room creation failed', details: err.message });
  }
});

// Get user rooms with pagination
app.get('/rooms', validateInitData, async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

    const rooms = await Room.find({ members: user_id })
      .sort({ created_at: -1 })
      .lean();

    res.json({ success: true, rooms });
  } catch (err) {
    console.error('Get rooms error:', err);
    res.status(500).json({ error: 'Failed to fetch rooms', details: err.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
