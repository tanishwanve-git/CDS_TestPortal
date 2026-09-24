/* =====================================================================
   admin.js — CDS Test Portal Admin Dashboard
   Full SPA logic: auth guard, navigation, API calls, rendering
   ===================================================================== */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const subpathMatch = window.location.pathname.match(/^(\/mock[^\/]*)/);
const API = subpathMatch ? `${subpathMatch[1]}/api/admin` : '/api/admin';
let token = null;
let adminUser = null;
let currentSection = 'overview';
let charts = {};
let pages = { students: 1, attempts: 1, warnings: 1, questions: 1 };

// Chart.js needs literal colour values, so read the three theme colours off the
// stylesheet rather than re-declaring a palette that could drift from base.css.
const CHART = (() => {
    const css = getComputedStyle(document.documentElement);
    const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
        surface: read('--surface', '#FFFFFF'),
        ink:     read('--ink', '#131316'),
        ink2:    read('--ink-2', '#5A5A61'),
        rule:    read('--rule', '#D3D3D8'),
        accent:  read('--accent', '#1A4FBF')
    };
})();

// ── Utility ───────────────────────────────────────────────────────────────────

function fmt(v, fallback = '—') {
    if (v === null || v === undefined || v === '') return fallback;
    return v;
}

// Scores arrive as MySQL DECIMALs (strings like "70.00") from the mock tables and
// as plain numbers from the legacy ones; render both the same way.
function fmtScore(v, fallback = '—') {
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function fmtTime(sec) {
    if (!sec && sec !== 0) return '—';
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}m ${s}s`;
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, max = 80) {
    if (!str) return '—';
    return str.length > max ? str.slice(0, max) + '…' : str;
}

async function apiFetch(endpoint, opts = {}) {
    const res = await fetch(`${API}${endpoint}`, {
        ...opts,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts.headers || {})
        }
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw Object.assign(new Error(data.message || 'API error'), { status: res.status });
    }
    return res.json();
}

function showToast(msg, type = 'success') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 4000);
}

// ── Auth Guard ────────────────────────────────────────────────────────────────

async function initAuth() {
    token = localStorage.getItem('token');
    const userRaw = localStorage.getItem('user');

    if (!token) {
        return showAccessWall('Admin sign-in required',
            'You must be signed in with an admin account to open this page.',
            true);
    }

    try {
        // Validate token by hitting a protected endpoint
        const data = await apiFetch('/overview');

        adminUser = userRaw ? JSON.parse(userRaw) : { name: 'Admin', email: '' };
        setupApp();
        loadOverview(data); // pre-load with data we already fetched
    } catch (err) {
        if (err.status === 403) {
            return showAccessWall('Access denied',
                'Your account does not have admin privileges. Contact the portal administrator.',
                true);
        }
        if (err.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            return showAccessWall('Session expired',
                'Your session has expired. Please sign in again.',
                true);
        }
        return showAccessWall('Connection error',
            `Could not connect to the server: ${err.message}`, false);
    }
}

function showAccessWall(title, msg, showBtn) {
    document.getElementById('accessTitle').textContent = title;
    document.getElementById('accessMsg').textContent = msg;
    if (showBtn) {
        const btn = document.getElementById('accessAction');
        btn.style.display = 'inline-flex';
    }
    document.getElementById('accessWall').style.display = 'flex';
    document.getElementById('adminApp').style.display = 'none';
}

function setupApp() {
    document.getElementById('accessWall').style.display = 'none';
    document.getElementById('adminApp').style.display = 'flex';

    // Fill admin info in sidebar
    const name = adminUser?.name || 'Admin';
    document.getElementById('adminNameSidebar').textContent = name;
    document.getElementById('adminAvatarSidebar').textContent = name.charAt(0).toUpperCase();

    // Sidebar nav click
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const sec = item.dataset.section;
            navigateTo(sec);
        });
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'index.html';
    });

    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        refreshCurrentSection();
    });

    // Filter enter key
    document.getElementById('studentSearch')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') loadStudents(1);
    });

    // Below 960px the sidebar is off-canvas, so the topbar carries its toggle.
    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
        document.getElementById('adminSidebar').classList.toggle('open');
    });

    // Load tests into dropdown filters
    loadTestsDropdown();
}

// ── Navigation ────────────────────────────────────────────────────────────────

const sectionTitles = {
    overview:  ['Overview',  'Real-time portal analytics'],
    students:  ['Students',  'Manage and filter registered students'],
    tests:     ['Tests',     'Test-level statistics and details'],
    attempts:  ['Attempts',  'Per-student test attempt history'],
    warnings:  ['Warnings',  'Proctor violation monitoring'],
    questions: ['Questions', 'Question-level accuracy and difficulty analysis'],
};

function navigateTo(sec) {
    if (currentSection === sec) return;
    currentSection = sec;

    // Picking a destination closes the off-canvas sidebar on narrow screens
    document.getElementById('adminSidebar')?.classList.remove('open');

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.section === sec);
    });

    // Update page sections
    document.querySelectorAll('.admin-section').forEach(s => {
        s.classList.toggle('active', s.id === `section-${sec}`);
    });

    // Update topbar
    const [title, subtitle] = sectionTitles[sec] || [sec, ''];
    document.getElementById('topbarTitle').textContent = title;
    document.getElementById('topbarSubtitle').textContent = subtitle;

    refreshCurrentSection();
}

function refreshCurrentSection() {
    switch (currentSection) {
        case 'overview':  fetchAndLoadOverview(); break;
        case 'students':  loadStudents(pages.students); loadBranchDist(); break;
        case 'tests':     loadTests(); break;
        case 'attempts':  loadAttempts(pages.attempts); break;
        case 'warnings':  loadWarnings(pages.warnings); break;
        case 'questions': loadQuestions(pages.questions); break;
    }
}

// ── Tests Dropdown (shared across filters) ────────────────────────────────────

async function loadTestsDropdown() {
    try {
        const data = await apiFetch('/tests-list');
        const selectors = [
            '#attemptsTestFilter', '#warningsTestFilter', '#questionsTestFilter'
        ];
        selectors.forEach(sel => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.innerHTML = '<option value="">All Tests</option>';
            data.tests.forEach(t => {
                el.innerHTML += `<option value="${t.id}">${escHtml(t.title)}</option>`;
            });
        });
    } catch (e) { /* silently ignore */ }
}

// ── Overview ──────────────────────────────────────────────────────────────────

async function fetchAndLoadOverview() {
    try {
        const data = await apiFetch('/overview');
        loadOverview(data);
    } catch (e) {
        showToast('Failed to load overview: ' + e.message, 'error');
    }
}

function loadOverview(data) {
    const s = data.stats;
    document.getElementById('statStudents').textContent  = s.total_students;
    document.getElementById('statTests').textContent     = s.total_tests;
    document.getElementById('statAttempts').textContent  = s.total_attempts;
    document.getElementById('statAvgScore').textContent  = fmt(s.avg_score, '0');
    document.getElementById('statMaxScore').textContent  = fmt(s.max_score, '0');
    document.getElementById('statViolations').textContent = s.total_violations;

    // Recent Attempts table
    const tbody = document.getElementById('recentAttemptsBody');
    if (!data.recentAttempts.length) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><h3>No attempts yet</h3></div></td></tr>`;
    } else {
        tbody.innerHTML = data.recentAttempts.map(r => `
            <tr>
                <td>
                    <div class="name-cell">${escHtml(r.student_name)}</div>
                    <div class="sub-text">${escHtml(r.roll_number || '—')}</div>
                </td>
                <td>
                    ${escHtml(r.test_title)}
                    ${r.kind === 'mock' ? '<span class="badge badge-neutral" style="margin-left:6px">Mock</span>' : ''}
                </td>
                <td><strong>${fmtScore(r.score)}</strong></td>
                <td>${fmtDate(r.created_at)}</td>
            </tr>
        `).join('');
    }

    // Charts
    const labels  = data.attemptsPerTest.map(t => t.title);
    const counts  = data.attemptsPerTest.map(t => t.attempt_count);
    const avgs    = data.attemptsPerTest.map(t => parseFloat(t.avg_score) || 0);

    buildBarChart('attemptsChart', labels, counts, 'Attempts', CHART.accent);
    buildBarChart('avgScoreChart', labels, avgs,   'Avg Score', CHART.ink);
}

function buildBarChart(id, labels, data, label, color) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;

    if (charts[id]) charts[id].destroy();

    charts[id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label,
                data,
                backgroundColor: color,
                borderColor: color,
                borderWidth: 0,
                borderRadius: 0,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: CHART.ink,
                    borderColor: CHART.ink,
                    borderWidth: 0,
                    titleColor: CHART.surface,
                    bodyColor: CHART.surface,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    ticks: { color: CHART.ink2, font: { size: 11 } },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: CHART.ink2, font: { size: 11 } },
                    grid: { color: CHART.rule }
                }
            }
        }
    });
}

// ── Students ──────────────────────────────────────────────────────────────────

async function loadStudents(page = 1) {
    pages.students = page;
    const search = document.getElementById('studentSearch').value.trim();
    const branch = document.getElementById('studentBranch').value;
    const params = new URLSearchParams({ page, limit: 20 });
    if (search) params.append('search', search);
    if (branch) params.append('branch', branch);

    const tbody = document.getElementById('studentsTableBody');
    tbody.innerHTML = `<tr><td colspan="8" class="loading-spinner"><div class="spinner"></div></td></tr>`;

    try {
        const data = await apiFetch(`/students?${params}`);

        // Populate branch filter
        const branchSel = document.getElementById('studentBranch');
        if (branchSel.options.length <= 1 && data.branchDist) {
            data.branchDist.forEach(b => {
                if (b.branch) branchSel.innerHTML += `<option value="${escHtml(b.branch)}">${escHtml(b.branch)}</option>`;
            });
        }

        if (!data.students.length) {
            tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><h3>No students found</h3><p>Try different filters.</p></div></td></tr>`;
        } else {
            tbody.innerHTML = data.students.map(s => `
                <tr>
                    <td>
                        <div class="name-cell">${escHtml(s.name)}</div>
                        <div class="sub-text">${escHtml(s.email)}</div>
                    </td>
                    <td>${fmt(s.roll_number)}</td>
                    <td>${s.branch ? `<span class="badge badge-neutral">${escHtml(s.branch)}</span>` : '—'}</td>
                    <td>${s.tests_attempted}</td>
                    <td>${fmt(s.avg_score, '—')}</td>
                    <td>${fmt(s.best_score, '—')}</td>
                    <td>${fmtDate(s.created_at)}</td>
                    <td>
                        <button type="button" class="btn btn-outline btn-sm" title="View details"
                            onclick="openStudentDetail(${s.id})">View</button>
                    </td>
                </tr>
            `).join('');
        }

        renderPagination('studentsPagination', data.total, 20, page, loadStudents);
        loadBranchDist(data.branchDist);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="loading-spinner">Error: ${escHtml(e.message)}</td></tr>`;
    }
}

function loadBranchDist(dist) {
    if (!dist) return;
    const total = dist.reduce((s, b) => s + b.count, 0);
    const container = document.getElementById('branchDistContainer');
    if (!dist.length) {
        container.innerHTML = '<p class="muted">No data available.</p>';
        return;
    }
    container.innerHTML = dist.map(b => `
        <div class="branch-bar">
            <span class="branch-name">${escHtml(b.branch || 'Unknown')}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width:${Math.round((b.count / total) * 100)}%"></div>
            </div>
            <span class="bar-count">${b.count}</span>
        </div>
    `).join('');
}

async function openStudentDetail(studentId) {
    const panel = document.getElementById('studentDetail');
    const content = document.getElementById('studentDetailContent');
    panel.classList.add('open');
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Loading…</p></div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const data = await apiFetch(`/students/${studentId}`);
        const s = data.student;
        document.getElementById('studentDetailTitle').textContent = `${s.name} — Details`;

        content.innerHTML = `
            <div class="detail-meta-grid">
                <div class="detail-meta-item"><div class="meta-label">Email</div><div class="meta-value" style="font-size:14px">${escHtml(s.email)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Roll No</div><div class="meta-value">${fmt(s.roll_number)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Branch</div><div class="meta-value">${fmt(s.branch)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Tests Taken</div><div class="meta-value">${data.attempts.length}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Violations</div><div class="meta-value">${data.violations.length}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Registered</div><div class="meta-value" style="font-size:13px">${fmtDate(s.created_at)}</div></div>
            </div>

            <h4 class="detail-subhead">Attempt History</h4>
            ${data.attempts.length ? `
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead><tr><th>Test</th><th>Score</th><th>Questions</th><th>Time</th><th>Date</th></tr></thead>
                    <tbody>
                        ${data.attempts.map(a => `
                            <tr>
                                <td>${escHtml(a.title)}</td>
                                <td><strong>${a.score}</strong></td>
                                <td>${a.total_questions}</td>
                                <td>${fmtTime(a.time_taken_seconds)}</td>
                                <td>${fmtDate(a.created_at)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>` : '<p class="muted" style="font-size:13px">No attempts recorded.</p>'}

            ${data.violations.length ? `
            <h4 class="detail-subhead">Violations</h4>
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead><tr><th>Test</th><th>Type</th><th>Count</th><th>Auto-Submitted</th><th>Date</th></tr></thead>
                    <tbody>
                        ${data.violations.map(v => `
                            <tr>
                                <td>${escHtml(v.test_title)}</td>
                                <td><span class="badge badge-warning">${escHtml(v.violation_type)}</span></td>
                                <td>${v.violation_count}</td>
                                <td>${v.auto_submitted ? '<span class="badge badge-danger">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
                                <td>${fmtDate(v.created_at)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>` : ''}
        `;
    } catch (e) {
        content.innerHTML = `<p class="notice notice-alert">Error loading student: ${escHtml(e.message)}</p>`;
    }
}

function closeStudentDetail() {
    document.getElementById('studentDetail').classList.remove('open');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function loadTests() {
    const tbody = document.getElementById('testsTableBody');
    tbody.innerHTML = `<tr><td colspan="8" class="loading-spinner"><div class="spinner"></div></td></tr>`;

    try {
        const data = await apiFetch('/tests');
        if (!data.tests.length) {
            tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><h3>No tests found</h3></div></td></tr>`;
        } else {
            tbody.innerHTML = data.tests.map(t => `
                <tr>
                    <td>
                        <div class="name-cell">${escHtml(t.title)}</div>
                        ${t.kind === 'mock' ? `<div class="sub-text">Mock exam · ${t.total_questions} drawn per attempt</div>` : ''}
                    </td>
                    <td>${t.duration_minutes} min</td>
                    <td title="${t.kind === 'mock' ? 'Questions in the bank this exam draws from' : 'Questions in this fixed paper'}">${t.question_count}</td>
                    <td>${t.attempt_count}</td>
                    <td>${t.unique_students}</td>
                    <td>${fmtScore(t.avg_score)}</td>
                    <td>${fmtScore(t.max_score)} / ${fmtScore(t.min_score)}</td>
                    <td>${fmtDate(t.created_at)}</td>
                </tr>
            `).join('');
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="loading-spinner">Error: ${escHtml(e.message)}</td></tr>`;
    }
}

// ── Attempts ──────────────────────────────────────────────────────────────────

async function loadAttempts(page = 1) {
    pages.attempts = page;
    const test_id = document.getElementById('attemptsTestFilter').value;
    const params = new URLSearchParams({ page, limit: 20 });
    if (test_id) params.append('test_id', test_id);

    const tbody = document.getElementById('attemptsTableBody');
    tbody.innerHTML = `<tr><td colspan="9" class="loading-spinner"><div class="spinner"></div></td></tr>`;

    try {
        const data = await apiFetch(`/attempts?${params}`);

        if (!data.attempts.length) {
            tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><h3>No attempts found</h3></div></td></tr>`;
        } else {
            tbody.innerHTML = data.attempts.map(a => `
                <tr>
                    <td>
                        <div class="name-cell">${escHtml(a.student_name)}</div>
                        <div class="sub-text">${escHtml(a.roll_number || '—')}</div>
                    </td>
                    <td>${fmt(a.roll_number)}</td>
                    <td>${a.branch ? `<span class="badge badge-neutral">${escHtml(a.branch)}</span>` : '—'}</td>
                    <td>
                        ${escHtml(a.test_title)}
                        ${a.kind === 'mock' ? '<span class="badge badge-neutral" style="margin-left:6px">Mock</span>' : ''}
                    </td>
                    <td><strong>${fmtScore(a.score)}</strong> / ${fmtScore(a.max_score)}</td>
                    <td>${fmtTime(a.time_taken_seconds)}</td>
                    <td>${a.has_violation ? '<span class="badge badge-danger">Yes</span>' : '<span class="badge badge-neutral">—</span>'}</td>
                    <td>${fmtDate(a.created_at)}</td>
                    <td>
                        <button type="button" class="btn btn-outline btn-sm" title="View attempt detail"
                            onclick="openAttemptDetail(${a.id}, '${a.kind || 'legacy'}')">View</button>
                    </td>
                </tr>
            `).join('');
        }

        renderPagination('attemptsPagination', data.total, 20, page, loadAttempts);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="loading-spinner">Error: ${escHtml(e.message)}</td></tr>`;
    }
}

async function openAttemptDetail(resultId, kind = 'legacy') {
    const panel = document.getElementById('attemptDetail');
    const content = document.getElementById('attemptDetailContent');
    panel.classList.add('open');
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Loading question-level responses…</p></div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const data = await apiFetch(`/attempts/${resultId}?kind=${encodeURIComponent(kind)}`);
        const r = data.result;

        const correctCount = data.questions.filter(q => q.is_correct === true).length;
        const wrongCount   = data.questions.filter(q => q.is_correct === false).length;
        const skippedCount = data.questions.filter(q => q.is_skipped).length;

        content.innerHTML = `
            <div class="detail-meta-grid">
                <div class="detail-meta-item"><div class="meta-label">Student</div><div class="meta-value" style="font-size:15px">${escHtml(r.student_name)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Roll No</div><div class="meta-value">${fmt(r.roll_number)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Test</div><div class="meta-value" style="font-size:13px">${escHtml(r.test_title)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Score</div><div class="meta-value">${r.score}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Correct</div><div class="meta-value">${correctCount}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Wrong</div><div class="meta-value">${wrongCount}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Skipped</div><div class="meta-value">${skippedCount}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Time Taken</div><div class="meta-value">${fmtTime(r.time_taken_seconds)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Submitted</div><div class="meta-value" style="font-size:12px">${fmtDate(r.created_at)}</div></div>
            </div>

            <h4 class="detail-subhead">Question Responses</h4>
            ${data.questions.map((q, i) => {
                const cls = q.is_skipped ? 'skipped' : (q.is_correct ? 'correct' : 'wrong');
                let optLabel = q.student_answer || 'Not Answered';
                if (q.options && q.student_answer) {
                    try {
                        const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
                        if (typeof opts === 'object' && opts[q.student_answer]) {
                            optLabel = `${q.student_answer}: ${opts[q.student_answer]}`;
                        }
                    } catch(e) {}
                }
                return `
                    <div class="q-answer-row ${cls}">
                        <div class="q-status-dot"></div>
                        <div class="q-text">
                            <strong>Q${i+1}. ${escHtml(truncate(q.question_text, 120))}</strong>
                            ${q.image_url ? ` <a href="${escHtml(q.image_url)}" target="_blank" rel="noopener">view image</a>` : ''}
                            <div style="margin-top:4px">
                                Answered <span class="given">${escHtml(optLabel)}</span>
                                ${!q.is_skipped && !q.is_correct ? ` · correct: <strong>${escHtml(q.correct_answer)}</strong>` : ''}
                            </div>
                        </div>
                        <div class="q-answer-meta">
                            <span>${escHtml(q.section_name || '—')}</span>
                            <span>+${q.marks}</span>
                        </div>
                    </div>`;
            }).join('')}
        `;
    } catch (e) {
        content.innerHTML = `<p class="notice notice-alert">Error loading attempt: ${escHtml(e.message)}</p>`;
    }
}

function closeAttemptDetail() {
    document.getElementById('attemptDetail').classList.remove('open');
}

// ── Warnings ──────────────────────────────────────────────────────────────────

async function loadWarnings(page = 1) {
    pages.warnings = page;
    const test_id     = document.getElementById('warningsTestFilter').value;
    const auto_sub    = document.getElementById('warningsAutoFilter').value;
    const params = new URLSearchParams({ page, limit: 20 });
    if (test_id)   params.append('test_id', test_id);
    if (auto_sub)  params.append('auto_submitted', auto_sub);

    const tbody = document.getElementById('warningsTableBody');
    tbody.innerHTML = `<tr><td colspan="8" class="loading-spinner"><div class="spinner"></div></td></tr>`;

    try {
        const data = await apiFetch(`/warnings?${params}`);

        // Update summary stat cards
        document.getElementById('warnTotalViolations').textContent = data.summary.total_violations;
        document.getElementById('warnAutoSubmitted').textContent   = data.summary.auto_submitted_count;
        document.getElementById('warnFiltered').textContent        = data.total;

        if (!data.violations.length) {
            tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><h3>No violations found</h3><p>No proctoring events match the current filters.</p></div></td></tr>`;
        } else {
            tbody.innerHTML = data.violations.map(v => `
                <tr>
                    <td>
                        <div class="name-cell">${escHtml(v.student_name)}</div>
                        <div class="sub-text">${escHtml(v.email)}</div>
                    </td>
                    <td>${fmt(v.roll_number)}</td>
                    <td>${v.branch ? `<span class="badge badge-neutral">${escHtml(v.branch)}</span>` : '—'}</td>
                    <td>${escHtml(v.test_title)}</td>
                    <td><span class="badge badge-warning">${escHtml(v.violation_type)}</span></td>
                    <td><strong>${v.violation_count}</strong></td>
                    <td>${v.auto_submitted ? '<span class="badge badge-danger">Auto-Submitted</span>' : '<span class="badge badge-neutral">Manual</span>'}</td>
                    <td>${fmtDate(v.created_at)}</td>
                </tr>
            `).join('');
        }

        renderPagination('warningsPagination', data.total, 20, page, loadWarnings);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="loading-spinner">Error: ${escHtml(e.message)}</td></tr>`;
    }
}

// ── Questions ─────────────────────────────────────────────────────────────────

async function loadQuestions(page = 1) {
    pages.questions = page;
    const test_id = document.getElementById('questionsTestFilter').value;
    const params = new URLSearchParams({ page, limit: 30 });
    if (test_id) params.append('test_id', test_id);

    const tbody = document.getElementById('questionsTableBody');
    tbody.innerHTML = `<tr><td colspan="10" class="loading-spinner"><div class="spinner"></div></td></tr>`;

    try {
        const data = await apiFetch(`/questions?${params}`);

        if (!data.questions.length) {
            tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><h3>No questions found</h3></div></td></tr>`;
        } else {
            tbody.innerHTML = data.questions.map((q, i) => {
                const diffClass = {
                    easy: 'diff-easy', medium: 'diff-medium',
                    hard: 'diff-hard', unattempted: 'diff-na'
                }[q.difficulty] || 'diff-na';

                return `
                    <tr>
                        <td class="muted">${((page - 1) * 30) + i + 1}</td>
                        <td style="max-width:280px">
                            <span title="${escHtml(q.question_text)}">${escHtml(truncate(q.question_text, 90))}</span>
                        </td>
                        <td>${escHtml(q.test_title)}</td>
                        <td>${fmt(q.section_name)}</td>
                        <td><span class="badge badge-accent">${q.question_type}</span></td>
                        <td>+${q.marks}</td>
                        <td>${q.attempt_count}</td>
                        <td>${q.correct_count}</td>
                        <td>${q.accuracy_pct !== null ? q.accuracy_pct + '%' : '—'}</td>
                        <td><span class="${diffClass}">${q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1)}</span></td>
                    </tr>
                `;
            }).join('');
        }

        renderPagination('questionsPagination', data.total, 30, page, loadQuestions);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="10" class="loading-spinner">Error: ${escHtml(e.message)}</td></tr>`;
    }
}

// ── CSV Export ────────────────────────────────────────────────────────────────

async function exportData(type) {
    try {
        showToast(`Preparing ${type} export…`);
        const res = await fetch(`${API}/export/${type}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Export failed');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${type}_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`${type} exported successfully!`);
    } catch (e) {
        showToast('Export failed: ' + e.message, 'error');
    }
}

// ── Pagination ────────────────────────────────────────────────────────────────

function renderPagination(containerId, total, limit, currentPage, loadFn) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    const start = (currentPage - 1) * limit + 1;
    const end   = Math.min(currentPage * limit, total);

    let html = `<span class="pagination-info">Showing ${start}–${end} of ${total}</span>`;

    html += `<button class="page-btn" onclick="${loadFn.name}(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>`;

    // Window of pages to show
    const window = 2;
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || (p >= currentPage - window && p <= currentPage + window)) {
            html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="${loadFn.name}(${p})">${p}</button>`;
        } else if (p === currentPage - window - 1 || p === currentPage + window + 1) {
            html += `<span class="page-btn" style="pointer-events:none;border-color:transparent;">…</span>`;
        }
    }

    html += `<button class="page-btn" onclick="${loadFn.name}(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>`;

    container.innerHTML = html;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initAuth);
