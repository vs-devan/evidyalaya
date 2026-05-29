# Public Hosting Guide (100% Free)

This guide provides step-by-step instructions to host **eVidyalaya** publicly for free using modern cloud platforms. We will use **GitHub** for source control, **Neon** for a free managed PostgreSQL database, and **Vercel** for hosting the Next.js frontend and serverless API handlers.

---

## 📋 Architectural Overview

```mermaid
graph TD
    User([User's Browser]) <-->|HTTPS| Vercel[Vercel Serverless Hosting]
    Vercel <-->|NextAuth / Gemini API| Gemini[Google Gemini AI]
    Vercel <-->|Prisma Client| Neon[(Neon Serverless PostgreSQL)]
    Github[GitHub Repo] -->|CI/CD Git Push| Vercel
```

---

## 🛠️ Step 1: Create a PostgreSQL Database on Neon

Since our schema in [schema.prisma](file:///d:/school-web/prisma/schema.prisma) is configured for PostgreSQL, we need a cloud-hosted Postgres instance. **Neon.tech** provides a serverless PostgreSQL database with a generous free tier.

1. **Sign Up**: Go to [neon.tech](https://neon.tech) and create a free account.
2. **Create Project**:
   - Project Name: `evidyalaya`
   - Database Version: `PostgreSQL 16` (or latest)
   - Region: Select the region closest to your target users (e.g., *AWS Asia Pacific (Singapore)* or *Europe (Frankfurt)*).
3. **Get Connection String**:
   - In the Neon dashboard, copy your database connection string. It will look like this:
     ```env
     postgresql://neondb_owner:password@ep-cool-snowflake-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
     ```
   - Keep this connection string safe! You will need it for both your environment variables and database seeding.

---

## 📁 Step 2: Push your Code to GitHub

Vercel deploys automatically whenever you push code to GitHub.

1. **Create a GitHub Repository**: Go to [github.com](https://github.com) and create a new **private** repository named `school-web`.
2. **Ensure files are ignored**: Verify that sensitive files like [.env.local](file:///d:/school-web/.env.local) are listed in your [.gitignore](file:///d:/school-web/.gitignore) file so they are never leaked publicly.
3. **Initialize and Push Git**:
   Open a terminal in `d:/school-web` and run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for deployment"
   git branch -M main
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/school-web.git
   git push -u origin main
   ```

---

## ⚡ Step 3: Deploy on Vercel

Vercel is the creator of Next.js and offers the best hosting support for it with zero configuration.

1. **Sign Up**: Go to [vercel.com](https://vercel.com) and sign up with your GitHub account.
2. **Import Project**:
   - Click **Add New** > **Project**.
   - Import the `school-web` repository from your GitHub list.
3. **Configure Environment Variables**:
   Under the **Environment Variables** section in the Vercel project configuration, add the following variables:

| Key | Value | Notes |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://... (Your Neon connection string)` | Ensure you append `?sslmode=require` if it's not present. |
| `NEXTAUTH_SECRET` | *[Generate a secret]* | Run `openssl rand -base64 32` in your local terminal to get a random key. |
| `NEXTAUTH_URL` | `https://your-project.vercel.app` | Replace with your actual Vercel deployment URL (or leave blank; Vercel often auto-configures this). |
| `GEMINI_API_KEY` | `AIzaSy...` | Your Google Gemini API Key. |

4. **Modify Build Settings for Prisma (CRITICAL)**:
   By default, Vercel will run `npm run build`. Since we are using Prisma, we must push the database schema to the Neon database before compiling the Next.js app.
   - Go to **Build and Development Settings**.
   - Toggle **Build Command** override.
   - Set it to:
     ```bash
     npx prisma db push && next build
     ```
   *(Note: This guarantees that Neon has the latest schema before Vercel starts compile-time static page checks.)*

5. **Deploy**: Click the **Deploy** button. Vercel will build and deploy your application.

---

## 🌱 Step 4: Seed the Database

Once the site is built and deployed, your database schema is created, but it will be empty. You need to seed the initial data (like tenants, admin users, etc.) so you can log in.

We can run the Prisma seed script from your local machine, pointing it directly to your remote Neon production database:

1. Temporarily replace the `DATABASE_URL` inside your local [.env.local](file:///d:/school-web/.env.local) file with your **Neon Connection String**.
   > [!WARNING]
   > Never commit this connection string to GitHub. After seeding, revert the changes in [.env.local](file:///d:/school-web/.env.local).
2. Run the seeding command in your local terminal:
   ```bash
   npx prisma db seed
   ```
3. Once completed, your database is populated! Revert [.env.local](file:///d:/school-web/.env.local) back to your local database URL (`postgresql://postgres:pass@localhost:5432/...`) so you can resume local development.

---

## 🔒 Step 5: Set Up Auth Redirection (NextAuth)

If your app uses Google/GitHub OAuth logins under NextAuth, you must update the redirect URIs in the respective developer consoles (Google Cloud Console, GitHub Developer Settings) to point to your new Vercel domain:

- **Authorized Redirect URI**: `https://your-project.vercel.app/api/auth/callback/google` (or whichever auth provider you use).
- For credential-based auth (username/password), no external OAuth callback URLs are required.

---

## 💡 Troubleshooting & Tips

> [!TIP]
> **Serverless Cold Starts**: Neon free tier databases automatically "suspend" (go to sleep) after 5 minutes of inactivity to save resources. When a user visits your app after a period of inactivity, the first database query might take 3–5 seconds to spin up the database. This is normal for free hosting.

> [!IMPORTANT]
> **Next.js 16 Compatibility**:
> Since this app runs on Next.js 16 and React 19 (see [package.json](file:///d:/school-web/package.json)), make sure your local Node.js version matches Vercel's Node version (Node 20+ is recommended). Vercel handles this automatically, but if you run into deployment issues, verify the Node version in Vercel settings.

---

🎉 **Congratulations! Your eVidyalaya school portal is now live publicly for free!**
