# Notes: a notes app

Full-stack notes app built with Node.js, Express, EJS and SQLite.

## Features (Levels 1 to 5)
1. Guests see a public home page.
2. Register and log in (passwords hashed with bcryptjs, sessions with express-session).
3. Logged-in users create notes (title + content) on a dashboard.
4. Users only see their own notes.
5. Users can edit and delete their own notes.

## Run it
```
npm install
node server.js
```
Then open http://localhost:3000. The SQLite database (`notes.db`) is created automatically.
