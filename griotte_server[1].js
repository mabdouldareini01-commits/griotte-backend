require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- DATABASE ----
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ---- MIDDLEWARE ----
app.use(cors({ origin: '*' }));
app.use(express.json());

// ---- AUTH MIDDLEWARE ----
function auth(roles) {
  return function(req, res, next) {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token requis' });
    try {
      var decoded = jwt.verify(token, process.env.JWT_SECRET || 'griotte_secret_2025');
      if (roles && roles.length && !roles.includes(decoded.role))
        return res.status(403).json({ error: 'Accès refusé' });
      req.user = decoded;
      next();
    } catch(e) {
      res.status(401).json({ error: 'Token invalide' });
    }
  };
}

// ---- HEALTH CHECK ----
app.get('/', function(req, res) {
  res.json({ status: 'GRIOTTE API en ligne', version: '1.0' });
});

// ======================================================
// AUTH
// ======================================================

// POST /auth/register
app.post('/auth/register', async function(req, res) {
  try {
    var { name, email, password, role, country, ref_code } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Champs requis manquants' });
    
    var existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'Email déjà utilisé' });
    
    var hash = await bcrypt.hash(password, 10);
    var bonus = role === 'author' ? 0 : 500;
    
    var result = await db.query(
      `INSERT INTO users (name, email, password_hash, role, status, credits, country)
       VALUES ($1, $2, $3, $4, 'active', $5, $6) RETURNING id, name, email, role, credits`,
      [name, email, hash, role || 'reader', bonus, country || '']
    );
    var user = result.rows[0];
    
    // Bonus transaction
    if (bonus > 0) {
      await db.query(
        `INSERT INTO transactions (user_id, type, amount, label)
         VALUES ($1, 'bonus', $2, 'Bonus inscription')`,
        [user.id, bonus]
      );
    }
    
    // Referral
    if (ref_code) {
      var refUser = await db.query(
        "SELECT id FROM users WHERE UPPER(SUBSTRING(id::text, 1, 6)) = $1",
        [ref_code.toUpperCase()]
      );
      if (refUser.rows.length) {
        await db.query(
          `INSERT INTO referrals (from_user_id, to_user_id) VALUES ($1, $2)`,
          [refUser.rows[0].id, user.id]
        );
      }
    }
    
    var token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'griotte_secret_2025',
      { expiresIn: '7d' }
    );
    
    res.status(201).json({ token, user });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /auth/login
app.post('/auth/login', async function(req, res) {
  try {
    var { email, password } = req.body;
    var result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    var user = result.rows[0];
    
    if (!user || !await bcrypt.compare(password, user.password_hash))
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    
    if (user.status === 'suspended')
      return res.status(403).json({ error: 'Compte suspendu' });
    
    var token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'griotte_secret_2025',
      { expiresIn: '7d' }
    );
    
    res.json({ token, user: {
      id: user.id, name: user.name, email: user.email,
      role: user.role, credits: user.credits, status: user.status
    }});
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /auth/me
app.get('/auth/me', auth(), async function(req, res) {
  try {
    var result = await db.query(
      'SELECT id, name, email, role, credits, status, country, earnings, withdrawn FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ======================================================
// STORIES
// ======================================================

app.get('/stories', async function(req, res) {
  try {
    var { genre, status } = req.query;
    var query = `SELECT s.*, u.name as author_name,
      (SELECT COUNT(*) FROM page_reads WHERE story_id = s.id) as reads,
      (SELECT ROUND(AVG(stars)::numeric,1) FROM reviews WHERE story_id = s.id) as rating
      FROM stories s JOIN users u ON u.id = s.author_id
      WHERE s.status = $1`;
    var params = [status || 'published'];
    if (genre) { params.push(genre); query += ` AND s.genre = $${params.length}`; }
    query += ' ORDER BY s.created_at DESC';
    var result = await db.query(query, params);
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/stories/:id', async function(req, res) {
  try {
    var result = await db.query(
      `SELECT s.*, u.name as author_name,
       (SELECT COUNT(*) FROM page_reads WHERE story_id = s.id) as reads,
       (SELECT ROUND(AVG(stars)::numeric,1) FROM reviews WHERE story_id = s.id) as rating,
       (SELECT COUNT(*) FROM reviews WHERE story_id = s.id) as review_count
       FROM stories s JOIN users u ON u.id = s.author_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Histoire introuvable' });
    res.json(result.rows[0]);
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/stories/:id/pages', auth(), async function(req, res) {
  try {
    var result = await db.query(
      'SELECT * FROM pages WHERE story_id = $1 ORDER BY page_number',
      [req.params.id]
    );
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/stories/:id/read/:pageNum', auth(['reader']), async function(req, res) {
  try {
    var storyId = req.params.id;
    var pageNum = parseInt(req.params.pageNum);
    
    var story = await db.query('SELECT * FROM stories WHERE id = $1', [storyId]);
    if (!story.rows[0]) return res.status(404).json({ error: 'Histoire introuvable' });
    
    var page = await db.query(
      'SELECT * FROM pages WHERE story_id = $1 AND page_number = $2',
      [storyId, pageNum]
    );
    if (!page.rows[0]) return res.status(404).json({ error: 'Page introuvable' });
    
    var isFree = pageNum <= story.rows[0].free_pages;
    
    if (!isFree) {
      var user = await db.query('SELECT credits FROM users WHERE id = $1', [req.user.id]);
      if (user.rows[0].credits < 10)
        return res.status(402).json({ error: 'Crédits insuffisants', code: 'INSUFFICIENT_CREDITS' });
      
      // Debit credits
      await db.query('UPDATE users SET credits = credits - 10 WHERE id = $1', [req.user.id]);
      
      // Record read
      await db.query(
        `INSERT INTO page_reads (user_id, story_id, page_number)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [req.user.id, storyId, pageNum]
      );
      
      // Author earnings
      await db.query(
        'UPDATE users SET earnings = earnings + 6 WHERE id = $1',
        [story.rows[0].author_id]
      );
      
      // Transaction
      await db.query(
        `INSERT INTO transactions (user_id, type, amount, label)
         VALUES ($1, 'read', -10, $2)`,
        [req.user.id, `Page ${pageNum} — ${story.rows[0].title}`]
      );
    }
    
    res.json({ page: page.rows[0], is_free: isFree });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/stories', auth(['author', 'admin']), async function(req, res) {
  try {
    var { title, synopsis, genre, cover, free_pages, content, series_id } = req.body;
    if (!title || !synopsis) return res.status(400).json({ error: 'Titre et synopsis requis' });
    
    var result = await db.query(
      `INSERT INTO stories (author_id, title, synopsis, genre, cover, free_pages, status, series_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7) RETURNING id`,
      [req.user.id, title, synopsis, genre, cover || '📖', free_pages || 3, series_id || null]
    );
    var storyId = result.rows[0].id;
    
    // Create pages
    if (content) {
      var words = content.split(/\s+/);
      var pageNum = 1;
      for (var i = 0; i < words.length; i += 500) {
        var text = words.slice(i, i + 500).join(' ');
        await db.query(
          'INSERT INTO pages (story_id, page_number, content) VALUES ($1, $2, $3)',
          [storyId, pageNum++, text]
        );
      }
    }
    
    res.status(201).json({ id: storyId, message: 'Histoire publiée' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ======================================================
// CREDITS & PAYMENTS
// ======================================================

app.get('/credits', auth(), async function(req, res) {
  try {
    var result = await db.query('SELECT credits FROM users WHERE id = $1', [req.user.id]);
    res.json({ credits: result.rows[0].credits });
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /payments/initiate - Duniyapay
app.post('/payments/initiate', auth(), async function(req, res) {
  try {
    var { pack_id, method } = req.body;
    var packs = { p1:100, p2:500, p3:1000, p4:3000, p5:5000 };
    var credits = { p1:10, p2:50, p3:100, p4:300, p5:600 };
    
    if (!packs[pack_id]) return res.status(400).json({ error: 'Pack invalide' });
    
    var txResult = await db.query(
      `INSERT INTO transactions (user_id, type, amount, label, status, provider)
       VALUES ($1, 'purchase', $2, $3, 'pending', $4) RETURNING id`,
      [req.user.id, packs[pack_id], `Pack ${pack_id}`, method]
    );
    
    // TODO: Appel API Duniyapay réel
    // const duniyapay = await fetch('https://api.duniyapay.com/v1/payment', {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${process.env.DUNIYAPAY_API_KEY}` },
    //   body: JSON.stringify({ amount: packs[pack_id], currency: 'XOF', ref: txResult.rows[0].id })
    // });
    
    res.json({
      transaction_id: txResult.rows[0].id,
      amount: packs[pack_id],
      credits: credits[pack_id],
      status: 'pending',
      message: 'Paiement initié. En attente de confirmation.'
    });
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /payments/webhook - Duniyapay webhook
app.post('/payments/webhook', async function(req, res) {
  try {
    var { transaction_id, status, amount } = req.body;
    // TODO: Vérifier signature Duniyapay
    
    if (status === 'success') {
      var tx = await db.query(
        'UPDATE transactions SET status = $1 WHERE id = $2 RETURNING *',
        ['completed', transaction_id]
      );
      if (tx.rows[0]) {
        var creditsMap = { 100:10, 500:50, 1000:100, 3000:300, 5000:600 };
        var credits = creditsMap[tx.rows[0].amount] || 0;
        await db.query(
          'UPDATE users SET credits = credits + $1 WHERE id = $2',
          [credits, tx.rows[0].user_id]
        );
      }
    }
    res.json({ received: true });
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ======================================================
// REVIEWS
// ======================================================

app.get('/stories/:id/reviews', async function(req, res) {
  try {
    var result = await db.query(
      `SELECT r.*, u.name as user_name FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.story_id = $1 ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/stories/:id/reviews', auth(['reader']), async function(req, res) {
  try {
    var { stars, text } = req.body;
    if (!stars || !text) return res.status(400).json({ error: 'Note et commentaire requis' });
    await db.query(
      `INSERT INTO reviews (user_id, story_id, stars, text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, story_id) DO UPDATE SET stars=$3, text=$4`,
      [req.user.id, req.params.id, stars, text]
    );
    res.json({ message: 'Avis publié' });
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ======================================================
// WITHDRAWALS
// ======================================================

app.post('/withdrawals', auth(['author']), async function(req, res) {
  try {
    var { amount, method, phone } = req.body;
    if (amount < 5000) return res.status(400).json({ error: 'Minimum 5000 FCFA' });
    
    var user = await db.query(
      'SELECT earnings, withdrawn FROM users WHERE id = $1', [req.user.id]
    );
    var available = (user.rows[0].earnings || 0) - (user.rows[0].withdrawn || 0);
    if (amount > available)
      return res.status(400).json({ error: `Maximum disponible: ${available} FCFA` });
    
    await db.query(
      `INSERT INTO withdrawals (author_id, amount, method, phone, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [req.user.id, amount, method, phone]
    );
    await db.query(
      'UPDATE users SET withdrawn = withdrawn + $1 WHERE id = $2',
      [amount, req.user.id]
    );
    res.json({ message: 'Retrait demandé. Traitement sous 24h.' });
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ======================================================
// ADMIN
// ======================================================

app.get('/admin/stats', auth(['admin']), async function(req, res) {
  try {
    var [users, stories, revenue, reads] = await Promise.all([
      db.query("SELECT COUNT(*) FROM users WHERE status='active'"),
      db.query("SELECT COUNT(*) FROM stories WHERE status='published'"),
      db.query("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='purchase' AND status='completed'"),
      db.query("SELECT COUNT(*) FROM page_reads"),
    ]);
    res.json({
      users: parseInt(users.rows[0].count),
      stories: parseInt(stories.rows[0].count),
      revenue: parseFloat(revenue.rows[0].total),
      reads: parseInt(reads.rows[0].count)
    });
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/admin/users', auth(['admin']), async function(req, res) {
  try {
    var result = await db.query(
      'SELECT id, name, email, role, status, credits, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/admin/users/:id/activate', auth(['admin']), async function(req, res) {
  try {
    await db.query("UPDATE users SET status='active' WHERE id=$1", [req.params.id]);
    res.json({ message: 'Compte activé' });
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/admin/stories/:id/feature', auth(['admin']), async function(req, res) {
  try {
    await db.query(
      'UPDATE stories SET featured = NOT featured WHERE id = $1', [req.params.id]
    );
    res.json({ message: 'Mis à jour' });
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/admin/withdrawals/:id/approve', auth(['admin']), async function(req, res) {
  try {
    await db.query(
      "UPDATE withdrawals SET status='approved' WHERE id=$1", [req.params.id]
    );
    res.json({ message: 'Retrait approuvé' });
  } catch(e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ======================================================
// START SERVER
// ======================================================
db.connect().then(function() {
  console.log('✅ Base de données connectée');
  app.listen(PORT, function() {
    console.log(`🚀 GRIOTTE API sur le port ${PORT}`);
  });
}).catch(function(err) {
  console.error('❌ Erreur base de données:', err);
  process.exit(1);
});
