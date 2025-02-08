const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const cors = require('cors');
const { URLSearchParams } = require('url');
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
require('dotenv').config();

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => {
  console.error('MongoDB Connection Error:', err.message);
  process.exit(1);
});

// Schemas
const userSchema = new mongoose.Schema({
  user_id: { type: Number, unique: true },
  first_name: String,
  last_name: String,
});

const roomSchema = new mongoose.Schema({
  room_id: { type: String, unique: true },
  room_name: String,
  created_by: Number,
  members: [Number],
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);

// Telegram Bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Helpers
const generateRoomId = () => crypto.randomBytes(8).toString('hex');

// Telegram Validation Middleware
const validateInitData = (req, res, next) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });

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

    next();
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ error: 'Validation failed' });
  }
};

// API Endpoints

// User Authentication
app.post('/auth', validateInitData, async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { user_id: req.body.user_id },
      req.body,
      { new: true, upsert: true }
    );
    res.json({ success: true, user });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Create Room
app.post('/rooms', validateInitData, async (req, res) => {
  try {
    const room = new Room({
      room_id: generateRoomId(),
      room_name: req.body.room_name,
      created_by: req.body.user_id,
      members: [req.body.user_id]
    });
    
    await room.save();
    res.json({ success: true, room });
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Room creation failed' });
  }
});

// Get User Rooms
app.get('/rooms', validateInitData, async (req, res) => {
  try {
    const rooms = await Room.find({ members: req.query.user_id });
    res.json({ success: true, rooms });
  } catch (err) {
    console.error('Get rooms error:', err);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Join Room
app.put('/rooms/:id/join', validateInitData, async (req, res) => {
  try {
    const room = await Room.findOneAndUpdate(
      { room_id: req.params.id },
      { $addToSet: { members: req.body.user_id } },
      { new: true }
    );

    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ success: true, room });
  } catch (err) {
    console.error('Join room error:', err);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Exit Room
app.put('/rooms/:id/exit', validateInitData, async (req, res) => {
  try {
    const room = await Room.findOneAndUpdate(
      { room_id: req.params.id },
      { $pull: { members: req.body.user_id } },
      { new: true }
    );

    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ success: true, room });
  } catch (err) {
    console.error('Exit room error:', err);
    res.status(500).json({ error: 'Failed to exit room' });
  }
});

// Delete Room
app.delete('/rooms/:id', validateInitData, async (req, res) => {
  try {
    const room = await Room.findOne({ room_id: req.params.id });
    
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.created_by !== req.body.user_id) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    await Room.deleteOne({ room_id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete room error:', err);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
