const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Health check
app.get('/', function(req, res) {
  res.json({ status: 'GRIOTTE API en ligne', version: '1.0' });
});

// Test DB
app.get('/test', async function(req, res) {
  try {
    var result = await db.query('SELECT NOW() as time');
    res.json({ ok: true, time: result.rows[0].time });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// AUTH - Register
app.post('/auth/register', async function(req, res) {
  try {
    var name = req.body.name;
    var email = req.body.email;
    var password = req.body.password;
    var role = req.body.role || 'reader';
    
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Champs requis manquants' });
    
    var existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'Email déjà utilisé' });
    
    var credits = role === 'reader' ? 500 : 0;
    var result = await db.query(
      `INSERT INTO users (name, email, password_hash, role, status, credits)
       VALUES ($1, $2, $3, $4, 'active', $5) RETURNING id, name, email, role, credits`,
      [name, email, password, role, credits]
    );
    
    var user = result.rows[0];
    var token = Buffer.from(JSON.stringify({id: user.id, role: user.role})).toString('base64');
    res.status(201).json({ token: token, user: user });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// AUTH - Login
app.post('/auth/login', async function(req, res) {
  try {
    var email = req.body.email;
    var password = req.body.password;
    
    var result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    var user = result.rows[0];
    
    if (!user || user.password_hash !== password)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    
    if (user.status === 'suspended')
      return res.status(403).json({ error: 'Compte suspendu' });
    
    var token = Buffer.from(JSON.stringify({id: user.id, role: user.role})).toString('base64');
    res.json({ token: token, user: {
      id: user.id, name: user.name, email: user.email,
      role: user.role, credits: user.credits
    }});
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// STORIES - Get all
app.get('/stories', async function(req, res) {
  try {
    var result = await db.query(
      `SELECT s.*, u.name as author_name FROM stories s 
       JOIN users u ON u.id = s.author_id 
       WHERE s.status = 'published' ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// STORIES - Get one
app.get('/stories/:id', async function(req, res) {
  try {
    var result = await db.query(
      `SELECT s.*, u.name as author_name FROM stories s 
       JOIN users u ON u.id = s.author_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Histoire introuvable' });
    res.json(result.rows[0]);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ADMIN - Stats
app.get('/admin/stats', async function(req, res) {
  try {
    var users = await db.query("SELECT COUNT(*) FROM users");
    var stories = await db.query("SELECT COUNT(*) FROM stories WHERE status='published'");
    res.json({
      users: parseInt(users.rows[0].count),
      stories: parseInt(stories.rows[0].count)
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Start
db.connect().then(function() {
  console.log('Base de données connectée');
  app.listen(PORT, function() {
    console.log('GRIOTTE API sur le port ' + PORT);
  });
}).catch(function(err) {
  console.error('Erreur DB:', err.message);
  // Start anyway
  app.listen(PORT, function() {
    console.log('GRIOTTE API sur le port ' + PORT + ' (sans DB)');
  });
});
