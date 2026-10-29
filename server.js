const express = require('express');
const session = require('express-session');
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

// BANCO DE DADOS EM JAVASCRIPT PURO (Sem compilação C++, leve e rápido)
const dbFile = path.join(dataDir, 'database.json');

class JSONDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([]));
    }
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (e) {
      return [];
    }
  }

  write(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  run(query, params, callback) {
    const data = this.read();
    
    if (query.trim().startsWith('INSERT INTO')) {
      const [title, description, category, age_range, duration, materials, stepsJson, safety, image] = params;
      const newId = data.length > 0 ? Math.max(...data.map(item => item.id)) + 1 : 1;
      const newItem = {
        id: newId,
        title,
        description,
        category,
        age_range,
        duration,
        materials,
        steps: stepsJson,
        safety,
        image,
        created_at: new Date().toISOString()
      };
      data.push(newItem);
      this.write(data);
      if (callback) callback(null);
      return;
    }

    if (query.trim().startsWith('UPDATE')) {
      const [title, description, category, age_range, duration, materials, stepsJson, safety, image, id] = params;
      const index = data.findIndex(item => item.id === parseInt(id));
      if (index !== -1) {
        data[index] = {
          ...data[index],
          title,
          description,
          category,
          age_range,
          duration,
          materials,
          steps: stepsJson,
          safety,
          image
        };
        this.write(data);
      }
      if (callback) callback(null);
      return;
    }

    if (query.trim().startsWith('DELETE')) {
      const id = parseInt(params[0]);
      const filtered = data.filter(item => item.id !== id);
      this.write(filtered);
      if (callback) callback(null);
      return;
    }

    if (callback) callback(null);
  }

  all(query, params, callback) {
    const data = this.read();
    data.sort((a, b) => b.id - a.id);
    if (callback) callback(null, data);
  }

  get(query, params, callback) {
    const data = this.read();
    const id = parseInt(params[0]);
    const item = data.find(it => it.id === id);
    if (callback) callback(null, item || null);
  }
}

const db = new JSONDatabase(dbFile);
console.log('Banco de dados JSON inicializado com sucesso.');

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Portal de robótica rodando na porta ${PORT}`);
});