const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'robotica_secret_key';

const dataDir = process.env.NODE_ENV === 'production' ? '/tmp/robotica-data' : path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'public/uploads');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const dbFile = path.join(dataDir, 'database.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Erro ao abrir o banco de dados:', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite.');
    initDb();
  }
});

function initDb() {
  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      age_range TEXT,
      duration TEXT,
      materials TEXT NOT NULL,
      steps TEXT NOT NULL,
      safety TEXT,
      image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false }));

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

app.get('/', (req, res) => {
  db.all('SELECT * FROM activities ORDER BY id DESC', [], (err, activities) => {
    res.render('index', { activities, categories: [], search: '', category: '', isAdmin: req.session?.isAdmin });
  });
});

app.get('/activity/:id', (req, res) => {
  db.get('SELECT * FROM activities WHERE id = ?', [req.params.id], (err, activity) => {
    if (!activity) return res.status(404).render('error', { message: 'Não encontrado' });
    res.render('activity', { activity, isAdmin: req.session?.isAdmin });
  });
});

app.get('/admin/login', (req, res) => res.render('admin-login', { error: null }));
app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.render('admin-login', { error: 'Senha incorreta!' });
  }
});
app.get('/admin/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/admin', requireAuth, (req, res) => {
  db.all('SELECT * FROM activities ORDER BY id DESC', [], (err, activities) => {
    res.render('admin-list', { activities });
  });
});

app.get('/admin/new', requireAuth, (req, res) => res.render('admin-form', { activity: null }));

app.post('/admin/new', requireAuth, upload.any(), (req, res) => {
  const { title, description, category, age_range, duration, materials, safety } = req.body;
  
  const coverFile = req.files ? req.files.find(f => f.fieldname === 'image') : null;
  const image = coverFile ? `/uploads/${coverFile.filename}` : '';

  let stepTexts = req.body.step_text || [];
  if (!Array.isArray(stepTexts)) stepTexts = [stepTexts];

  const stepsData = stepTexts.map((text, idx) => {
    const stepFile = req.files ? req.files.find(f => f.fieldname === `step_image_${idx}`) : null;
    return {
      text: text,
      image: stepFile ? `/uploads/${stepFile.filename}` : ''
    };
  }).filter(s => s.text.trim().length > 0 || s.image !== '');

  const stepsJson = JSON.stringify(stepsData);

  db.run(`INSERT INTO activities (title, description, category, age_range, duration, materials, steps, safety, image) VALUES (?,?,?,?,?,?,?,?,?)`,
    [title, description, category, age_range, duration, materials, stepsJson, safety, image], () => res.redirect('/admin'));
});

app.get('/admin/edit/:id', requireAuth, (req, res) => {
  db.get('SELECT * FROM activities WHERE id = ?', [req.params.id], (err, activity) => {
    res.render('admin-form', { activity });
  });
});

app.post('/admin/edit/:id', requireAuth, upload.any(), (req, res) => {
  const { title, description, category, age_range, duration, materials, safety, current_image } = req.body;
  
  const coverFile = req.files ? req.files.find(f => f.fieldname === 'image') : null;
  const image = coverFile ? `/uploads/${coverFile.filename}` : current_image;

  let stepTexts = req.body.step_text || [];
  if (!Array.isArray(stepTexts)) stepTexts = [stepTexts];

  let stepExistingImages = req.body.step_existing_image || [];
  if (!Array.isArray(stepExistingImages)) stepExistingImages = [stepExistingImages];

  const stepsData = stepTexts.map((text, idx) => {
    const stepFile = req.files ? req.files.find(f => f.fieldname === `step_image_${idx}`) : null;
    const imgPath = stepFile ? `/uploads/${stepFile.filename}` : (stepExistingImages[idx] || '');
    return {
      text: text,
      image: imgPath
    };
  }).filter(s => s.text.trim().length > 0 || s.image !== '');

  const stepsJson = JSON.stringify(stepsData);

  db.run(`UPDATE activities SET title=?, description=?, category=?, age_range=?, duration=?, materials=?, steps=?, safety=?, image=? WHERE id=?`,
    [title, description, category, age_range, duration, materials, stepsJson, safety, image, req.params.id], () => res.redirect('/admin'));
});

app.post('/admin/delete/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM activities WHERE id = ?', [req.params.id], () => res.redirect('/admin'));
});

// O '0.0.0.0' garante que o Hostless consegue acessar o servidor sem derrubá-lo
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Portal de robótica rodando na porta ${PORT}`);
});