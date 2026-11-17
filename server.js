// Configures Express, PostgreSQL, authentication, and media upload routes
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const dotenv = require('dotenv');
const multer = require('multer');
const { Pool } = require('pg');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const projectRoot = __dirname;
const uploadDirectory = path.join(projectRoot, 'public', 'uploads');
const privatePhotoDirectory = path.join(projectRoot, 'storage', 'private-photos');
const sessionCookieName = 'wellness-session';
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/digital_health_app',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Configure file upload handling for community posts and media files
const postUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 5, fields: 2, fieldSize: 15000 },
  fileFilter: (req, file, callback) => {
    const supportedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/webm',
    ];
    if (!supportedTypes.includes(file.mimetype)) {
      callback(new Error('Photos must be JPEG, PNG, GIF, or WebP. Videos must be MP4 or WebM.'));
      return;
    }
    callback(null, true);
  },
});

function getImageFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) {
    return { extension: 'gif', contentType: 'image/gif' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  return null;
}

function getPostMediaFormat(file) {
  const imageFormat = getImageFormat(file.buffer);
  if (imageFormat) {
    const contentType = imageFormat.contentType;
    return file.mimetype === contentType
      ? { ...imageFormat, contentType, kind: 'image' }
      : null;
  }

  if (file.mimetype === 'video/mp4' && file.buffer.length >= 12 &&
      file.buffer.toString('ascii', 4, 8) === 'ftyp') {
    return { extension: 'mp4', contentType: 'video/mp4', kind: 'video' };
  }
  if (file.mimetype === 'video/webm' &&
      file.buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { extension: 'webm', contentType: 'video/webm', kind: 'video' };
  }
  return null;
}

async function migrateExistingPostPhotos() {
  const result = await pool.query('SELECT id, user_id, image_urls FROM posts WHERE cardinality(image_urls) > 0');
  const legacyPhotoPattern = /^\/(?:uploads|api\/post-photos)\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:jpg|png|gif|webp))$/i;

  for (const post of result.rows) {
    const imageUrls = [...post.image_urls];
    const movedFiles = [];
    let updated = false;
    const userPostDirectory = path.join(privatePhotoDirectory, String(post.user_id), 'posts');

    try {
      for (let index = 0; index < imageUrls.length; index += 1) {
        const match = legacyPhotoPattern.exec(imageUrls[index]);
        if (!match) continue;

        const filename = match[1];
        const sourcePath = imageUrls[index].startsWith('/uploads/')
          ? path.join(uploadDirectory, filename)
          : null;
        const destinationPath = path.join(userPostDirectory, filename);
        try {
          await fs.access(destinationPath);
          imageUrls[index] = `/api/post-media/${filename}`;
          updated = true;
          continue;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }

        if (!sourcePath) continue;
        try {
          await fs.access(sourcePath);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }

        await fs.mkdir(userPostDirectory, { recursive: true });
        await fs.rename(sourcePath, destinationPath);
        movedFiles.push({ sourcePath, destinationPath });
        imageUrls[index] = `/api/post-media/${filename}`;
        updated = true;
      }

      if (updated) {
        await pool.query('UPDATE posts SET image_urls = $1 WHERE id = $2', [imageUrls, post.id]);
      }
    } catch (error) {
      await Promise.all(movedFiles.map(({ sourcePath, destinationPath }) => fs.rename(destinationPath, sourcePath)
        .catch((rollbackError) => {
          console.error(`Unable to restore legacy community photo ${sourcePath}:`, rollbackError.message);
        })));
      throw error;
    }
  }
}

app.use('/uploads', (req, res) => res.status(404).json({ message: 'Photo not found.' }));
app.use(express.json());
app.use(express.static(path.join(projectRoot, 'public')));

// Set up database tables and seed workout plans 
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        weight_kg DECIMAL(5,2),
        height_cm DECIMAL(5,2),
        goal_type VARCHAR(100),
        fitness_level VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(150) NOT NULL,
        contents TEXT NOT NULL,
        image_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        video_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS goals (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(150) NOT NULL,
        description TEXT,
        goal_type VARCHAR(100),
        equipment VARCHAR(100),
        fitness_level VARCHAR(50),
        target_weight DECIMAL(5,2),
        daily_steps INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS meals (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        meal_name VARCHAR(150) NOT NULL,
        meal_type VARCHAR(50) NOT NULL,
        calories INT NOT NULL,
        protein_g INT,
        carbs_g INT,
        fats_g INT,
        consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workout_plans (
        id SERIAL PRIMARY KEY,
        goal_type VARCHAR(100) NOT NULL,
        fitness_level VARCHAR(50) NOT NULL,
        workout_type VARCHAR(100) NOT NULL,
        duration_minutes INT NOT NULL,
        weekly_days VARCHAR(255),
        rest_days VARCHAR(255),
        notes TEXT
      );
    `);

    const planCheck = await pool.query('SELECT COUNT(*) AS total FROM workout_plans;');
    if (Number(planCheck.rows[0].total) === 0) {
      await pool.query(`
        INSERT INTO workout_plans (goal_type, fitness_level, workout_type, duration_minutes, weekly_days, rest_days, notes)
        VALUES
          ('weight loss', 'beginner', 'cardio', 30, 'Mon, Wed, Fri', 'Tue, Thu, Sat', 'Focus on brisk walks, cycling, and low-impact training.'),
          ('bigger arms', 'intermediate', 'strength', 45, 'Mon, Tue, Thu, Sat', 'Wed, Fri, Sun', 'Prioritize arms, shoulders, and compound lifts.'),
          ('lose belly fat', 'beginner', 'yoga', 25, 'Mon, Wed, Fri, Sun', 'Tue, Thu, Sat', 'Combine mobility with moderate cardio bursts.'),
          ('muscle gain', 'advanced', 'strength', 60, 'Mon, Tue, Thu, Fri', 'Wed, Sat, Sun', 'Focus on progressive overload and recovery.');
      `);
    }

    await migrateExistingPostPhotos();
    console.log('Database initialized successfully.');
  } catch (error) {
    console.warn('Database initialization skipped. Ensure PostgreSQL is running and DATABASE_URL is configured.');
    console.warn(error.message);
  }
}

// Start the server and initialize the database
const hashSessionToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const getSessionToken = (req) => {
  const cookiePrefix = `${sessionCookieName}=`;
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookiePrefix));
  return cookie ? cookie.slice(cookiePrefix.length) : null;
};

const setSessionCookie = (res, token, maxAgeSeconds) => {
  const secureAttribute = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secureAttribute}`
  );
};

// New user sessions creation with secure token generated
const createUserSession = async (userId, res) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await pool.query(
    'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashSessionToken(token), userId, expiresAt]
  );
  setSessionCookie(res, token, Math.floor(sessionLifetimeMs / 1000));
};

const requireAuthenticatedUser = async (req, res, next) => {
  const token = getSessionToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Please log in to continue.' });
  }

  try {
    const result = await pool.query(
      `SELECT users.id, users.name
       FROM user_sessions
       JOIN users ON users.id = user_sessions.user_id
       WHERE user_sessions.token_hash = $1 AND user_sessions.expires_at > NOW()`,
      [hashSessionToken(token)]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
    }

    req.authenticatedUser = result.rows[0];
    next();
  } catch (error) {
    console.error('Unable to verify user session:', error.message);
    res.status(500).json({ message: 'Unable to verify your session.' });
  }
};

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS current_time');
    res.json({ status: 'ok', database: 'connected', time: result.rows[0].current_time });
  } catch (error) {
    res.json({ status: 'ok', database: 'offline', message: 'PostgreSQL is not connected yet.' });
  }
});

// Main app and login pages
app.get('/', (req, res) => {
  res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(projectRoot, 'public', 'login.html'));
});

// Community feed routes: fetch posts, manage media, and share updates.
app.get('/api/posts', requireAuthenticatedUser, async (req, res) => {
  const feed = typeof req.query.feed === 'string' ? req.query.feed : 'recent';
  if (!['recent', 'mine', 'recommended', 'friends'].includes(feed)) {
    return res.status(400).json({ message: 'Choose a valid post feed.' });
  }
  if (feed === 'friends') {
    return res.status(501).json({ message: 'Friends’ posts are not available until friend connections are added.' });
  }

  try {
    const postFields = `
      SELECT posts.id, posts.user_id, posts.title, posts.contents, posts.image_urls, posts.video_urls, posts.created_at,
             users.name AS author
      FROM posts
      JOIN users ON users.id = posts.user_id
    `;
    let result;

    if (feed === 'mine') {
      result = await pool.query(
        `${postFields}
         WHERE posts.user_id = $1
         ORDER BY posts.created_at DESC, posts.id DESC
         LIMIT 100;`,
        [req.authenticatedUser.id]
      );
    } else if (feed === 'recommended') {
      result = await pool.query(`
        WITH recent_goals AS (
          SELECT DISTINCT ON (user_id) user_id, goal_type, fitness_level
          FROM goals
          WHERE goal_type IS NOT NULL OR fitness_level IS NOT NULL
          ORDER BY user_id, created_at DESC, id DESC
        ),
        user_preferences AS (
          SELECT
            users.id,
            COALESCE(NULLIF(BTRIM(users.goal_type), ''), NULLIF(BTRIM(recent_goals.goal_type), '')) AS goal_type,
            COALESCE(NULLIF(BTRIM(users.fitness_level), ''), NULLIF(BTRIM(recent_goals.fitness_level), '')) AS fitness_level
          FROM users
          LEFT JOIN recent_goals ON recent_goals.user_id = users.id
        )
        SELECT
          posts.id,
          posts.user_id,
          posts.title,
          posts.contents,
          posts.image_urls,
          posts.video_urls,
          posts.created_at,
          users.name AS author,
          (
            CASE
              WHEN viewer.goal_type IS NOT NULL
                AND LOWER(BTRIM(author_preferences.goal_type)) = LOWER(BTRIM(viewer.goal_type))
              THEN 1 ELSE 0
            END +
            CASE
              WHEN viewer.fitness_level IS NOT NULL
                AND LOWER(BTRIM(author_preferences.fitness_level)) = LOWER(BTRIM(viewer.fitness_level))
              THEN 1 ELSE 0
            END
          ) AS recommendation_score
        FROM posts
        JOIN users ON users.id = posts.user_id
        JOIN user_preferences AS author_preferences ON author_preferences.id = posts.user_id
        CROSS JOIN user_preferences AS viewer
        WHERE posts.user_id <> $1
          AND viewer.id = $1
          AND (
            (viewer.goal_type IS NOT NULL
             AND LOWER(BTRIM(author_preferences.goal_type)) = LOWER(BTRIM(viewer.goal_type)))
            OR
            (viewer.fitness_level IS NOT NULL
             AND LOWER(BTRIM(author_preferences.fitness_level)) = LOWER(BTRIM(viewer.fitness_level)))
          )
        ORDER BY recommendation_score DESC, posts.created_at DESC, posts.id DESC
        LIMIT 100;
      `, [req.authenticatedUser.id]);
    } else {
      result = await pool.query(
        `${postFields}
         ORDER BY posts.created_at DESC, posts.id DESC
         LIMIT 100;`
      );
    }

    res.set('Cache-Control', 'private, no-store');
    res.json(result.rows.map((post) => ({
      ...post,
      image_urls: post.image_urls.filter((mediaUrl) => mediaUrl.startsWith('/api/post-media/')),
      video_urls: post.video_urls.filter((mediaUrl) => mediaUrl.startsWith('/api/post-media/')),
    })));
  } catch (error) {
    console.error('Unable to load posts:', error.message);
    res.status(500).json({ message: 'Unable to load posts.' });
  }
});

// User authentication and account creation routes
app.post('/api/logout', async (req, res) => {
  const token = getSessionToken(req);
  try {
    if (token) {
      await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    }
    setSessionCookie(res, '', 0);
    res.json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Unable to end user session:', error.message);
    res.status(500).json({ message: 'Unable to log out. Please try again.' });
  }
});

app.get('/api/post-media/:filename', requireAuthenticatedUser, async (req, res, next) => {
  const { filename } = req.params;
  const filenamePattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|gif|webp|mp4|webm)$/i;
  const match = filenamePattern.exec(filename);
  if (!match) {
    return res.status(404).json({ message: 'Media not found.' });
  }

  const mediaUrl = `/api/post-media/${filename}`;
  try {
    const result = await pool.query(
      `SELECT user_id
       FROM posts
       WHERE image_urls @> ARRAY[$1]::TEXT[] OR video_urls @> ARRAY[$1]::TEXT[]
       LIMIT 1`,
      [mediaUrl]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Media not found.' });
    }

    const filePath = path.join(
      privatePhotoDirectory,
      String(result.rows[0].user_id),
      'posts',
      filename
    );
    const contentType = {
      jpg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
    }[match[1].toLowerCase()];
    res.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.type(contentType).sendFile(filePath, (error) => {
      if (!error) return;
      if (error.code === 'ENOENT') {
        if (!res.headersSent) res.status(404).json({ message: 'The media file is unavailable.' });
        return;
      }
      if (res.headersSent) {
        next(error);
        return;
      }
      console.error('Unable to read private community media:', error.message);
      res.status(500).json({ message: 'Unable to load the media.' });
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ message: 'The media file is unavailable.' });
    }
    console.error('Unable to locate private community media:', error.message);
    res.status(500).json({ message: 'Unable to load the media.' });
  }
});

app.post('/api/posts', requireAuthenticatedUser, (req, res, next) => {
  postUpload.array('media', 5)(req, res, (error) => {
    if (error) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Each video must be 25 MB or smaller; photos must be 5 MB or smaller.'
        : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'You can attach up to 4 photos and 1 video.'
          : error.message;
      return res.status(400).json({ message });
    }
    next();
  });
}, async (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const contents = typeof req.body.contents === 'string' ? req.body.contents.trim() : '';
  const userId = req.authenticatedUser.id;

  if (!title || title.length > 150 || !contents || contents.length > 10000) {
    return res.status(400).json({ message: 'A valid title and post (up to 10,000 characters) are required.' });
  }

  const media = (req.files || []).map((file) => ({
    file,
    format: getPostMediaFormat(file),
  }));
  if (media.some((item) => !item.format)) {
    return res.status(400).json({ message: 'One or more files are not valid supported photos or videos.' });
  }
  if (media.filter((item) => item.format.kind === 'image' && item.file.size > 5 * 1024 * 1024).length > 0) {
    return res.status(400).json({ message: 'Each photo must be 5 MB or smaller.' });
  }
  if (media.filter((item) => item.format.kind === 'image').length > 4 ||
      media.filter((item) => item.format.kind === 'video').length > 1) {
    return res.status(400).json({ message: 'You can attach up to 4 photos and 1 video.' });
  }

  let client;
  let transactionStarted = false;
  const savedPaths = [];
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    const postResult = await client.query(
      `INSERT INTO posts (user_id, title, contents)
       VALUES ($1, $2, $3)
       RETURNING id;`,
      [userId, title, contents]
    );

    const imageUrls = [];
    const videoUrls = [];
    const userPostDirectory = path.join(privatePhotoDirectory, String(userId), 'posts');
    if (media.length > 0) {
      await fs.mkdir(userPostDirectory, { recursive: true });
    }
    for (const item of media) {
      const filename = `${crypto.randomUUID()}.${item.format.extension}`;
      const filePath = path.join(userPostDirectory, filename);
      await fs.writeFile(filePath, item.file.buffer, { flag: 'wx' });
      savedPaths.push(filePath);
      const mediaUrl = `/api/post-media/${filename}`;
      (item.format.kind === 'image' ? imageUrls : videoUrls).push(mediaUrl);
    }

    const result = await client.query(
      `UPDATE posts
       SET image_urls = $1, video_urls = $2
       WHERE id = $3
       RETURNING id, user_id, title, contents, image_urls, video_urls, created_at;`,
      [imageUrls, videoUrls, postResult.rows[0].id]
    );
    await client.query('COMMIT');
    transactionStarted = false;

    res.status(201).json({
      message: 'Post created successfully.',
      post: { ...result.rows[0], user_id: userId, author: req.authenticatedUser.name },
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Unable to roll back post creation:', rollbackError.message);
      }
    }
    await Promise.all(savedPaths.map((filePath) => fs.unlink(filePath).catch((cleanupError) => {
      console.error(`Unable to remove uploaded file ${filePath}:`, cleanupError.message);
    })));
    console.error('Unable to create post:', error.message);
    res.status(500).json({ message: 'Unable to create post. Please try again.' });
  } finally {
    client?.release();
  }
});

// Fetch posts, manage media, and share updates in the community feed
app.put('/api/posts/:postId', requireAuthenticatedUser, async (req, res) => {
  const postId = Number(req.params.postId);
  const userId = req.authenticatedUser.id;
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const contents = typeof req.body.contents === 'string' ? req.body.contents.trim() : '';

  if (!Number.isInteger(postId) || postId < 1 ||
      !title || title.length > 150 || !contents || contents.length > 10000) {
    return res.status(400).json({ message: 'A valid post ID, title, and post text are required.' });
  }

  try {
    const result = await pool.query(
      `UPDATE posts
       SET title = $1, contents = $2
       WHERE id = $3 AND user_id = $4
       RETURNING id, user_id, title, contents, image_urls, video_urls, created_at;`,
      [title, contents, postId, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    res.json({ message: 'Post updated successfully.', post: result.rows[0] });
  } catch (error) {
    console.error('Unable to update post:', error.message);
    res.status(500).json({ message: 'Unable to update post.' });
  }
});

app.delete('/api/posts/:postId', requireAuthenticatedUser, async (req, res) => {
  const postId = Number(req.params.postId);
  const userId = req.authenticatedUser.id;
  if (!Number.isInteger(postId) || postId < 1) {
    return res.status(400).json({ message: 'A valid post is required.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING image_urls, video_urls;',
      [postId, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    const filenamePattern = /^\/api\/post-media\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:jpg|png|gif|webp|mp4|webm))$/i;
    let cleanupFailed = false;
    const mediaUrls = [...result.rows[0].image_urls, ...result.rows[0].video_urls];
    for (const mediaUrl of mediaUrls) {
      const match = filenamePattern.exec(mediaUrl);
      if (!match) continue;

      const stillReferenced = await pool.query(
        'SELECT 1 FROM posts WHERE image_urls @> ARRAY[$1]::TEXT[] OR video_urls @> ARRAY[$1]::TEXT[] LIMIT 1',
        [mediaUrl]
      );
      if (stillReferenced.rows.length > 0) continue;

      const filePath = path.join(privatePhotoDirectory, String(userId), 'posts', match[1]);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        console.error(`Unable to remove community media ${filePath}:`, error.message);
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      return res.status(500).json({ message: 'Post deleted, but one or more media files could not be removed.' });
    }

    res.json({ message: 'Post deleted successfully.' });
  } catch (error) {
    console.error('Unable to delete post:', error.message);
    res.status(500).json({ message: 'Unable to delete post.' });
  }
});

// User authentication and account creation routes
app.post('/api/users', async (req, res) => {
  const { name, email, password, weight_kg, height_cm, goal_type, fitness_level } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'A user with this email already exists.' });
    }

    const result = await pool.query(
      `INSERT INTO users (name, email, password, weight_kg, height_cm, goal_type, fitness_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, goal_type, fitness_level;`,
      [name, email, password, weight_kg || null, height_cm || null, goal_type || null, fitness_level || null]
    );

    await createUserSession(result.rows[0].id, res);
    res.status(201).json({ message: 'User created successfully.', user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create user.', error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, email, goal_type, fitness_level FROM users WHERE email = $1 AND password = $2',
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    await createUserSession(result.rows[0].id, res);
    res.json({ message: 'Login successful.', user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Login failed.', error: error.message });
  }
});

// User goals and meal tracking routes
app.post('/api/goals', async (req, res) => {
  const { user_id, title, description, goal_type, equipment, fitness_level, target_weight, daily_steps } = req.body;

  if (!user_id || !title) {
    return res.status(400).json({ message: 'User ID and goal title are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO goals (user_id, title, description, goal_type, equipment, fitness_level, target_weight, daily_steps)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *;`,
      [user_id, title, description || '', goal_type || null, equipment || null, fitness_level || null, target_weight || null, daily_steps || null]
    );

    res.status(201).json({ message: 'Goal saved successfully.', goal: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to save goal.', error: error.message });
  }
});

app.get('/api/goals/:userId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM goals WHERE user_id = $1 ORDER BY created_at DESC', [req.params.userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Unable to load goals.', error: error.message });
  }
});

app.post('/api/meals', async (req, res) => {
  const { user_id, meal_name, meal_type, calories, protein_g, carbs_g, fats_g } = req.body;

  if (!user_id || !meal_name || !meal_type || !calories) {
    return res.status(400).json({ message: 'User ID, meal name, meal type, and calories are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO meals (user_id, meal_name, meal_type, calories, protein_g, carbs_g, fats_g)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *;`,
      [user_id, meal_name, meal_type, calories, protein_g || 0, carbs_g || 0, fats_g || 0]
    );

    res.status(201).json({ message: 'Meal saved successfully.', meal: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to save meal.', error: error.message });
  }
});

app.get('/api/meals/:userId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM meals WHERE user_id = $1 ORDER BY consumed_at DESC', [req.params.userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Unable to load meals.', error: error.message });
  }
});

// Start the server and initialize the database
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
