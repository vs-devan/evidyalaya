# 📘 eVidyalaya — User Guide

### Kerala School Administration Management System

---

## 1. System Overview

**eVidyalaya** (ഇ-വിദ്യാലയ) is a multi-tenant school administration system designed for Kerala's government schools. It provides comprehensive tools for managing timetables, attendance, exam results, certificates, and communication between administrators, teachers, and parents.

### Key Features
| Feature | Description |
|---------|-------------|
| 🏫 Multi-Tenant | Separate tenants for UP and HS sections |
| 📅 Timetable Generator | Automatic weekly timetable with conflict resolution |
| 🔄 Substitute Management | Handle teacher absences with smart suggestions |
| ✅ Attendance | Daily attendance with present/absent toggle |
| 📝 Exam Results | Enter, upload, and broadcast exam results |
| 📜 Certificates | AI-powered certificate generation (Cover Letter, Relieving Order, Duty Certificate) |
| 💬 Messages | Broadcast messages to teachers, parents, or specific classes |
| 👥 User Management | Hierarchical access with password management |

### User Hierarchy
```
Super Admin → School Admin → Teacher → Parent/Student
```

---

## 2. Getting Started

### Default Login Credentials

| Role | Username | Password |
|------|----------|----------|
| Super Admin | `superadmin` | `superadmin123` |
| UP School Admin | `admin_up_tshss` | `admin_up_123` |
| HS School Admin | `admin_hs_tshss` | `admin_hs_123` |

> ⚠️ **Important:** School Admins will be asked to change their password on first login.

### System URL
- **Local:** `http://localhost:3000`
- **Production:** Your Vercel deployment URL

---

## 3. Super Admin Guide

### 3.1 Dashboard
The Super Admin dashboard shows:
- Total number of tenants, users, and classes
- Active tenant count
- Quick access to tenant and user management

### 3.2 Managing Tenants
1. Navigate to **Tenants** in the sidebar
2. Click **+ Add Tenant** to create a new school section
3. Fill in:
   - **School Name:** e.g., "TSHSS Punalur"
   - **Section:** UP or HS
   - **Tenant Code:** Unique identifier (e.g., `up_tshss`)
   - **Admin Account:** Create the school admin with username and password

### 3.3 Managing Users
1. Navigate to **All Users**
2. Select a tenant to view its users
3. Click **Reset Password** to change any user's password
   - You must enter your own password to confirm

---

## 4. School Admin Guide

### 4.1 Initial Setup (One-time)

**Step 1: Add Classes**
1. Go to **Classes** → **+ Add Class**
2. Enter class name (e.g., "8", "9", "10")
3. Enter divisions (comma-separated: "A, B, C")
4. Set sort order for display

**Step 2: Configure Subjects**
1. Go to **Subjects** → **+ Add Subject**
2. For each subject, set:
   - **Name & Code** (e.g., "Malayalam I" / "MAL1")
   - **Periods per Week** (e.g., 5)
   - ☑️ **Core Subject** — checked for academic subjects
   - ☑️ **Evening Priority** — checked for non-core subjects (Art, PE, etc.)
   - **Consecutive Slots** — set to 2 for IT Practical
   - ☑️ **Language Variant** — for Sanskrit/Arabic/Urdu
   - **Replaces** — select "Malayalam I" if it's a variant

**Pre-configured Subjects:**
The seed data already includes all subjects for both UP and HS sections with correct settings.

**Step 3: Add Teachers**
1. Go to **Teachers** → **+ Add Teacher**
2. Fill in:
   - **Name, Teacher Code** (e.g., "T001")
   - **Designation** (HSA or UPSA)
   - **PEN Number** (optional)
   - **Username & Password** (leave password blank for auto-generation)
   - ☑️ **Subjects** — select all subjects this teacher can teach
   - **Class Teacher Of** — assign if applicable
   - ☑️ **Feature Access** — select which features to grant

### 4.2 Generating Timetable

1. Go to **Timetable**
2. Click **🔄 Generate Timetable**
3. The system will:
   - Assign class teachers to Period 1
   - Prioritize core subjects in morning slots (1-4)
   - Place evening-priority subjects in afternoon slots (5-7)
   - Handle consecutive slots (IT Practical)
   - Ensure no teacher conflicts
4. Review the generated timetable:
   - **Weekly View:** See one division's full week
   - **Daily View:** See all divisions for a single day
5. Click **🖨️ Print** to print the timetable

### 4.3 Managing Substitutes

1. Go to **Substitute**
2. Select the **date** and the **absent teacher**
3. The system shows all affected periods with available substitutes
4. Select a substitute for each slot
5. Click **Save Substitutions**
6. Click **🖨️ Print Updated** to print the day's timetable with substitutions

### 4.4 Managing Students

1. Go to **Students**
2. Select a class/division
3. Click **+ Add Student**
4. Enter roll number, name, parent name, and phone
5. The system generates:
   - **Username:** `{tenantCode}_{class}{division}_{rollNumber}` (e.g., `hs_tshss_8a_01`)
   - **Password:** Auto-generated (displayed once — copy it!)

### 4.5 Attendance

1. Go to **Attendance**
2. Select date and division
3. All students default to **Present**
4. Click to toggle any student to **Absent**
5. Click **Save Attendance**

### 4.6 Exam Results

1. Go to **Results**
2. Select division and exam type (First Term, Mid Term, Annual)
3. Enter marks in the inline grid
4. Click **Save Results**
5. Use **📥 Download Template** to get a CSV for offline data entry

### 4.7 Certificates

1. Go to **Certificates** → **+ Generate Certificate**
2. Select type: Cover Letter, Relieving Order, or Duty Certificate
3. Select the teacher
4. Add context/details
5. Optionally paste supporting document content
6. Click **🤖 Generate with AI** — Gemini creates the content
7. Review and download

### 4.8 Messages

1. Go to **Messages** → **+ New Message**
2. Select target: Everyone, All Teachers, All Parents, or Specific Class
3. Type your message
4. Click **Send Message**

### 4.9 Settings

- **Change Own Password:** Update your own password
- **Reset User Password:** Reset any teacher or parent password (requires your password confirmation)

---

## 5. Teacher Guide

### 5.1 First Login
1. Log in with your teacher code and assigned password
2. You will be prompted to change your password

### 5.2 Dashboard
Shows today's timetable, period count, and recent messages.

### 5.3 Timetable
View your weekly schedule showing:
- Subject name for each period
- Which class/division you're teaching
- "Free" periods when you have no assignment

### 5.4 Attendance (Class Teachers Only)
1. Go to **Attendance**
2. Select the date
3. All students default to **Present**
4. Toggle any absent students
5. Click **Save**

### 5.5 Students (Class Teachers Only)
- View all students in your class
- Add new students with **+ Add Student**
- Generated credentials are shown once — share with parents

### 5.6 Results (Class Teachers Only)
- Enter exam marks in the inline grid
- Select exam type and save

### 5.7 Messages
- View received messages from administration
- Send messages to your class parents (class teachers only)

---

## 6. Parent Guide

### 6.1 Login
Use the credentials shared by the class teacher:
- **Username:** `{tenantCode}_{class}{division}_{rollNumber}`
- **Password:** As provided (you'll be asked to change it)

### 6.2 Dashboard
Your dashboard shows:
- **Attendance percentage** — overall and daily breakdown
- **Days present / absent**
- **Weekly timetable** for your child's class
- **Exam results** — subject-wise marks
- **Messages** from teachers and administration

### 6.3 Features
| Feature | What You Can See |
|---------|-----------------|
| Timetable | Full weekly timetable with subjects |
| Attendance | Date-wise present/absent history with % |
| Results | Subject-wise marks for each exam |
| Messages | Notifications from school and class teacher |

---

## 7. Technical Setup

### 7.1 Prerequisites
- Node.js 18+
- PostgreSQL database (Supabase free tier recommended)
- Vercel account for deployment

### 7.2 Local Development
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
# Edit .env.local with your database URL and secrets

# 3. Push database schema
npm run db:push

# 4. Seed the database
npm run seed

# 5. Start development server
npm run dev
```

### 7.3 Environment Variables
```env
DATABASE_URL="postgresql://..."          # Supabase pooled connection
DIRECT_URL="postgresql://..."            # Supabase direct connection
NEXTAUTH_SECRET="your-secret"           # Random secret string
NEXTAUTH_URL="http://localhost:3000"     # App URL
GEMINI_API_KEY="your-api-key"           # Google Gemini API key
```

### 7.4 Deployment to Vercel
1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy!

### 7.5 Database Management
```bash
npm run db:push    # Push schema changes
npm run db:studio  # Open Prisma Studio (visual DB editor)
npm run seed       # Run seed script
```

---

## 8. Timetable Rules

The automatic timetable generator follows these principles:

1. **7 periods/day:** Slots 1-4 (before lunch), Slots 5-7 (after lunch)
2. **Class teacher priority:** Period 1 belongs to the class teacher's subject
3. **Core subjects first:** Academic subjects placed in morning slots
4. **Evening priority:** Non-core subjects (Art, PE, Work Exp) in afternoon
5. **No conflicts:** A teacher can't be in two places at once
6. **Distribution:** Each subject appears at most once per day per division
7. **Consecutive slots:** IT Practical gets 2 back-to-back periods
8. **Load balancing:** Even distribution of teaching load across teachers
9. **Consistency:** Same timetable repeats every week throughout the year

---

## 9. Support & Troubleshooting

| Issue | Solution |
|-------|----------|
| Can't login | Check username/password, ensure account is active |
| Timetable has conflicts | Add more teachers or reduce subjects per division |
| Password forgotten | Ask your admin (hierarchy: Super Admin → School Admin → Teacher) |
| Subjects missing | School admin needs to add subjects first |
| Attendance not saving | Check internet connection, try again |

---

> **eVidyalaya** — Empowering Kerala's Government Schools 🏫
