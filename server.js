const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const dns = require('dns');
require('dotenv').config();

// Ensure DNS SRV records resolve cleanly on Windows
if (process.platform === 'win32') {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {}
}

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://CAYCSpecialInvitation:CAYCSpecialInvitation@cluster0.dlubize.mongodb.net/goldilocks_db?retryWrites=true&w=majority';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'CAYC2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (from public build or root)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// Serverless-friendly MongoDB Connection Caching
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!MONGODB_URI || MONGODB_URI.includes('<username>') || MONGODB_URI.includes('<password>')) {
    console.warn('⚠️ MongoDB Atlas URI is not configured yet.');
    return null;
  }

  // Reset cached promise if disconnected or failed
  if (!cached.promise || mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
    }).then(m => {
      console.log('✅ Connected to MongoDB Atlas successfully!');
      return m;
    }).catch(err => {
      cached.promise = null;
      console.error('❌ MongoDB Atlas connection error:', err.message);
      throw err;
    });
  }

  try {
    await cached.promise;
    let attempts = 0;
    while (mongoose.connection.readyState !== 1 && attempts < 25) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    return mongoose.connection;
  } catch (err) {
    cached.promise = null;
    console.error('❌ MongoDB Atlas connection error:', err.message);
    return null;
  }
}

// Initial connection for local dev
if (MONGODB_URI && !MONGODB_URI.includes('<username>')) {
  connectDB();
}

// ---------------- Helper Utilities ----------------
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit ambiguous 0, O, 1, I
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `CAYC-${rand}`;
}

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('63')) return digits.slice(2);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function normalizeName(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------- Schemas & Models ----------------

// 1. RSVP Model
const rsvpSchema = new mongoose.Schema({
  guestNo: { type: String, required: true },
  inviteCode: { type: String, uppercase: true, trim: true, index: true },
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

// Enforce strict uniqueness: only one successful (accepted) registrant per unique invitation link
rsvpSchema.index(
  { inviteCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      response: 'accepted',
      inviteCode: { $type: 'string', $gt: '' }
    }
  }
);

const RSVP = mongoose.models.RSVP || mongoose.model('RSVP', rsvpSchema);

// 2. Invitation Link Model
const inviteSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
  recipientName: { type: String, default: '', trim: true },
  status: { type: String, enum: ['available', 'used', 'declined'], default: 'available' },
  usedAt: { type: Date },
  guest: {
    guestNo: String,
    first: String,
    last: String,
    name: String,
    email: String,
    mobile: String,
    social: [String],
    address: String
  },
  createdAt: { type: Date, default: Date.now }
});

const Invite = mongoose.models.Invite || mongoose.model('Invite', inviteSchema);

// Admin authentication middleware
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key || req.body?.key;
  if (!key || key !== ADMIN_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid Admin PIN' });
  }
  next();
}

// ---------------- API Router ----------------
const apiRouter = express.Router();

// 1. Verify Invitation Link by Code
apiRouter.get('/invite/verify', async (req, res) => {
  try {
    const rawCode = req.query.code || req.query.invite;
    if (!rawCode) {
      return res.status(400).json({ ok: false, error: 'missing_code', message: 'No invitation code provided.' });
    }

    const code = String(rawCode).trim().toUpperCase();
    await connectDB();

    if (mongoose.connection.readyState === 1) {
      const invite = await Invite.findOne({ code });
      if (!invite) {
        return res.status(404).json({ ok: false, error: 'not_found', message: 'Invitation link does not exist.' });
      }

      return res.json({
        ok: true,
        code: invite.code,
        status: invite.status,
        recipientName: invite.recipientName || '',
        usedAt: invite.usedAt || null,
        guestRegistered: invite.status === 'used'
      });
    } else {
      return res.status(503).json({ ok: false, error: 'db_connecting', message: 'Database connection in progress.' });
    }
  } catch (err) {
    console.error('Verify invite error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. Claim / View Guest Pass for Already Used Invitation
apiRouter.post('/invite/claim-pass', async (req, res) => {
  try {
    const { code: rawCode, fullName, mobile } = req.body;
    if (!rawCode || !fullName || !mobile) {
      return res.status(400).json({ ok: false, error: 'Please provide both your Full Name and Mobile Number.' });
    }

    const code = String(rawCode).trim().toUpperCase();
    await connectDB();

    let invite = null;
    if (mongoose.connection.readyState === 1) {
      invite = await Invite.findOne({ code });
    }

    if (!invite) {
      return res.status(404).json({ ok: false, error: 'Invitation not found.' });
    }

    if (invite.status !== 'used') {
      return res.status(400).json({ ok: false, error: 'This invitation has not been registered yet.' });
    }

    let guestRecord = invite.guest;
    if (!guestRecord || (!guestRecord.mobile && !guestRecord.name)) {
      guestRecord = await RSVP.findOne({ inviteCode: code, response: 'accepted' });
    }

    if (!guestRecord) {
      return res.status(400).json({ ok: false, error: 'Registered guest details not found.' });
    }

    // Check full name and mobile
    const inputNameNorm = normalizeName(fullName);
    const guestNameNorm = normalizeName(guestRecord.name || `${guestRecord.first || ''} ${guestRecord.last || ''}`);
    const inputPhoneNorm = normalizePhone(mobile);
    const guestPhoneNorm = normalizePhone(guestRecord.mobile);

    const nameMatches = inputNameNorm === guestNameNorm ||
      (guestNameNorm.includes(inputNameNorm) && inputNameNorm.length >= 3) ||
      (inputNameNorm.includes(guestNameNorm) && guestNameNorm.length >= 3);

    const phoneMatches = inputPhoneNorm === guestPhoneNorm ||
      (inputPhoneNorm.length >= 7 && guestPhoneNorm.endsWith(inputPhoneNorm)) ||
      (guestPhoneNorm.length >= 7 && inputPhoneNorm.endsWith(guestPhoneNorm));

    if (!nameMatches || !phoneMatches) {
      return res.status(401).json({
        ok: false,
        error: 'The entered Full Name or Contact Number does not match the registered guest for this invitation.'
      });
    }

    // Match confirmed: return guest pass details
    return res.json({
      ok: true,
      pass: {
        name: guestRecord.name || `${guestRecord.first || ''} ${guestRecord.last || ''}`.trim(),
        first: guestRecord.first,
        last: guestRecord.last,
        no: guestRecord.guestNo || '001',
        code: invite.code,
        email: guestRecord.email,
        mobile: guestRecord.mobile
      }
    });
  } catch (err) {
    console.error('Claim pass error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Submit RSVP (One-time registration per unique link)
apiRouter.post('/rsvp', async (req, res) => {
  try {
    const { first, last, email, mobile, social, address, code: rawCode } = req.body;

    if (!first || !last || !email || !mobile) {
      return res.status(400).json({ ok: false, error: 'Required fields missing' });
    }

    const fullName = `${first.trim()} ${last.trim()}`;
    const code = rawCode ? String(rawCode).trim().toUpperCase() : null;

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_link',
        message: 'This link is not valid. An official personal invitation link is required to RSVP.'
      });
    }

    await connectDB();

    if (mongoose.connection.readyState === 1) {
      const invite = await Invite.findOne({ code });
      if (!invite) {
        return res.status(400).json({
          ok: false,
          error: 'invalid_link',
          message: 'This link is not valid. This invitation code was not found in the official guest list.'
        });
      }

      if (invite.status === 'used') {
        return res.status(400).json({
          ok: false,
          error: 'already_used',
          message: 'This invitation link has already been used and registered. Each unique link can only be used once.'
        });
      }

      // Strict check: verify no accepted RSVP already exists for this unique code
      const existingRsvp = await RSVP.findOne({ inviteCode: code, response: 'accepted' });
      if (existingRsvp) {
        if (invite.status !== 'used') {
          invite.status = 'used';
          await invite.save();
        }
        return res.status(400).json({
          ok: false,
          error: 'already_used',
          message: 'This invitation link has already been registered. Each unique link can only be used once.'
        });
      }

      // Calculate sequential guest pass number
      const acceptedCount = await RSVP.countDocuments({ response: 'accepted' });
      const guestNoStr = String(acceptedCount + 1).padStart(3, '0');

      const guestData = {
        guestNo: guestNoStr,
        first: first.trim(),
        last: last.trim(),
        name: fullName,
        email: email.trim(),
        mobile: mobile.trim(),
        social: Array.isArray(social) ? social : [],
        address: address ? address.trim() : ''
      };

      // Atomic document-level claim: only update if status is still available or declined!
      // This prevents race conditions from allowing two simultaneous registrants on the same link.
      const updatedInvite = await Invite.findOneAndUpdate(
        { code, status: { $in: ['available', 'declined'] } },
        {
          $set: {
            status: 'used',
            usedAt: new Date(),
            guest: guestData
          }
        },
        { new: true }
      );

      if (!updatedInvite) {
        return res.status(400).json({
          ok: false,
          error: 'already_used',
          message: 'This invitation link has already been registered. Each unique link can only be used once.'
        });
      }

      // Clear any prior declined entry so only this single accepted registration exists
      await RSVP.deleteMany({ inviteCode: code, response: 'declined' });

      // Save RSVP record (protected also by unique partial index in DB)
      try {
        const rsvpDoc = new RSVP({
          ...guestData,
          inviteCode: code,
          response: 'accepted',
          createdAt: new Date()
        });
        await rsvpDoc.save();
      } catch (err) {
        if (err.code === 11000) {
          return res.status(400).json({
            ok: false,
            error: 'already_used',
            message: 'This invitation link has already been registered.'
          });
        }
        throw err;
      }

      console.log(`Saved RSVP to MongoDB Atlas: ${fullName} (GUEST ${guestNoStr}) [Invite: ${code}]`);

      return res.json({
        ok: true,
        source: 'mongodb-atlas',
        no: guestNoStr,
        guest: guestData
      });
    } else {
      return res.status(503).json({
        ok: false,
        error: 'service_unavailable',
        message: 'Guest list server connection in progress. Please click submit again in 2 seconds.'
      });
    }
  } catch (err) {
    console.error('Error saving RSVP:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Decline RSVP
apiRouter.post('/rsvp/decline', async (req, res) => {
  try {
    const { code: rawCode } = req.body;
    const code = rawCode ? String(rawCode).trim().toUpperCase() : null;
    await connectDB();

    if (mongoose.connection.readyState === 1) {
      if (code) {
        const invite = await Invite.findOne({ code });
        if (invite) {
          if (invite.status === 'used') {
            return res.status(400).json({
              ok: false,
              error: 'already_used',
              message: 'This invitation has already been used and cannot be changed.'
            });
          }
          invite.status = 'declined';
          invite.usedAt = new Date();
          await invite.save();
          // Remove duplicate decline records for this code
          await RSVP.deleteMany({ inviteCode: code, response: 'declined' });
        }
      }
      const declineDoc = new RSVP({
        guestNo: 'N/A',
        inviteCode: code || 'DIRECT',
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

// 5. Public Guest list summary
apiRouter.get('/rsvps', async (req, res) => {
  try {
    await connectDB();
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
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. Health
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

// ---------------- Admin Management Endpoints ----------------

// Verify Admin PIN / Password
apiRouter.post('/admin/auth', (req, res) => {
  const { pin } = req.body;
  if (pin && pin === ADMIN_SECRET) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Invalid Admin PIN' });
});

// Get Admin Overview (Stats & all invitation links)
apiRouter.get('/admin/overview', requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const invites = await Invite.find().sort({ createdAt: -1 });
    const total = invites.length;
    const available = invites.filter(i => i.status === 'available').length;
    const used = invites.filter(i => i.status === 'used').length;
    const declined = invites.filter(i => i.status === 'declined').length;

    res.json({
      ok: true,
      stats: { total, available, used, declined },
      invites
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create Invitation Link(s)
apiRouter.post('/admin/create-link', requireAdmin, async (req, res) => {
  try {
    const { count = 1, recipientName = '' } = req.body;
    const numToCreate = Math.min(Math.max(parseInt(count, 10) || 1, 1), 50);
    await connectDB();

    const created = [];
    for (let i = 0; i < numToCreate; i++) {
      let code = generateCode();
      while (await Invite.findOne({ code })) {
        code = generateCode();
      }
      const doc = new Invite({
        code,
        recipientName: numToCreate === 1 ? recipientName.trim() : '',
        status: 'available',
        createdAt: new Date()
      });
      await doc.save();
      created.push(doc);
    }

    res.json({ ok: true, count: created.length, created });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete an invitation link
apiRouter.post('/admin/delete-link', requireAdmin, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ ok: false, error: 'Missing code' });
    await connectDB();

    const normalizedCode = code.toUpperCase();
    await Invite.deleteOne({ code: normalizedCode });
    await RSVP.deleteMany({ inviteCode: normalizedCode });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Reset an invitation link back to available
apiRouter.post('/admin/reset-link', requireAdmin, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ ok: false, error: 'Missing code' });
    await connectDB();

    const normalizedCode = code.toUpperCase();
    await Invite.updateOne(
      { code: normalizedCode },
      { $set: { status: 'available' }, $unset: { usedAt: '', guest: '' } }
    );
    await RSVP.deleteMany({ inviteCode: normalizedCode });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Mount router on both /api and root
app.use('/api', apiRouter);
app.use('/', apiRouter);

// Local start
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(` Goldilocks Server running at http://localhost:${PORT}`);
    console.log(` Database: MongoDB Atlas`);
    console.log(` Admin Dashboard: http://localhost:${PORT}/admin.html`);
    console.log(` Health check: http://localhost:${PORT}/api/health`);
    console.log(`===============================================`);
  });
}

module.exports = app;
