const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const dns = require('dns');
require('dotenv').config();

// Ensure DNS SRV records resolve cleanly on all networks/Windows
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// Serverless-friendly MongoDB Connection Caching
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!MONGODB_URI || MONGODB_URI.includes('<username>') || MONGODB_URI.includes('<password>')) {
    console.warn('⚠️ MongoDB Atlas URI is not configured yet.');
    return null;
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    }).then(m => {
      console.log('✅ Connected to MongoDB Atlas successfully!');
      return m;
    });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (err) {
    cached.promise = null;
    console.error('❌ MongoDB Atlas connection error:', err.message);
    return null;
  }
}

// Initial connection for local development
if (MONGODB_URI && !MONGODB_URI.includes('<username>')) {
  connectDB();
}

// RSVP Schema & Model (prevent re-compiling in serverless)
const rsvpSchema = new mongoose.Schema({
  guestNo: { type: String, required: true },
  first: { type: String, required: true, trim: true },
  last: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true },
  mobile: { type: String, required: true, trim: true },
  social: [String],
  address: { type: String, default: '' },
  response: { type: String, enum: ['accepted', 'declined'], default: 'accepted' },
  createdAt: { type: Date, default: Date.now }
});

const RSVP = mongoose.models.RSVP || mongoose.model('RSVP', rsvpSchema);

let fallbackCounter = 0;

// API Router
const apiRouter = express.Router();

// 1. Submit RSVP
apiRouter.post('/rsvp', async (req, res) => {
  try {
    const { first, last, email, mobile, social, address } = req.body;

    if (!first || !last || !email || !mobile) {
      return res.status(400).json({ ok: false, error: 'Required fields missing' });
    }

    const fullName = `${first.trim()} ${last.trim()}`;
    const db = await connectDB();

    if (db && mongoose.connection.readyState === 1) {
      const acceptedCount = await RSVP.countDocuments({ response: 'accepted' });
      const guestNoStr = String(acceptedCount + 1).padStart(3, '0');

      const rsvpDoc = new RSVP({
        guestNo: guestNoStr,
        first: first.trim(),
        last: last.trim(),
        name: fullName,
        email: email.trim(),
        mobile: mobile.trim(),
        social: Array.isArray(social) ? social : [],
        address: address ? address.trim() : '',
        response: 'accepted',
        createdAt: new Date()
      });

      await rsvpDoc.save();
      console.log(`Saved RSVP to MongoDB Atlas: ${fullName} (GUEST ${guestNoStr})`);

      return res.json({
        ok: true,
        source: 'mongodb-atlas',
        no: guestNoStr,
        guest: rsvpDoc
      });
    } else {
      fallbackCounter += 1;
      const guestNoStr = String(fallbackCounter).padStart(3, '0');
      return res.json({
        ok: true,
        source: 'local-fallback',
        no: guestNoStr,
        guest: { guestNo: guestNoStr, name: fullName, first, last, email, mobile, social }
      });
    }
  } catch (err) {
    console.error('Error saving RSVP:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. Decline
apiRouter.post('/rsvp/decline', async (req, res) => {
  try {
    const db = await connectDB();
    if (db && mongoose.connection.readyState === 1) {
      const declineDoc = new RSVP({
        guestNo: 'N/A',
        first: 'Declined',
        last: 'Guest',
        name: 'Declined Guest',
        email: 'declined@guest.com',
        mobile: 'N/A',
        response: 'declined',
        createdAt: new Date()
      });
      await declineDoc.save();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Guest list
apiRouter.get('/rsvps', async (req, res) => {
  try {
    const db = await connectDB();
    if (db && mongoose.connection.readyState === 1) {
      const guests = await RSVP.find().sort({ createdAt: -1 });
      const acceptedCount = await RSVP.countDocuments({ response: 'accepted' });
      const declinedCount = await RSVP.countDocuments({ response: 'declined' });
      return res.json({
        ok: true,
        database: 'MongoDB Atlas',
        totalAccepted: acceptedCount,
        totalDeclined: declinedCount,
        guests
      });
    } else {
      return res.json({
        ok: true,
        database: 'Disconnected',
        totalAccepted: fallbackCounter,
        guests: []
      });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Health
apiRouter.get('/health', async (req, res) => {
  await connectDB();
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbStatus = states[mongoose.connection.readyState] || 'unknown';
  res.json({
    status: 'ok',
    database: dbStatus,
    atlasConnected: mongoose.connection.readyState === 1
  });
});

// Mount router on both /api and root to guarantee matching in Vercel serverless rewrites
app.use('/api', apiRouter);
app.use('/', apiRouter);

// Local start
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(` Goldilocks Server running at http://localhost:${PORT}`);
    console.log(` Database: MongoDB Atlas`);
    console.log(` Health check: http://localhost:${PORT}/api/health`);
    console.log(` Guest list API: http://localhost:${PORT}/api/rsvps`);
    console.log(`===============================================`);
  });
}

module.exports = app;
