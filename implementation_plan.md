# 🏫 eVidyalaya — Kerala School Administration Management System

## Implementation Plan

---

## 1. Portal Name & Branding

**Name: eVidyalaya** (ഇ-വിദ്യാലയ)
- "Vidyalaya" = School in Malayalam/Sanskrit
- "e" = Electronic/Digital
- Tagline: *"Empowering Kerala's Government Schools"*

---

## 2. System Architecture

### Tech Stack
| Layer | Technology | Hosting |
|-------|-----------|---------|
| Frontend | Next.js 15 (App Router) | Vercel (Free Tier) |
| Backend | Next.js API Routes | Vercel Serverless |
| Database | PostgreSQL | Supabase (Free Tier) |
| ORM | Prisma | - |
| Auth | NextAuth.js (Credentials) | - |
| AI | Google Gemini 2.0 Flash | API Key |
| PDF | @react-pdf/renderer | - |
| Styling | CSS Modules + CSS Variables | - |

### Multi-Tenancy Architecture
```
Super Admin (Global)
├── Tenant: up_tshss (UP Section - TSHSS Punalur)
│   ├── School Admin (Headmistress)
│   ├── Teachers
│   └── Parents/Students
└── Tenant: hs_tshss (HS Section - TSHSS Punalur)
    ├── School Admin (Headmistress)
    ├── Teachers
    └── Parents/Students
```

### User Hierarchy
```
Super Admin → Can manage everything across all tenants
  └── School Admin → Manages own tenant (school section)
       └── Teacher → Manages assigned classes/subjects
            └── Parent/Student → View-only dashboard
```

### Password Reset Hierarchy
- Super Admin can reset School Admin passwords
- School Admin can reset Teacher passwords
- Teacher (Class Teacher) can reset Student/Parent passwords
- All require re-confirmation of the resetter's password

---

## 3. Database Schema (Prisma)

### Core Entities

#### Tenant
- id, name, code (up_tshss, hs_tshss), schoolName, section (UP/HS)
- schoolType, academicYear, isActive

#### User
- id, tenantId, username, password (hashed), role (SUPER_ADMIN, SCHOOL_ADMIN, TEACHER, PARENT)
- name, email, phone, isActive, mustChangePassword, createdBy

#### Teacher (extends User)
- teacherCode, penNo, designation (UPSA/HSA)
- subjects (many-to-many), classTeacherOf (Class+Division)

#### Student
- id, tenantId, rollNumber, name, parentName, parentPhone
- classId, divisionId, userId (parent account)

#### Class & Division
- Class: id, tenantId, name (e.g., "8", "9", "10")
- Division: id, classId, name (e.g., "A", "B", "C")

#### Subject
- id, tenantId, name, code
- isCore, eveningPriority, consecutiveSlots (default 1)
- replacesSubject (for Sanskrit/Arabic/Urdu replacing Malayalam I)

#### Timetable
- id, tenantId, divisionId, dayOfWeek (MON-SAT)
- slots (1-7), each with subjectId, teacherId
- isActive, academicYear

#### Attendance
- id, studentId, date, isPresent, markedBy (teacherId)

#### ExamResult
- id, studentId, examName, subjectId, marks, grade, date

#### Message (Broadcast)
- id, tenantId, senderId, senderRole, content
- targetType (CLASS, ALL_TEACHERS, ALL_PARENTS), targetClassId
- createdAt, attachments

#### Certificate
- id, tenantId, type (COVER_LETTER, RELIEVING_ORDER, DUTY_CERTIFICATE)
- generatedFor (teacherId), content, attachments, generatedAt

#### SubstituteAssignment
- id, tenantId, date, absentTeacherId
- originalSlot, originalDivisionId
- substituteTeacherId, assignedBy

---

## 4. Feature Breakdown

### 4.1 Authentication & Authorization
- [x] Credentials-based login (username/password)
- [x] Role-based access control (RBAC)
- [x] Password change on first login
- [x] Hierarchical password reset
- [x] Session management with NextAuth.js
- [x] Multi-tenant isolation (all queries filtered by tenantId)

### 4.2 Timetable Generator
**Setup Flow:**
1. Add Classes (8, 9, 10 for HS; 5, 6, 7 for UP)
2. Add Divisions (A, B, C per class)
3. Add Subjects with properties:
   - Name, periods per week
   - Is Core subject?
   - Evening priority (checkbox)
   - Consecutive slots required (e.g., IT Practical = 2)
   - Language replacement options (Sanskrit/Arabic/Urdu for Malayalam I)
4. Add Teachers with subject mappings
5. Assign Class Teachers to divisions

**Generation Algorithm:**
- 7 periods/day: 4 before lunch (1-4), 3 after lunch (5-7)
- Monday to Friday (or Saturday)
- Rules:
  1. Class teacher gets Period 1 of their division
  2. Core subjects prioritized in morning slots (1-4)
  3. Evening priority subjects in slots 5-7
  4. No teacher double-booked in same slot
  5. Subject distributed max once per day per division
  6. Consecutive slots for subjects requiring them (IT Practical)
  7. Uniform distribution of teaching load across teachers
  8. Single teacher per subject per division
  9. Language variants handled (Sanskrit/Arabic/Urdu groups)

**Views:**
- Weekly timetable (all divisions grid)
- Single day timetable (all classes & divisions)
- Teacher-wise timetable
- Printable format

### 4.3 Substitute Assignment
- Select date → Show absent teachers
- For each absent teacher's slots: show available teachers
- Admin selects substitutes
- Generate & print updated timetable for the day
- Notification to substitute teachers

### 4.4 Certificate Generation
- Types: Cover Letter, Relieving Order, Duty Certificate
- Upload supporting documents
- Gemini AI generates draft content
- Edit & finalize
- Dynamic PDF generation

### 4.5 Teacher Management
- CRUD operations for teacher profiles
- Search, filter, sort
- Export as PDF
- Fields: Teacher Code, Name, PEN No, Designation, Subjects, Class Teacher status
- Feature access control (admin assigns which features each teacher can access)

### 4.6 Student Management
- Class Teacher creates student accounts
- Username format: `{tenantCode}_{class}{division}_{rollNumber}` (e.g., tshss_8a_01)
- Fields: Roll Number, Name, Parent Name, Phone Number
- Auto-generated password with forced change on first login

### 4.7 Attendance
- Class Teacher takes attendance
- Default: All present → Mark absent by name
- Daily attendance records
- Attendance statistics (% present, % absent)
- Date-wise attendance history

### 4.8 Exam Results
- Upload via Excel (provide sample Excel template)
- Class Teacher uploads → Share with subject teachers
- Subject teachers fill marks → Return to Class Teacher
- Class Teacher updates system
- Broadcast results to parents
- Download sample Excel template

### 4.9 Messaging & Broadcasting
- School Admin → All Teachers & Parents
- Class Teacher → Class Parents
- Notification system on parent dashboard

### 4.10 Parent Dashboard
- Attendance overview (% present, % absent, dates)
- Class timetable (weekly view)
- Exam results
- Messages/Notifications
- Student profile

---

## 5. Subjects Configuration

### High School (HS) Subjects
| Subject | Periods/Week | Core | Evening Priority | Consecutive | Notes |
|---------|-------------|------|-----------------|-------------|-------|
| Malayalam I | 5 | ✅ | ❌ | 1 | Replaceable by Sanskrit/Arabic |
| Malayalam II | 5 | ✅ | ❌ | 1 | |
| English | 6 | ✅ | ❌ | 1 | |
| Hindi | 4 | ✅ | ❌ | 1 | |
| Social Science | 5 | ✅ | ❌ | 1 | |
| Physics | 4 | ✅ | ❌ | 1 | |
| Chemistry | 4 | ✅ | ❌ | 1 | |
| Biology | 4 | ✅ | ❌ | 1 | |
| Mathematics | 6 | ✅ | ❌ | 1 | |
| Work Experience | 2 | ❌ | ✅ | 1 | |
| Art | 1 | ❌ | ✅ | 1 | |
| Physical Education | 2 | ❌ | ✅ | 1 | |
| IT Practical | 2 | ❌ | ✅ | 2 | Consecutive slots |
| IT Theory | 1 | ❌ | ❌ | 1 | |
| Recreation | 1 | ❌ | ✅ | 1 | |

### Upper Primary (UP) Subjects
| Subject | Periods/Week | Core | Evening Priority | Consecutive | Notes |
|---------|-------------|------|-----------------|-------------|-------|
| English | 6 | ✅ | ❌ | 1 | |
| Malayalam I | 6 | ✅ | ❌ | 1 | Replaceable by Sanskrit/Urdu/Arabic |
| Malayalam II | 5 | ✅ | ❌ | 1 | |
| Hindi | 5 | ✅ | ❌ | 1 | |
| Social Science | 5 | ✅ | ❌ | 1 | |
| Basic Science | 5 | ✅ | ❌ | 1 | |
| Mathematics | 6 | ✅ | ❌ | 1 | |
| Work Experience | 2 | ❌ | ✅ | 1 | |
| Art | 1 | ❌ | ✅ | 1 | |
| Physical Education | 2 | ❌ | ✅ | 1 | |
| IT | 2 | ❌ | ✅ | 1 | |
| Recreation | 1 | ❌ | ✅ | 1 | |
| Library | 1 | ❌ | ✅ | 1 | |

---

## 6. Project Structure

```
d:\school-web\
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── public/
│   ├── templates/           # Excel templates
│   └── assets/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx          # Landing/Login
│   │   ├── login/
│   │   ├── globals.css
│   │   ├── (super-admin)/
│   │   │   ├── dashboard/
│   │   │   ├── tenants/
│   │   │   └── users/
│   │   ├── (school-admin)/
│   │   │   ├── dashboard/
│   │   │   ├── classes/
│   │   │   ├── subjects/
│   │   │   ├── teachers/
│   │   │   ├── timetable/
│   │   │   ├── substitute/
│   │   │   ├── certificates/
│   │   │   ├── students/
│   │   │   ├── messages/
│   │   │   └── settings/
│   │   ├── (teacher)/
│   │   │   ├── dashboard/
│   │   │   ├── timetable/
│   │   │   ├── attendance/
│   │   │   ├── students/
│   │   │   ├── results/
│   │   │   └── messages/
│   │   ├── (parent)/
│   │   │   ├── dashboard/
│   │   │   ├── timetable/
│   │   │   ├── attendance/
│   │   │   ├── results/
│   │   │   └── messages/
│   │   └── api/
│   │       ├── auth/
│   │       ├── tenants/
│   │       ├── classes/
│   │       ├── subjects/
│   │       ├── teachers/
│   │       ├── timetable/
│   │       ├── substitute/
│   │       ├── certificates/
│   │       ├── students/
│   │       ├── attendance/
│   │       ├── results/
│   │       └── messages/
│   ├── components/
│   │   ├── ui/               # Reusable UI components
│   │   ├── layout/           # Layout components
│   │   ├── timetable/        # Timetable-specific components
│   │   └── forms/            # Form components
│   ├── lib/
│   │   ├── prisma.ts         # Prisma client
│   │   ├── auth.ts           # Auth configuration
│   │   ├── gemini.ts         # Gemini AI client
│   │   ├── timetable-engine.ts  # Timetable generation algorithm
│   │   ├── pdf.ts            # PDF generation utilities
│   │   └── utils.ts          # General utilities
│   ├── hooks/                # Custom React hooks
│   └── types/                # TypeScript types
├── .env.local
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 7. Development Phases

### Phase 1: Foundation (Current)
1. ✅ Project setup (Next.js + Prisma + Supabase)
2. ✅ Database schema design
3. ✅ Authentication system
4. ✅ Multi-tenant middleware
5. ✅ Super Admin dashboard
6. ✅ Tenant management

### Phase 2: School Setup
1. ✅ Class & Division management
2. ✅ Subject management (with all options)
3. ✅ Teacher management & profiles
4. ✅ Feature access control

### Phase 3: Timetable System
1. ✅ Timetable generation algorithm
2. ✅ Timetable views (weekly, daily, teacher-wise)
3. ✅ Substitute assignment
4. ✅ Print functionality

### Phase 4: Student & Parent
1. ✅ Student management
2. ✅ Attendance system
3. ✅ Exam results (Excel upload/download)
4. ✅ Parent dashboard
5. ✅ Messaging system

### Phase 5: Certificates & AI
1. ✅ Certificate generation with Gemini AI
2. ✅ Document upload
3. ✅ PDF generation & download

### Phase 6: Polish
1. ✅ Responsive design (mobile, tablet, desktop)
2. ✅ Error handling & edge cases
3. ✅ Performance optimization
4. ✅ User guide documentation

---

## 8. Environment Variables
```env
DATABASE_URL="postgresql://..."          # Supabase connection string
DIRECT_URL="postgresql://..."            # Supabase direct connection
NEXTAUTH_SECRET="..."                    # Auth secret
NEXTAUTH_URL="http://localhost:3000"     # App URL
GEMINI_API_KEY="..."                     # Google Gemini API key
```

---

## 9. Key Design Decisions

1. **Multi-tenant isolation**: All database queries include `tenantId` filter
2. **Timetable engine**: Custom constraint-satisfaction algorithm with backtracking
3. **Language variants**: Treated as separate subject instances linked to base subject
4. **Excel handling**: Use `xlsx` library for import/export
5. **PDF generation**: Server-side with `@react-pdf/renderer`
6. **Real-time updates**: Not needed for V1, polling for messages
7. **File storage**: Supabase Storage (free tier)

---

> [!IMPORTANT]
> This plan covers the complete system. Development will proceed through all phases sequentially, building the entire application in this session.
