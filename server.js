const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const projectRoot = __dirname;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/digital_health_app',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(express.static(path.join(projectRoot, 'public')));

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

    console.log('Database initialized successfully.');
  } catch (error) {
    console.warn('Database initialization skipped. Ensure PostgreSQL is running and DATABASE_URL is configured.');
    console.warn(error.message);
  }
}

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS current_time');
    res.json({ status: 'ok', database: 'connected', time: result.rows[0].current_time });
  } catch (error) {
    res.json({ status: 'ok', database: 'offline', message: 'PostgreSQL is not connected yet.' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(projectRoot, 'public', 'login.html'));
});

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

    res.json({ message: 'Login successful.', user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Login failed.', error: error.message });
  }
});

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

initializeDatabase();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
