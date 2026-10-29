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

const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const dbFile = path.join(dataDir, 'database.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) console.error('Erro ao abrir banco:', err.message);
  else initDb();
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
      steps TEXT NOT NULL, -- Salvaremos como JSON String
      safety TEXT,
      image TEXT, -- Imagem de capa
      makecode_link TEXT, -- Link microbit
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
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } }); // Limite de 10MB para múltiplos arquivos

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
  const search = req.query.search || '';
  db.all('SELECT * FROM activities ORDER BY id DESC', [], (err, activities) => {
    res.render('index', { activities: activities || [], search, categories: [], category: '', isAdmin: req.session?.isAdmin });
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
    res.render('admin-list', { activities: activities || [] });
  });
});

app.get('/admin/new', requireAuth, (req, res) => res.render('admin-form', { activity: null }));

// Processar criação de atividade (Aceitando múltiplos arquivos)
app.post('/admin/new', requireAuth, upload.any(), (req, res) => {
  const { title, description, category, age_range, duration, materials, safety, makecode_link } = req.body;
  
  const coverFile = req.files.find(f => f.fieldname === 'image');
  const image = coverFile ? `/uploads/${coverFile.filename}` : '';

  // Processar passos dinâmicos com suas respectivas imagens
  const stepTexts = Array.isArray(req.body.step_texts) ? req.body.step_texts : [req.body.step_texts].filter(Boolean);
  const stepsData = stepTexts.map((text, index) => {
    const stepFile = req.files.find(f => f.fieldname === `step_image_${index}`);
    return {
      text: text,
      image: stepFile ? `/uploads/${stepFile.filename}` : ''
    };
  });

  const stepsJson = JSON.stringify(stepsData);

  db.run(`INSERT INTO activities (title, description, category, age_range, duration, materials, steps, safety, image, makecode_link) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [title, description, category, age_range, duration, materials, stepsJson, safety, image, makecode_link], () => res.redirect('/admin'));
});

app.get('/admin/edit/:id', requireAuth, (req, res) => {
  db.get('SELECT * FROM activities WHERE id = ?', [req.params.id], (err, activity) => {
    res.render('admin-form', { activity });
  });
});

app.post('/admin/edit/:id', requireAuth, upload.any(), (req, res) => {
  const { title, description, category, age_range, duration, materials, safety, makecode_link, current_image } = req.body;
  
  const coverFile = req.files.find(f => f.fieldname === 'image');
  const image = coverFile ? `/uploads/${coverFile.filename}` : current_image;

  const stepTexts = Array.isArray(req.body.step_texts) ? req.body.step_texts : [req.body.step_texts].filter(Boolean);
  const currentStepImages = Array.isArray(req.body.current_step_images) ? req.body.current_step_images : [req.body.current_step_images].filter(Boolean);

  const stepsData = stepTexts.map((text, index) => {
    const stepFile = req.files.find(f => f.fieldname === `step_image_${index}`);
    return {
      text: text,
      image: stepFile ? `/uploads/${stepFile.filename}` : (currentStepImages[index] || '')
    };
  });

  const stepsJson = JSON.stringify(stepsData);

  db.run(`UPDATE activities SET title=?, description=?, category=?, age_range=?, duration=?, materials=?, steps=?, safety=?, image=?, makecode_link=? WHERE id=?`,
    [title, description, category, age_range, duration, materials, stepsJson, safety, image, makecode_link, req.params.id], () => res.redirect('/admin'));
});

app.post('/admin/delete/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM activities WHERE id = ?', [req.params.id], () => res.redirect('/admin'));
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
