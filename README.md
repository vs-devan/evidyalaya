This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel & Data Isolation

To deploy the application securely on Vercel and ensure production data isolation from local database credentials and files, follow these guidelines:

1. **Environment Variables**: Define production environment variables (like `DATABASE_URL` and NextAuth credentials) inside the Vercel project settings. The production database is entirely independent. Local `.env` and `.env.local` files are ignored via `.gitignore` and won't be pushed.
2. **Database Migrations/Sync**:
   - For database schema changes, run `npx prisma db push` locally or in CI to sync the database schema.
   - The production database schema will be updated according to `prisma/schema.prisma` without overriding or losing existing production timetable records.
3. **Data Protection**:
   - Seed data (`prisma/seed.ts`) is meant for initial local development setup and is not executed automatically on build/deploy.
   - Local helper/inspection scripts (e.g., `inspect_*.ts`), local credentials, and powershell scripts are explicitly added to `.gitignore` to prevent leaking any timetable records or security credentials to the repository.

## New Timetable Features

1. **Physical Education Constraint (Period 1 Avoidance)**:
   - Built-in hard solver constraints in `src/lib/timetable-solver.ts` and fallback rules in `src/lib/timetable-engine.ts` guarantee that PE/evening-priority subjects are never scheduled in Period 1.
2. **Per-Division Locking**:
   - Admins can lock specific classes to preserve their timetables while regenerating others.
   - The generation API endpoint (`/api/timetable/generate`) reads locked divisions, preserves their database entries, and feeds locked teacher-time slots into the solver as rigid constraints.
3. **Manual Cell Editing**:
   - Toggle "Edit Mode" on the timetable page.
   - Click any cell in an unlocked division to change or unassign a subject and teacher.
   - Real-time conflict validation checks if teachers are double-booked or if divisions are locked.
   - Swap slot: click "Swap Slot", select another cell within the same class, and atomically exchange their contents.
4. **Subject-Aware Substitution Suggestions**:
   - Free substitute teachers on the Substitution page are ranked by relevance: Regular for this class > Subject Expert > Qualified > Others, displaying badges for each relevance level.
