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

INSERT INTO workout_plans (goal_type, fitness_level, workout_type, duration_minutes, weekly_days, rest_days, notes)
VALUES
('weight loss', 'beginner', 'cardio', 30, 'Mon, Wed, Fri', 'Tue, Thu, Sat', 'Focus on brisk walks, cycling, and low-impact training.'),
('bigger arms', 'intermediate', 'strength', 45, 'Mon, Tue, Thu, Sat', 'Wed, Fri, Sun', 'Prioritize arms, shoulders, and compound lifts.'),
('lose belly fat', 'beginner', 'yoga', 25, 'Mon, Wed, Fri, Sun', 'Tue, Thu, Sat', 'Combine mobility with moderate cardio bursts.'),
('muscle gain', 'advanced', 'strength', 60, 'Mon, Tue, Thu, Fri', 'Wed, Sat, Sun', 'Focus on progressive overload and recovery.' );
