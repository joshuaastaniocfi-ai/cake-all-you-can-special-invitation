# Goldilocks Cake All You Can — MongoDB Atlas & Vercel Deployment Guide

This project includes a static frontend and a serverless-ready Node.js/Express backend configured for **MongoDB Atlas** and **Vercel**.

---

## ⚡ How to Deploy on Vercel

### Step 1: Whitelist Vercel in MongoDB Atlas (Important!)
Because Vercel serverless functions run across dynamic cloud IP addresses:
1. Log in to [MongoDB Atlas](https://cloud.mongodb.com/).
2. In the left sidebar, click **Security** &rarr; **Network Access**.
3. Click **+ Add IP Address**.
4. Click **Allow Access from Anywhere** (adds `0.0.0.0/0`).
5. Click **Confirm**.

---

### Step 2: Deploy to Vercel

#### Option A: Deploy via GitHub (Recommended)
1. Push your project files to a GitHub repository (e.g. `goldilocks-rsvp`).
2. Go to [vercel.com](https://vercel.com) and log in.
3. Click **Add New...** &rarr; **Project**.
4. Import your GitHub repository.
5. Under **Environment Variables**, add:
   - **Name**: `MONGODB_URI`
   - **Value**: Your full MongoDB Atlas connection string (e.g. `mongodb+srv://<username>:<password>@cluster0.mongodb.net/goldilocks_db?retryWrites=true&w=majority`)
6. Click **Deploy**.

#### Option B: Deploy directly using Vercel CLI
If you prefer deploying directly from your computer terminal without GitHub:
1. Open PowerShell or Terminal in this folder (`c:\Users\ASUS\Downloads\files (3)`).
2. Run:
   ```bash
   npx vercel
   ```
3. Follow the one-time prompts to log in and select your Vercel team/scope.
4. When asked to set environment variables or once deployed, add your `MONGODB_URI`:
   ```bash
   npx vercel env add MONGODB_URI
   ```
   *(Paste your MongoDB connection string when prompted, selecting `Production`, `Preview`, and `Development`)*
5. Deploy to production:
   ```bash
   npx vercel --prod
   ```

---

## 🛠️ Project Structure for Vercel
- **[`vercel.json`](vercel.json)**: Configures rewrites so all `/api/*` routes are handled by serverless functions while static files (`index.html`, `styles.css`, `script.js`, `assets/`) are served via Vercel's global CDN.
- **[`api/index.js`](api/index.js)**: Serverless entry point for Vercel that exports the Express app.
- **[`server.js`](server.js)**: Express app featuring connection caching (`global.mongoose`) to prevent connection exhaustion during serverless cold starts, and fallback handling.
- **[`.env`](.env)**: Local environment variables file (never committed to git).

---

## 💻 Running Locally

1. Set your MongoDB connection in `.env`:
   ```env
   PORT=3000
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/goldilocks_db?retryWrites=true&w=majority
   ```
2. Start the local server:
   ```bash
   npm start
   ```
3. Visit [http://localhost:3000](http://localhost:3000).
