# Project_Group_23_Digital_Health_and_Wellness_Application 

This project is for a digital health and wellness web application that currently has:

- An Express.js API to save users, goals, and meals
- A PostgreSQL schema for personalized fitness data

## Quick start

1. Install dependencies:
   npm install
2. Create a PostgreSQL database called `digital_health_app` and set the connection string in `.env`.
3. Start the app:
   npm start
4. Open http://localhost:3000/login

## Database setup

Use the schema in `db/schema.sql` or run it in PostgreSQL:

```bash
psql -U postgres -d digital_health_app -f db/schema.sql
```