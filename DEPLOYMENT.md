# CDS Test Portal — Deployment Guide

Everything needed to take this repository from a bare Ubuntu server to a running
mock-exam portal that students can log into. Follow the sections in order; each
one ends with a command that tells you whether that step actually worked.

Estimated time: **45–60 minutes** for a first deployment.

---

## Contents

1. [What you are deploying](#1-what-you-are-deploying)
2. [Before you start](#2-before-you-start)
3. [Server setup](#3-server-setup)
4. [Get the code and the question bank onto the server](#4-get-the-code-and-the-question-bank-onto-the-server)
5. [Database setup](#5-database-setup)
6. [Configuration (`.env`)](#6-configuration-env)
7. [Google OAuth setup](#7-google-oauth-setup)
8. [Load the student whitelist](#8-load-the-student-whitelist)
9. [Build the question bank and mock exams](#9-build-the-question-bank-and-mock-exams)
10. [Run the app under PM2](#10-run-the-app-under-pm2)
11. [Nginx reverse proxy and HTTPS](#11-nginx-reverse-proxy-and-https)
12. [Deploying under a subpath (`/mock`)](#12-deploying-under-a-subpath-mock)
13. [Verify the deployment](#13-verify-the-deployment)
14. [Day-to-day operations](#14-day-to-day-operations)
15. [Changing how the exams are built](#15-changing-how-the-exams-are-built)
16. [Backups](#16-backups)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. What you are deploying

A Node/Express app with a plain HTML/CSS/JS front end, backed by MySQL, serving
randomised mock exams built from a bank of ~8,900 pre-rendered question images.

**How a mock exam works.** Nine department exams are published (CE, CH, CSE, EC,
EE, GS, IN, ME, MT). A `Mock_Exams` row owns no questions — only a *blueprint*
saying how many questions to draw from which pools. The paper is drawn the
instant a student presses **Start**, and stored as that attempt's own 50
questions. Consequences worth knowing before you operate this:

- Two students starting the same exam get different papers.
- The same student re-attempting gets a different paper again.
- A student may re-attempt any exam an unlimited number of times.
- An interrupted attempt resumes exactly where it left off — same questions, same
  answers, and the clock keeps running against the server's own start time.
- Civil Engineering draws 7/7/6/6/6/6/6/6 across its eight topic sections. Every
  other department draws one flat block of 50.
- Marking is uniform: **+4 correct, −1 wrong, 0 unanswered**, so every paper is
  out of 200.

**Pieces on disk:**

| Path | What it is |
|---|---|
| `server.js` | Express entry point |
| `src/` | Controllers, routes, middleware, helpers |
| `public/` | The student-facing pages and the admin console |
| `database/import_question_bank.js` | One-shot importer: images + CSVs → MySQL |
| `database/exam_blueprints.js` | **The file you edit to change exam structure** |
| `questions/Question_Bank_Images/` | ~9,450 question PNGs + per-subject `metadata.csv` |

---

## 2. Before you start

Have these in hand:

- [ ] A server you can SSH into with `sudo` (Ubuntu 22.04 LTS assumed below).
- [ ] A domain or subdomain pointing at that server's IP (e.g. `mock.example.edu`).
- [ ] Ports 80 and 443 reachable from the internet.
- [ ] **At least 5 GB free disk.** The question images alone are ~1.5 GB; MySQL,
      Node modules and logs need the rest.
- [ ] At least 2 GB RAM.
- [ ] The `questions/Question_Bank_Images/` folder. It is large, so it may not be
      in your Git clone — see [section 4](#4-get-the-code-and-the-question-bank-onto-the-server).
- [ ] A Google account able to create an OAuth client for the portal's domain.
- [ ] A Gmail account with an **app password** for sending OTP e-mails.
- [ ] The student roster (roll number, name, e-mail, programme, discipline).

---

## 3. Server setup

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# MySQL, Nginx, and the tools used below
sudo apt install -y mysql-server nginx git unzip
sudo npm install -g pm2

node -v && npm -v && mysql --version && nginx -v
```

Secure MySQL and enable the firewall:

```bash
sudo mysql_secure_installation      # set a root password, answer Y to the rest

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

> Do **not** open port 5000. Node listens on it locally; Nginx is the only thing
> the internet talks to.

---

## 4. Get the code and the question bank onto the server

```bash
sudo mkdir -p /var/www && sudo chown $USER:$USER /var/www
cd /var/www
git clone <your-repository-url> cds-portal
cd cds-portal
npm install --omit=dev
```

### The question images

The bank is ~1.5 GB of PNGs, which is usually too large for Git. If
`questions/Question_Bank_Images/Question_Bank_Images/` did not come down with the
clone, copy it up from your machine:

```bash
# Run this on your LOCAL machine, not the server
cd /path/to/CDS_TestPortal
tar -czf question-bank.tar.gz questions/Question_Bank_Images
scp question-bank.tar.gz user@your-server:/var/www/cds-portal/

# Then, back on the SERVER
cd /var/www/cds-portal
tar -xzf question-bank.tar.gz && rm question-bank.tar.gz
```

Confirm the layout is right before going further — the importer needs this exact
nesting (the folder name repeats, which is intentional):

```bash
ls questions/Question_Bank_Images/Question_Bank_Images/
# expected: CE  CH  CSE  GATE_ESE_Papers  ME  MT  README.md

find questions/Question_Bank_Images -name '*.png' | wc -l
# expected: 9452
```

---

## 5. Database setup

```bash
sudo mysql -u root -p
```

```sql
CREATE DATABASE cds_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cds_user'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON cds_portal.* TO 'cds_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

You do **not** need to run any `.sql` file. Every table is created automatically
the first time the app or the importer connects.

---

## 6. Configuration (`.env`)

```bash
cd /var/www/cds-portal
cp .env.example .env
nano .env
```

```ini
PORT=5000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=cds_user
DB_PASSWORD=a-long-random-password
DB_NAME=cds_portal

# Signs student login tokens. Generate with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=paste-the-generated-value-here

# From the Google Cloud console — see section 7
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx

# Gmail app password (NOT the account password) for OTP mail
EMAIL_USER=cds.portal@example.edu
EMAIL_PASS=abcdefghijklmnop
EMAIL_FROM=CDS Test Portal <cds.portal@example.edu>

# Comma-separated e-mails allowed into /admin. Anyone not listed gets a 403,
# and the "Admin Console" button stays hidden for them.
ADMIN_EMAILS=coordinator@iitgn.ac.in,ta@iitgn.ac.in
```

Lock the file down — it holds your database password and mail credentials:

```bash
chmod 600 .env
```

> `.env` is gitignored. Keep a copy somewhere safe; it is not recoverable from
> the repository.

---

## 7. Google OAuth setup

Students sign in with Google only; there is no password sign-up.

1. Open <https://console.cloud.google.com/> → create or select a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **Internal** if your institution uses Google Workspace (strongly
     preferred — it restricts sign-in to your own domain automatically),
     otherwise **External**.
   - Fill in app name, support e-mail and developer contact.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorised JavaScript origins:** `https://mock.example.edu`
   - **Authorised redirect URIs:** `https://mock.example.edu`
4. Copy the client ID and secret into `.env`.
5. Put the same client ID into the login page:

```bash
grep -rn "GOOGLE_CLIENT_ID\|client_id" public/index.html
# replace the placeholder with your real client ID
```

> The portal additionally rejects any e-mail not ending in `@iitgn.ac.in` **and**
> not present in the `allowed_students` table. Google auth alone is not enough to
> get in.

---

## 8. Load the student whitelist

Only students in `allowed_students` can log in. Put your roster at
`database/students.csv`, then:

```bash
npm run seed:students
```

Check it landed:

```bash
mysql -u cds_user -p cds_portal -e "SELECT COUNT(*) FROM allowed_students;"
```

To add students later, append to the CSV and run the same command — it is an
upsert, so existing rows are updated rather than duplicated.

---

## 9. Build the question bank and mock exams

This is the step that turns the image folder into the nine mock exams students
see. **Dry-run first** — it validates everything and writes nothing:

```bash
npm run import:bank:dry
```

Expected output (abridged):

```
  CSE    534 rows →   508 usable   (paper: 50 questions across 1 section)
  ME    1010 rows →   987 usable   (paper: 50 questions across 1 section)
  ...
  CE    1233 rows →  1185 usable   (paper: 50 questions across 8 sections)
         · Structural Engineering     draw  7 from pool of   315
         ...
  Skipped 506 source rows:
         ·  256  MCQ answer key is a sentinel or ambiguous
         ·  200  question type MSQ not supported
         ·   27  NAT answer key could not be parsed as a number or range
         ·   23  flagged unusable by the bank

  8946 questions ready to import.
```

Those skips are expected and deliberate. The importer refuses to serve a question
whose answer key is `UNKNOWN`/`MTA`/ambiguous, whose image is missing, that the
bank's own `usable` column flags as broken, or that is multiple-correct (MSQ),
which the exam interface does not render. **If it reports "NOT ENOUGH QUESTIONS"
for any section, it aborts without writing anything** — fix the counts in
`database/exam_blueprints.js` and re-run.

Then do it for real:

```bash
npm run import:bank
```

The run ends with a summary read back out of the database. Confirm:

```bash
mysql -u cds_user -p cds_portal -e "
  SELECT department, COUNT(*) FROM Question_Bank GROUP BY department;
  SELECT code, title, total_questions, duration_minutes FROM Mock_Exams;"
```

You should see 9 departments, ~8,946 questions and 9 exams.

The importer is **idempotent** — re-running it updates existing rows in place,
keyed on each image's path. It never duplicates a question and never disturbs
attempts already in progress.

Other flags:

| Command | Effect |
|---|---|
| `npm run import:bank:dry` | Validate only; no database writes |
| `npm run import:bank` | Import / re-import everything |
| `npm run import:bank:reset` | Delete the existing bank rows first, then import |
| `node database/import_question_bank.js --only=CE,ME` | Just those departments |
| `node database/import_question_bank.js --verbose` | List every skipped row and why |

> `--reset` also deletes the attempt rows that reference those questions. Do not
> use it while an exam is running.

---

## 10. Run the app under PM2

```bash
cd /var/www/cds-portal
pm2 start server.js --name cds-portal
pm2 save
pm2 startup          # run the sudo command it prints, so PM2 survives reboot
```

```bash
pm2 status
pm2 logs cds-portal --lines 50
curl http://127.0.0.1:5000/api/health
# {"status":"ok","message":"CDS Portal API is running"}
```

---

## 11. Nginx reverse proxy and HTTPS

```bash
sudo nano /etc/nginx/sites-available/cds-portal
```

```nginx
server {
    listen 80;
    server_name mock.example.edu;

    # Question images are large PNGs. Raising this keeps exam pages snappy.
    client_max_body_size 20M;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # Question images never change once imported — let browsers keep them.
    location /questions/ {
        proxy_pass       http://127.0.0.1:5000;
        proxy_set_header Host $host;
        expires          30d;
        add_header       Cache-Control "public, immutable";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cds-portal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Then add HTTPS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mock.example.edu
sudo systemctl status certbot.timer     # auto-renewal
```

> Google sign-in will not work over plain HTTP. HTTPS is required, not optional.

---

## 12. Deploying under a subpath (`/mock`)

If the portal must live at `https://example.edu/mock/` rather than its own
subdomain, the app already supports it — both the API routes and the front-end
scripts detect a leading `/mock…` segment. Use this Nginx block instead:

```nginx
location /mock/ {
    proxy_pass         http://127.0.0.1:5000/mock/;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
```

Set the Google OAuth origin to `https://example.edu` and students then visit
`https://example.edu/mock/index.html`.

> One naming rule if you ever add pages: a page filename must **not** begin with
> `mock`. The subpath detector treats a leading `/mock…` path segment as a
> deployment prefix, so a page called `mock-something.html` would make the
> browser send its API calls to `/mock-something.html/api/…`. This is why the
> exam pages are named `exam-arena.html` and `exam-review.html`.

---

## 13. Verify the deployment

Work through this list before telling students the portal is live.

```bash
# 1. API is up
curl https://mock.example.edu/api/health

# 2. Static pages serve
for p in / /dashboard.html /exam-arena.html /exam-review.html /admin; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' https://mock.example.edu$p)  $p"
done   # all should be 200

# 3. A question image serves
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://mock.example.edu/questions/Question_Bank_Images/Question_Bank_Images/MT/MT/MT_2014_MT_001.png"

# 4. The bank and exams are in the database
mysql -u cds_user -p cds_portal -e "
  SELECT COUNT(*) AS questions FROM Question_Bank;
  SELECT COUNT(*) AS exams FROM Mock_Exams WHERE is_active = 1;"
```

Then in a browser:

- [ ] Sign in with a whitelisted Google account.
- [ ] The dashboard lists **9 mock exams**; the student's own department is first
      and badged "Your branch".
- [ ] Press **Start Test** → the rules dialog shows 50 questions / 90 minutes /
      correct section count.
- [ ] The exam opens fullscreen; the question image renders; the palette shows 50
      boxes; one countdown runs in the header.
- [ ] Choose an option — the palette box turns green and "Saved" appears under
      the submit button.
- [ ] Reload the page mid-exam — the same questions and answers come back and the
      clock has **not** reset.
- [ ] Submit → score out of 200, then **Review Answers** shows every question
      with your answer beside the correct one.
- [ ] Return to the dashboard and start the same exam again — the questions are
      different.
- [ ] As an `ADMIN_EMAILS` account, open `/admin` and confirm the attempt appears
      under Attempts with a "Mock" badge.

---

## 14. Day-to-day operations

```bash
pm2 status                       # is it running?
pm2 logs cds-portal              # live logs
pm2 logs cds-portal --err        # errors only
pm2 restart cds-portal           # after a config or code change
pm2 reload cds-portal            # zero-downtime restart
pm2 monit                        # CPU / memory
```

### Deploying an update

```bash
cd /var/www/cds-portal
git pull
npm install --omit=dev
npm run import:bank     # only if the bank or the blueprints changed
pm2 restart cds-portal
```

### Admin console

`https://mock.example.edu/admin`, restricted to `ADMIN_EMAILS`. It shows student
lists, every attempt (legacy and mock), per-question responses, proctoring
warnings and CSV exports. Changing `ADMIN_EMAILS` requires a `pm2 restart`.

### Proctoring

Switching tabs or leaving fullscreen triggers a warning on the first offence and
**auto-submits on the second**. These are logged in `Test_Violations` and shown on
the admin Warnings page.

---

## 15. Changing how the exams are built

Everything about a paper's shape lives in **`database/exam_blueprints.js`**. Edit
it, re-run the importer, restart. No other file needs to change.

**Change the number of questions or the duration:**

```js
{
    code: 'ME',
    durationMinutes: 120,                       // was 90
    sections: [
        { name: 'Mechanical Engineering', sourceSections: [], count: 65 }  // was 50
    ]
}
```

**Split a flat department into sections.** `sourceSections` lists the raw
`section` values from that subject's `metadata.csv` (`[]` means "all of them"):

```js
{
    code: 'ME',
    sections: [
        { name: 'General Aptitude',       sourceSections: ['GA'], count: 10 },
        { name: 'Mechanical Engineering', sourceSections: ['ME'], count: 40 }
    ]
}
```

**Change the marking scheme** (applies to every department):

```js
marking: { correct: 2, negative: 0.66, negativeForNat: 0 }
```

Then:

```bash
npm run import:bank:dry     # confirm every section can still be filled
npm run import:bank
pm2 restart cds-portal
```

Attempts already submitted keep the marks they were graded under; only new
attempts use the new scheme.

**Hide an exam without deleting anything:**

```sql
UPDATE Mock_Exams SET is_active = 0 WHERE code = 'GS';
```

**Retire a single bad question:**

```sql
UPDATE Question_Bank SET is_active = 0 WHERE image_filename = 'ME_2019_ME_042.png';
```

> Re-running the importer sets `is_active = 1` again for every row it imports.
> If you need a question retired permanently, remove it from the source
> `metadata.csv` as well.

---

## 16. Backups

The database holds everything irreplaceable (students, attempts, results). The
images can always be re-imported from the source folder.

```bash
sudo mkdir -p /var/backups/cds && sudo chown $USER:$USER /var/backups/cds
sudo nano /usr/local/bin/cds-backup.sh
```

```bash
#!/bin/bash
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M)
mysqldump -u cds_user -p"$DB_PASSWORD" cds_portal | gzip > /var/backups/cds/cds_portal-$STAMP.sql.gz
find /var/backups/cds -name '*.sql.gz' -mtime +30 -delete
```

```bash
sudo chmod +x /usr/local/bin/cds-backup.sh
sudo crontab -e
# 0 2 * * *  DB_PASSWORD='...' /usr/local/bin/cds-backup.sh
```

Restore:

```bash
gunzip < /var/backups/cds/cds_portal-YYYYMMDD-HHMM.sql.gz | mysql -u cds_user -p cds_portal
```

Also keep an off-server copy of `.env` and of `questions/Question_Bank_Images/`.

---

## 17. Troubleshooting

**"No mock exams have been published yet" on the dashboard**
The importer has not run, or ran against a different database.
```bash
mysql -u cds_user -p cds_portal -e "SELECT COUNT(*) FROM Mock_Exams;"
npm run import:bank
```

**Question images show a broken-image box**
The PNG folder is missing or in the wrong place. Check the nesting and the count:
```bash
ls questions/Question_Bank_Images/Question_Bank_Images/
find questions/Question_Bank_Images -name '*.png' | wc -l   # expect 9452
curl -I https://mock.example.edu/questions/Question_Bank_Images/Question_Bank_Images/MT/MT/MT_2014_MT_001.png
```

**"Not enough questions in the bank for section X"**
A blueprint asks for more questions than survive filtering. Run
`npm run import:bank:dry` — it prints each section's available pool — then lower
the `count` in `database/exam_blueprints.js` or widen its `sourceSections`.

**Students can't sign in**
Check all three gates: the e-mail ends in `@iitgn.ac.in`; a matching active row
exists in `allowed_students`; the Google client ID in `.env` matches the one in
`public/index.html` and the authorised origin is your exact HTTPS URL.
```bash
mysql -u cds_user -p cds_portal -e \
  "SELECT roll_number,email,is_active FROM allowed_students WHERE email='someone@iitgn.ac.in';"
```

**Admin console returns 403**
The signed-in e-mail isn't in `ADMIN_EMAILS`, or the app wasn't restarted after
that value changed. `pm2 restart cds-portal`.

**A student is stuck on an attempt they can't finish**
Each student has at most one open attempt per exam, and starting again resumes
it. To let them start fresh, discard the open one:
```sql
DELETE FROM Exam_Attempts WHERE student_id = <id> AND status = 'in_progress';
```
This cascades to that attempt's questions. Submitted attempts are untouched.

**502 Bad Gateway**
Node is down or not on port 5000.
```bash
pm2 status && pm2 logs cds-portal --err --lines 50
curl http://127.0.0.1:5000/api/health
```

**"Database connection failed" at startup**
Credentials or MySQL itself.
```bash
sudo systemctl status mysql
mysql -u cds_user -p cds_portal -e "SELECT 1;"
grep -E '^DB_' .env
```

**The timer shows 00:00 and the exam submits itself immediately**
The exam clock is authoritative on the server: it asks MySQL for
`UNIX_TIMESTAMP(started_at)`, which is time-zone independent, so a database
server in UTC and an app server in IST agree. If you see a zero clock anyway,
check in this order:

```bash
# 1. Is the server's own clock right? A wrong clock shows up here first.
timedatectl status
sudo timedatectl set-ntp true

# 2. Does a fresh attempt really start with a full clock?
mysql -u cds_user -p cds_portal -e "
  SELECT id, status, TIMESTAMPDIFF(MINUTE, started_at, NOW()) AS age_minutes
  FROM Exam_Attempts WHERE status = 'in_progress';"
```

Any `in_progress` row older than the exam duration has genuinely expired, and
because each student gets at most one open attempt per exam, pressing Start just
resumes that dead attempt. Clear them and the student can begin fresh:

```sql
DELETE FROM Exam_Attempts WHERE status = 'in_progress';
```

This cascades to those attempts' questions and leaves submitted attempts alone.

> Historical note: before this was fixed, the countdown was derived by parsing
> the `started_at` datetime string in Node. MySQL returns that string in *its*
> session time zone while the driver parses it in *Node's*, so a UTC database
> with an IST app made every attempt look 5.5 hours old the moment it was
> created — instant auto-submit. If you ever add new clock logic here, read the
> epoch column, never the datetime.

**Exam pages load but every API call 404s**
Almost always the subpath rule in [section 12](#12-deploying-under-a-subpath-mock):
a page whose filename starts with `mock` is mistaken for a `/mock` deployment
prefix. Rename the page.
