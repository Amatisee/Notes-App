const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'notes.db'));
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.fmtDate = (d) =>
  new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

app.locals.groupOf = (d) => {
  const days = (Date.now() - new Date(d.replace(' ', 'T') + 'Z')) / 86400000;
  return days < 1 ? 'Today' : days < 7 ? 'Previous 7 days' : days < 30 ? 'Previous 30 days' : 'Earlier';
};

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// Make the logged-in user and one-time flash message available to every view
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

const requireAuth = (req, res, next) => (req.session.user ? next() : res.redirect('/login'));
const guestOnly = (req, res, next) => (req.session.user ? res.redirect('/dashboard') : next());

function startSession(req, res, next, u) {
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { id: u.id, name: u.name };
    req.session.flash = { type: 'success', message: `Welcome, ${u.name}.` };
    res.redirect('/dashboard');
  });
}

// ---- Level 1: public home page ----
app.get('/', (req, res) => res.render('home'));

// ---- Level 2: register / login / logout ----
app.get('/register', guestOnly, (req, res) => res.render('register', { error: null, form: { name: '', email: '' } }));

app.post('/register', guestOnly, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const form = { name, email };
    const fail = (error) => res.status(400).render('register', { error, form });

    if (!name || !email || !password) return fail('Fill in your name, email, and password.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail('Enter a valid email address.');
    if (password.length < 6) return fail('Use a password with at least 6 characters.');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return fail('That email is already registered. Try logging in.');

    const hash = await bcrypt.hash(password, 10);
    const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hash);
    startSession(req, res, next, { id: info.lastInsertRowid, name });
  } catch (err) { next(err); }
});

app.get('/login', guestOnly, (req, res) => res.render('login', { error: null, email: '' }));

app.post('/login', guestOnly, async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).render('login', { error: 'Email or password is incorrect.', email });
    }
    startSession(req, res, next, u);
  } catch (err) { next(err); }
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// ---- Levels 3-5: one screen with the note list on the left and the editor on the right ----
function renderApp(req, res, opts = {}) {
  const { status = 200, selected = null, isNew = false, error = null } = opts;
  // Level 4: only this user's notes are ever loaded
  const notes = db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(req.session.user.id);
  const form = opts.form || { title: selected ? selected.title : '', content: selected ? selected.content : '' };
  res.status(status).render('notes', { notes, selected, isNew, error, form });
}

const readNote = (body) => ({ title: (body.title || '').trim(), content: (body.content || '').trim() });
function noteError({ title, content }) {
  if (!title || !content) return 'A note needs both a title and some content.';
  if (title.length > 100) return 'Keep the title under 100 characters.';
  if (content.length > 5000) return 'Keep the content under 5,000 characters.';
  return null;
}
// Level 5: every edit and delete checks the note belongs to the logged-in user
const findOwnNote = (req) =>
  db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);

app.get('/dashboard', requireAuth, (req, res) => renderApp(req, res));
app.get('/notes/new', requireAuth, (req, res) => renderApp(req, res, { isNew: true }));

app.get('/notes/:id', requireAuth, (req, res) => {
  const selected = findOwnNote(req);
  if (!selected) return res.status(404).render('404');
  renderApp(req, res, { selected });
});

app.post('/notes', requireAuth, (req, res) => {
  const form = readNote(req.body);
  const error = noteError(form);
  if (error) return renderApp(req, res, { status: 400, isNew: true, error, form });
  const info = db.prepare('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)').run(req.session.user.id, form.title, form.content);
  req.session.flash = { type: 'success', message: 'Note saved.' };
  res.redirect('/notes/' + info.lastInsertRowid);
});

app.post('/notes/:id/edit', requireAuth, (req, res) => {
  const selected = findOwnNote(req);
  if (!selected) return res.status(404).render('404');
  const form = readNote(req.body);
  const error = noteError(form);
  if (error) return renderApp(req, res, { status: 400, selected, error, form });
  db.prepare('UPDATE notes SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(form.title, form.content, selected.id, req.session.user.id);
  req.session.flash = { type: 'success', message: 'Changes saved.' };
  res.redirect('/notes/' + selected.id);
});

app.post('/notes/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(req.params.id, req.session.user.id);
  req.session.flash = { type: 'success', message: 'Note deleted.' };
  res.redirect('/dashboard');
});

app.use((req, res) => res.status(404).render('404'));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('Something went wrong on the server.'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Notes is running at http://localhost:${PORT}`));
