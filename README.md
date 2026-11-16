# Project_Group_23_Digital_Health_and_Wellness_Application 

This project is for a digital health and wellness web application that currently has:

- An Express.js API to save users, goals, and meals
- A community feed where signed-in users can create posts and attach photos/videos
- A PostgreSQL schema for personalized fitness data

## Quick start

1. Install dependencies:
   npm install
2. Create a PostgreSQL database called `digital_health_app` and set the connection string in `.env`.
3. Start the app:
   npm start
4. Open http://localhost:3000/login
5. Open the Community link on the dashboard to create and view posts.

Post text is stored in PostgreSQL. Photos and videos attached to community posts
are stored under `storage/private-photos/<user-id>/posts`; they are not public
static files, but signed-in community members can view them through an
authenticated API. Posts accept up to four photos (5 MB each) and one MP4 or WebM
video (25 MB). Post media is the only supported upload path; it is not shown on
the dashboard or a profile page. Existing private profile-library media from
earlier versions remains stored privately but is no longer displayed or served.
Existing post uploads under `public/uploads` are moved into private folders at
startup when their files are available; the `/uploads` URL is no longer served.
Deployments must use persistent storage for `storage/` or replace it with private
object storage. User sessions are stored in PostgreSQL and sent in an HttpOnly
cookie.

The community feed can show recent posts, the signed-in user's own posts, or
recommended posts. Recommendations currently rank posts from users with a
matching fitness goal or fitness level recorded in their profile or latest
saved goal, newest first. The Friends' posts option is a placeholder until
friend connections are implemented.

## Database setup

Use the schema in `db/schema.sql` or run it in PostgreSQL:

```bash
psql -U postgres -d digital_health_app -f db/schema.sql
```