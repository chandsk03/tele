const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { URLSearchParams } = require('url');
const app = express();

// Middleware
app.use(bodyParser.json());

// Load environment variables
require('dotenv').config();

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb+srv://chand37880:Ironman1243@telegram-mini-app.z6e1a.mongodb.net/telegram_mini_app?retryWrites=true&w=majority')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB Connection Error:', err.message);
    process.exit(1);
  });

// User Schema
const userSchema = new mongoose.Schema({
  user_id: Number,
  first_name: String,
  last_name: String,
});

// Room Schema
const roomSchema = new mongoose.Schema({
  room_id: String,
  room_name: String,
  created_by: Number,
  members: [Number],
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);

// Telegram Bot
const bot = new TelegramBot(process.env.BOT_TOKEN || '8103505258:AAFjPTARUAHxoX5KAJPg71RWT7_AULfKd0k', { polling: true });

// Generate a unique room ID
const generateRoomId = () => crypto.randomBytes(8).toString('hex');

// Validate Telegram initData
const validateInitData = (req, res, next) => {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) {
    return res.status(401).json({ error: 'Unauthorized: Missing initData' });
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    return res.status(401).json({ error: 'Unauthorized: Invalid initData' });
  }

  next();
};

// API Endpoints

// User Authentication
app.post('/auth', validateInitData, async (req, res) => {
  try {
    const { user_id, first_name, last_name } = req.body;
    const user = new User({ user_id, first_name, last_name });
    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    console.error('Error in /auth:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create Room
app.post('/create-room', validateInitData, async (req, res) => {
  try {
    const { room_name, created_by } = req.body;
    const room_id = generateRoomId();
    const room = new Room({ room_id, room_name, created_by, members: [created_by] });
    await room.save();
    res.json({ success: true, room_id });
  } catch (err) {
    console.error('Error in /create-room:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Join Room
app.post('/join-room', validateInitData, async (req, res) => {
  try {
    const { room_id, user_id } = req.body;
    const room = await Room.findOne({ room_id });
    if (room) {
      if (!room.members.includes(user_id)) {
        room.members.push(user_id);
        await room.save();
      }
      res.json({ success: true, room });
    } else {
      res.status(404).json({ error: 'Room not found' });
    }
  } catch (err) {
    console.error('Error in /join-room:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Delete Room
app.post('/delete-room', validateInitData, async (req, res) => {
  try {
    const { room_id, user_id } = req.body;
    const room = await Room.findOne({ room_id });
    if (room && room.created_by === user_id) {
      await Room.deleteOne({ room_id });
      res.json({ success: true });
    } else {
      res.status(403).json({ error: 'You are not authorized to delete this room' });
    }
  } catch (err) {
    console.error('Error in /delete-room:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Exit Room
app.post('/exit-room', validateInitData, async (req, res) => {
  try {
    const { room_id, user_id } = req.body;
    const room = await Room.findOne({ room_id });
    if (room) {
      room.members = room.members.filter((member) => member !== user_id);
      await room.save();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Room not found' });
    }
  } catch (err) {
    console.error('Error in /exit-room:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get Rooms for a User
app.get('/rooms', validateInitData, async (req, res) => {
  try {
    const { user_id } = req.query;
    const rooms = await Room.find({ members: user_id });
    res.json(rooms);
  } catch (err) {
    console.error('Error in /rooms:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});