require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createObjectCsvWriter } = require('csv-writer');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Config ----------
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'jwt_secret_change_me';
const PORT = process.env.PORT || 5000;

if (!MONGO_URI) {
  console.error('MONGO_URI is required in environment variables');
  process.exit(1);
}

// ---------- Connect DB ----------
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('✅ MongoDB connected'))
  .catch(err => { console.error('MongoDB connection error', err); process.exit(1); });

// ---------- Models ----------
const auditSchema = new mongoose.Schema({
  action: String,
  actorId: mongoose.Schema.Types.ObjectId,
  actorName: String,
  timestamp: { type: Date, default: Date.now },
  detail: mongoose.Schema.Types.Mixed
});
const Audit = mongoose.model('Audit', auditSchema);

const userSchema = new mongoose.Schema({
  role: { type: String, enum: ['manager','worker'], default: 'worker' },
  name: String,
  username: { type: String, unique: true, sparse: true },
  password: String,
  groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const groupSchema = new mongoose.Schema({
  name: String,
  leaderName: String,
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', groupSchema);

const memberSchema = new mongoose.Schema({
  name: String,
  address: String,
  aadhaar: { type: String, index: true },
  contact: String,
  loanDate: Date,
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});
const Member = mongoose.model('Member', memberSchema);

const loanSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  principal: Number,
  interest: Number,
  totalAmount: Number,
  emiCount: Number,
  emiAmount: Number,
  emiIntervalDays: { type: Number, default: 14 },
  startDate: Date,
  schedule: [{ dueDate: Date, amount: Number, paid: { type: Boolean, default: false }, paidAt: Date }],
  status: { type: String, enum: ['Active','Completed','Defaulted'], default: 'Active' },
  createdAt: { type: Date, default: Date.now }
});
const Loan = mongoose.model('Loan', loanSchema);

const paymentSchema = new mongoose.Schema({
  loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number,
  date: { type: Date, default: Date.now }
});
const Payment = mongoose.model('Payment', paymentSchema);

// ---------- Utilities ----------
function logAudit(action, actor, detail = null) {
  const entry = new Audit({ action, actorId: actor?.id || null, actorName: actor?.name || null, detail });
  entry.save().catch(()=>{});
}

function generateEMISchedule(totalAmount, emiCount, startDate, intervalDays) {
  const emiAmount = +((totalAmount / emiCount).toFixed(2));
  const schedule = [];
  let dt = new Date(startDate);
  for (let i = 0; i < emiCount; i++) {
    schedule.push({ dueDate: new Date(dt), amount: emiAmount, paid: false });
    dt = new Date(dt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  }
  return { emiAmount, schedule };
}

function authMiddleware(requiredRole) {
  return async (req, res, next) => {
    const h = req.headers.authorization;
    if (!h) return res.status(401).json({ message: 'Missing Authorization' });
    const token = h.split(' ')[1];
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      next();
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
  };
}

// ---------- Bootstrap default users ----------
async function ensureDefaults() {
  const manager = await User.findOne({ role: 'manager' });
  if (!manager) {
    const m = new User({ role: 'manager', name: 'Admin', username: 'admin', password: '123123' });
    await m.save();
    console.log('Default manager created (username: admin, password: 123123)');
  }
  const workers = [
    { name: 'Purnima Dolui', username: 'purnima', password: 'purnima123' },
    { name: 'Seema Banerjee', username: 'seema', password: 'seema123' },
    { name: 'Kuhely Mondal', username: 'kuhely', password: 'kuhely123' },
    { name: 'Ranu', username: 'ranu', password: 'ranu123' },
    { name: 'New Worker', username: 'newworker', password: 'new123' }
  ];
  for (const w of workers) {
    const exists = await User.findOne({ username: w.username });
    if (!exists) await new User({ ...w, role: 'worker' }).save();
  }
}
ensureDefaults().catch(console.error);

// ---------- Routes ----------
app.get('/', (req, res) => res.send('Loan Management Backend OK ✅'));

// login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username, password });
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, id: user._id, role: user.role, name: user.name });
});

// (all other routes are same — included in your code above)
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
