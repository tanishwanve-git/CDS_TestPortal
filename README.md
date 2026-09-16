# CDS Test Portal

An online assessment and mock examination platform designed for competitive exams like GATE (Graduate Aptitude Test in Engineering). The portal provides a secure, timed test arena, automated grading with negative marking, detailed performance analytics, and dynamic branch-specific question bank management (Mechanical & Computer Science).

---

## 🚀 Features

- **User Authentication & Profiles:**
  - Standard email/password registration and login with JWT-based session security.
  - Google OAuth 2.0 Sign-In integration.
  - Forgot password workflow with secure Email OTP verification.
  - Branch and roll-number profile management.

- **Interactive Test Arena:**
  - Real-time countdown timers with section-specific timings.
  - Question status palette (Answered, Marked for Review, Visited, Skipped).
  - Support for multiple question types:
    - **MCQ (Multiple Choice Questions):** Single correct choice with negative marking (+4 / -1).
    - **NAT (Numerical Answer Type):** Direct numerical input without negative marking (+4 / 0).
  - Rich image support for formula diagrams, figures, and question options.

- **Automated Grading & Performance Review:**
  - Instant server-side evaluation upon submission.
  - Secure test delivery (correct answers are never exposed to the frontend during test sessions).
  - Post-test review dashboard with sectional scores, time analysis, and score distribution charts.

- **Dynamic Question Bank Architecture:**
  - Multi-branch support organized under `questions/<branch>/`.
  - Automatic random sampling (e.g., dynamic selection of 50 random questions from large question pools).

---

## 🛠️ Technology Stack

- **Backend:** Node.js, Express.js
- **Database:** MySQL 5.7+ / 8.0+ (`mysql2/promise`)
- **Authentication:** JSON Web Tokens (`jsonwebtoken`), `bcrypt`, `google-auth-library`
- **Email Service:** `nodemailer` (SMTP for OTP password recovery)
- **Frontend:** HTML5, Modern Vanilla JavaScript (ES6+), CSS3 (Custom Glassmorphic & Modern Theme)
- **Data Import Parsers:** `xlsx`, `csv-parser`

---

## 📁 Project Structure

```
├── database/
│   ├── alter_db.js              # Database migration helper
│   ├── fix_db_images.js         # Fixes and validates image URL paths in DB
│   ├── import_cs.js             # Imports CS GATE questions into MySQL
│   ├── import_numbers.js        # Imports Mechanical GATE .numbers questions into MySQL
│   ├── import_excel.js          # Excel import utility
│   ├── schema.sql               # Base database schema
│   └── seed_gate.js             # Test database seed script
├── public/                      # Static frontend assets
│   ├── css/
│   │   ├── dashboard.css
│   │   └── style.css
│   ├── images/                  # Portal UI assets and logos
│   ├── js/
│   │   ├── dashboard.js         # Student dashboard interactions
│   │   ├── main.js              # Auth & profile scripts
│   │   └── test-arena.js        # Timed test engine & question palette
│   ├── dashboard.html           # Student home & available tests
│   ├── forgot-password.html     # OTP password reset flow
│   ├── index.html               # Login & registration portal
│   ├── review.html              # Post-exam review & analytics
│   └── test-arena.html          # Exam execution interface
├── questions/                   # Branch-specific question pools & assets
│   ├── cs/
│   │   ├── gate_cs_template.csv # 534+ Computer Science questions pool
│   │   └── images/
│   └── mechanical/
│       ├── gate_mechanical_template.numbers # Mechanical question template
│       └── images/              # Question diagram images (img1.png - img32.png)
├── src/
│   ├── config/
│   │   └── db.js                # MySQL connection pool & automatic table bootstrap
│   ├── controllers/
│   │   ├── authController.js    # Register, login, Google sign-in
│   │   ├── passwordController.js# OTP generation & reset
│   │   ├── testController.js    # Test delivery, submission grading & reviews
│   │   └── userController.js    # User profile & dashboard data
│   ├── middlewares/
│   │   └── authMiddleware.js    # JWT authorization guard
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── testRoutes.js
│   │   └── userRoutes.js
│   └── utils/
│       └── mailer.js            # Nodemailer transport configuration
├── .env.example                 # Environment variable template
├── .gitignore
├── package.json
└── server.js                    # Application entry point
```

---

## ⚙️ Prerequisites

- **Node.js:** v18.0.0 or higher (v20+ recommended)
- **MySQL Server:** 5.7 or higher running locally or in cloud
- **npm** (Node Package Manager)

---

## 🔧 Installation & Setup

### 1. Clone the repository
```bash
git clone https://github.com/tanishwanve-git/CDS_TestPortal.git
cd CDS_TestPortal
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env` file in the root directory by copying `.env.example`:
```bash
cp .env.example .env
```

Configure your `.env` parameters:
```env
PORT=5000
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=cds_portal
JWT_SECRET=your_jwt_secret_key

# Optional: Google Sign-In
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Optional: Email OTP for Password Reset
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_FROM=CDS Test Portal <your_email@gmail.com>
```

---

## 🗄️ Database Initialization & Data Import

The application automatically creates required MySQL tables (`Students`, `Tests`, `Test_Sections`, `Questions`, `Test_Results`, `Test_Result_Answers`, `Password_Reset_OTPs`) when starting up.

To import the question banks:

### Import Mechanical Engineering GATE Questions (.numbers)
```bash
node database/import_numbers.js
node database/fix_db_images.js
```

### Import Computer Science GATE Questions (CSV)
```bash
node database/import_cs.js
```

---

## ▶️ Running the Application

### Start server
```bash
npm start
```
*or directly:*
```bash
node server.js
```

### Development mode (with nodemon)
```bash
npm run dev
```

Open **[http://localhost:5000](http://localhost:5000)** in your web browser.

---

## 📡 API Endpoints Overview

### Authentication (`/api/auth`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new student account |
| `POST` | `/api/auth/login` | Student login with email & password |
| `POST` | `/api/auth/google` | Sign in / register via Google ID token |
| `POST` | `/api/auth/complete-profile` | Update roll number & branch |
| `POST` | `/api/auth/forgot-password` | Request password reset OTP via email |
| `POST` | `/api/auth/verify-otp` | Verify received OTP and get reset token |
| `POST` | `/api/auth/reset-password` | Set new password with reset token |

### Student User (`/api/users`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/users/profile` | Get current authenticated user profile |
| `GET` | `/api/users/dashboard` | Get student test history and available tests |

### Tests & Examination (`/api/tests`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/tests/:testId` | Fetch test questions & sections (answers masked) |
| `POST` | `/api/tests/:testId/submit` | Submit answers and receive instant grading |
| `GET` | `/api/tests/result/:resultId/review` | Fetch performance review & sectional analytics |

---

## 🔒 Security Best Practices
- Passwords are encrypted with **bcrypt** (salt factor 10).
- Questions served during an active exam **never expose the correct answer** payload to the client.
- JWT tokens expire in 2 hours and must be passed as `Bearer <token>` in the `Authorization` header.
- Static question assets are served under dedicated `/questions` routes.

---

## 📄 License
This project is open-source and available under the [ISC License](LICENSE).