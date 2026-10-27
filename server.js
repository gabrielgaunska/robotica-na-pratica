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

// Reinicia o banco de dados para a estrutura de múltiplos passos com imagens
const dbFile = path.join(dataDir, 'database.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Erro ao abrir o banco de dados:', err.message);
  } else {
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
      steps TEXT NOT NULL, -- Guardará os passos formatados em JSON
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

// Usamos upload.any() para aceitar tanto a capa quanto as fotos de cada passo
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

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
    if (!activity) return res.status(404).render('error', { message: 'Atividade não encontrada' });
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
  const { title, description, category, age_range, duration, materials, safety, step_texts } = req.body;
  
  // Imagem de Capa
  const coverFile = req.files.find(f => f.fieldname === 'image');
  const image = coverFile ? `/uploads/${coverFile.filename}` : '';

  // Processar os Passos com suas Imagens
  const stepsList = [];
  const texts = Array.isArray(step_texts) ? step_texts : [step_texts];

  texts.forEach((text, index) => {
    if (text && text.trim() !== '') {
      const stepFile = req.files.find(f => f.fieldname === `step_image_${index}`);
      const stepImg = stepFile ? `/uploads/${stepFile.filename}` : '';
      stepsList.push({ text: text.trim(), image: stepImg });
    }
  });

  const stepsJSON = JSON.stringify(stepsList);

  db.run(`INSERT INTO activities (title, description, category, age_range, duration, materials, steps, safety, image) VALUES (?,?,?,?,?,?,?,?,?)`,
    [title, description, category, age_range, duration, materials, stepsJSON, safety, image], (err) => {
      if (err) {
        return res.status(500).render('error', { message: 'Erro ao salvar atividade: ' + err.message });
      }
      res.redirect('/admin');
    });
});

app.get('/admin/edit/:id', requireAuth, (req, res) => {
  db.get('SELECT * FROM activities WHERE id = ?', [req.params.id], (err, activity) => {
    res.render('admin-form', { activity });
  });
});

app.post('/admin/edit/:id', requireAuth, upload.any(), (req, res) => {
  const { title, description, category, age_range, duration, materials, safety, step_texts, current_image } = req.body;
  
  const coverFile = req.files.find(f => f.fieldname === 'image');
  const image = coverFile ? `/uploads/${coverFile.filename}` : current_image;

  const stepsList = [];
  const texts = Array.isArray(step_texts) ? step_texts : [step_texts];

  texts.forEach((text, index) => {
    if (text && text.trim() !== '') {
      const stepFile = req.files.find(f => f.fieldname === `step_image_${index}`);
      const existingImg = req.body[`existing_step_image_${index}`] || '';
      const stepImg = stepFile ? `/uploads/${stepFile.filename}` : existingImg;
      stepsList.push({ text: text.trim(), image: stepImg });
    }
  });

  const stepsJSON = JSON.stringify(stepsList);

  db.run(`UPDATE activities SET title=?, description=?, category=?, age_range=?, duration=?, materials=?, steps=?, safety=?, image=? WHERE id=?`,
    [title, description, category, age_range, duration, materials, stepsJSON, safety, image, req.params.id], (err) => {
      if (err) {
        return res.status(500).render('error', { message: 'Erro ao atualizar atividade: ' + err.message });
      }
      res.redirect('/admin');
    });
});

app.post('/admin/delete/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM activities WHERE id = ?', [req.params.id], () => res.redirect('/admin'));
});

app.listen(PORT, () => console.log(`Servidor de robótica visual rodando na porta ${PORT}`));
