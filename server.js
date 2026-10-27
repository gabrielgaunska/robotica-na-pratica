
const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET =
  process.env.SESSION_SECRET || 'robotica_secret_key';

const dataDir =
  process.env.DATA_DIR || path.join('/tmp', 'robotica-data');

const uploadDir =
  process.env.UPLOAD_DIR || path.join('/tmp', 'robotica-uploads');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const dbFile = path.join(dataDir, 'database.db');

let db;
let dbReady = false;

function initDb() {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS activities (
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
      )`,
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbFile, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';

    cb(
      null,
      `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`
    );
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 30
  }
});

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// Disponibiliza as imagens enviadas pelo administrador.
app.use('/uploads', express.static(uploadDir));

app.use(
  session({
    name: 'robotica.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

// Evita acessar o banco antes de ele estar pronto.
app.use((req, res, next) => {
  if (dbReady) return next();

  res.status(503).send(
    'O portal está iniciando. Aguarde alguns segundos e tente novamente.'
  );
});

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }

  res.redirect('/admin/login');
}

function getActivities(res, callback) {
  db.all(
    'SELECT * FROM activities ORDER BY id DESC',
    [],
    (err, activities) => {
      if (err) {
        console.error('Erro ao consultar atividades:', err.message);
        return res.status(500).send('Erro ao carregar as atividades.');
      }

      callback(activities);
    }
  );
}

function parseSteps(body, files) {
  const values = body.step_texts;
  const texts = Array.isArray(values) ? values : [values];
  const steps = [];

  texts.forEach((text, index) => {
    if (typeof text !== 'string' || !text.trim()) return;

    const stepFile = files.find(
      (file) => file.fieldname === `step_image_${index}`
    );

    const existingImage =
      body[`existing_step_image_${index}`] || '';

    steps.push({
      text: text.trim(),
      image: stepFile
        ? `/uploads/${stepFile.filename}`
        : existingImage
    });
  });

  return JSON.stringify(steps);
}

function handleDatabaseError(res, err, message) {
  if (!err) return false;

  console.error(message, err.message);
  res.status(500).send(`${message} Verifique os logs do servidor.`);
  return true;
}

app.get('/', (req, res) => {
  getActivities(res, (activities) => {
    res.render('index', {
      activities,
      categories: [],
      search: '',
      category: '',
      isAdmin: Boolean(req.session?.isAdmin)
    });
  });
});

app.get('/activity/:id', (req, res) => {
  db.get(
    'SELECT * FROM activities WHERE id = ?',
    [req.params.id],
    (err, activity) => {
      if (handleDatabaseError(res, err, 'Erro ao buscar atividade:')) {
        return;
      }

      if (!activity) {
        return res.status(404).render('error', {
          message: 'Atividade não encontrada'
        });
      }

      res.render('activity', {
        activity,
        isAdmin: Boolean(req.session?.isAdmin)
      });
    }
  );
});

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return req.session.save((err) => {
      if (err) {
        console.error('Erro ao salvar sessão:', err.message);
        return res.status(500).send('Erro ao iniciar sessão.');
      }

      res.redirect('/admin');
    });
  }

  res.status(401).render('admin-login', {
    error: 'Senha incorreta!'
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Erro ao encerrar sessão:', err.message);
      return res.status(500).send('Erro ao encerrar sessão.');
    }

    res.clearCookie('robotica.sid');
    res.redirect('/');
  });
});

app.get('/admin', requireAuth, (req, res) => {
  getActivities(res, (activities) => {
    res.render('admin-list', { activities });
  });
});

app.get('/admin/new', requireAuth, (req, res) => {
  res.render('admin-form', { activity: null });
});

app.post(
  '/admin/new',
  requireAuth,
  upload.any(),
  (req, res) => {
    const {
      title,
      description,
      category,
      age_range,
      duration,
      materials,
      safety
    } = req.body;

    const files = req.files || [];
    const coverFile = files.find(
      (file) => file.fieldname === 'image'
    );

    const image = coverFile
      ? `/uploads/${coverFile.filename}`
      : '';

    const steps = parseSteps(req.body, files);

    db.run(
      `INSERT INTO activities
      (title, description, category, age_range, duration,
       materials, steps, safety, image)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description,
        category,
        age_range || '',
        duration || '',
        materials,
        steps,
        safety || '',
        image
      ],
      function (err) {
        if (handleDatabaseError(res, err, 'Erro ao salvar atividade:')) {
          return;
        }

        res.redirect('/admin');
      }
    );
  }
);

app.get('/admin/edit/:id', requireAuth, (req, res) => {
  db.get(
    'SELECT * FROM activities WHERE id = ?',
    [req.params.id],
    (err, activity) => {
      if (handleDatabaseError(res, err, 'Erro ao buscar atividade:')) {
        return;
      }

      if (!activity) {
        return res.status(404).send('Atividade não encontrada.');
      }

      res.render('admin-form', { activity });
    }
  );
});

app.post(
  '/admin/edit/:id',
  requireAuth,
  upload.any(),
  (req, res) => {
    const {
      title,
      description,
      category,
      age_range,
      duration,
      materials,
      safety,
      current_image
    } = req.body;

    const files = req.files || [];
    const coverFile = files.find(
      (file) => file.fieldname === 'image'
    );

    const image = coverFile
      ? `/uploads/${coverFile.filename}`
      : current_image || '';

    const steps = parseSteps(req.body, files);

    db.run(
      `UPDATE activities
       SET title = ?, description = ?, category = ?,
           age_range = ?, duration = ?, materials = ?,
           steps = ?, safety = ?, image = ?
       WHERE id = ?`,
      [
        title,
        description,
        category,
        age_range || '',
        duration || '',
        materials,
        steps,
        safety || '',
        image,
        req.params.id
      ],
      function (err) {
        if (handleDatabaseError(res, err, 'Erro ao atualizar atividade:')) {
          return;
        }

        res.redirect('/admin');
      }
    );
  }
);

app.post('/admin/delete/:id', requireAuth, (req, res) => {
  db.run(
    'DELETE FROM activities WHERE id = ?',
    [req.params.id],
    (err) => {
      if (handleDatabaseError(res, err, 'Erro ao excluir atividade:')) {
        return;
      }

      res.redirect('/admin');
    }
  );
});

app.get('/health', (req, res) => {
  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? 'ok' : 'starting'
  });
});

async function startServer() {
  try {
    console.log('Preparando banco de dados...');
    console.log('Diretório do banco:', dataDir);
    console.log('Diretório de uploads:', uploadDir);
    console.log('Porta configurada:', PORT);

    await openDatabase();
    await initDb();

    dbReady = true;

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Portal de robótica rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error('Falha ao iniciar o aplicativo:', err.message);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  if (db) {
    db.close((err) => {
      if (err) console.error('Erro ao fechar banco:', err.message);
      process.exit(err ? 1 : 0);
    });
  } else {
    process.exit(0);
  }
});

startServer();
