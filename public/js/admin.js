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
let pages = { students: 1, allowlist: 1, attempts: 1, warnings: 1, questions: 1 };

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

    // Enter anywhere in the roster filters re-runs the query.
    document.querySelectorAll('#section-students .filter-grid input').forEach(el => {
        el.addEventListener('keydown', e => { if (e.key === 'Enter') loadStudents(1); });
    });

    // Allow-list panel: submit adds or saves, Enter in the search box searches.
    document.getElementById('allowForm')?.addEventListener('submit', submitAllowForm);
    document.getElementById('allowSearch')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); loadAllowlist(1); }
    });

    loadFilterOptions();

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
    students:  ['Students',  'Mock compliance across the whole roster'],
    allowlist: ['Allow list', 'Who is permitted to sign in to the portal'],
    coverage:  ['Mock coverage', 'Who has sat each mock exam, and who has not'],
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
        case 'students':  loadStudents(pages.students); break;
        case 'allowlist': loadAllowlist(pages.allowlist); break;
        case 'coverage':  loadCoverage(); break;
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

// ── Roster compliance ─────────────────────────────────────────────────────────

// Read once per call so the table, the pagination and the export links can
// never drift apart.
function rosterFilters() {
    const val = id => (document.getElementById(id)?.value || '').trim();
    const f = {
        search: val('fSearch'),
        exam_id: val('fExam'),
        programme: val('fProgramme'),
        discipline: val('fDiscipline'),
        status: val('fStatus'),
        target: val('fTarget'),
        min_attempts: val('fMinAttempts'),
        max_attempts: val('fMaxAttempts'),
        min_pct: val('fMinPct'),
        max_pct: val('fMaxPct'),
        from: val('fFrom'),
        to: val('fTo'),
        sort: val('fSort')
    };
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v !== '') params.append(k, v); });
    return params;
}

function resetRosterFilters() {
    ['fSearch', 'fExam', 'fProgramme', 'fDiscipline', 'fStatus',
     'fMinAttempts', 'fMaxAttempts', 'fMinPct', 'fMaxPct', 'fFrom', 'fTo']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const t = document.getElementById('fTarget'); if (t) t.value = '3';
    const s = document.getElementById('fSort'); if (s) s.value = 'attempts_asc';
    loadStudents(1);
}

function quickFilter(status) {
    const el = document.getElementById('fStatus');
    if (el) el.value = status;
    loadStudents(1);
}

async function loadFilterOptions() {
    try {
        const data = await apiFetch('/filter-options');
        const fill = (id, rows, label) => {
            const el = document.getElementById(id);
            if (!el || el.options.length > 1) return;
            rows.forEach(r => {
                const value = r.value !== undefined ? r.value : r.id;
                const text = r.value !== undefined
                    ? `${r.value} (${r.count})`
                    : r.title;
                el.innerHTML += `<option value="${escHtml(String(value))}">${escHtml(text)}</option>`;
            });
        };
        fill('fProgramme', data.programmes || []);
        fill('fDiscipline', data.disciplines || []);
        fill('fExam', data.exams || []);

        // The allow-list form offers the existing values as suggestions so new
        // rows keep spelling programmes and disciplines the same way.
        const suggest = (id, rows) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = rows
                .map(r => `<option value="${escHtml(String(r.value))}"></option>`).join('');
        };
        suggest('programmeOptions', data.programmes || []);
        suggest('disciplineOptions', data.disciplines || []);
    } catch (e) { /* dropdowns stay at "All" */ }
}

const ROSTER_LIMIT = 25;

async function loadStudents(page = 1) {
    pages.students = page;
    const params = rosterFilters();
    params.set('page', page);
    params.set('limit', ROSTER_LIMIT);

    const tbody = document.getElementById('studentsTableBody');
    tbody.innerHTML = `<tr><td colspan="11" class="loading-spinner"><div class="spinner"></div>Loading…</td></tr>`;

    try {
        const data = await apiFetch(`/students?${params}`);
        const sum = data.summary || {};

        document.getElementById('rosterTotal').textContent = fmt(sum.roster, '0');
        document.getElementById('rosterNeverIn').textContent = fmt(sum.never_logged_in, '0');
        document.getElementById('rosterNoMocks').textContent = fmt(sum.not_attempted, '0');
        document.getElementById('rosterMetTarget').textContent = fmt(sum.met_target, '0');
        document.getElementById('rosterAvgPct').textContent =
            sum.avg_best_pct === null || sum.avg_best_pct === undefined ? '—' : `${sum.avg_best_pct}%`;

        if (!data.students.length) {
            tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state">
                <h3>No students match</h3><p>Try widening the filters.</p></div></td></tr>`;
        } else {
            tbody.innerHTML = data.students.map(s => {
                // A roster member who has never signed in has no Students row, so
                // the drill-down is keyed by email instead of id.
                const key = s.student_id ? s.student_id : encodeURIComponent(s.email);
                const signedIn = s.student_id
                    ? '<span class="badge badge-neutral">Yes</span>'
                    : '<span class="badge badge-danger">No</span>';
                const mocks = Number(s.attempts) === 0
                    ? '<span class="badge badge-danger">0</span>'
                    : `<strong>${s.attempts}</strong>`;
                return `
                <tr>
                    <td>
                        <div class="name-cell">${escHtml(s.name)}</div>
                        <div class="sub-text">${escHtml(s.email)}</div>
                    </td>
                    <td>${fmt(s.roll_number)}</td>
                    <td>${fmt(s.programme)}</td>
                    <td>${s.discipline ? `<span class="badge badge-neutral">${escHtml(s.discipline)}</span>` : '—'}</td>
                    <td>${signedIn}</td>
                    <td>${mocks}</td>
                    <td>${fmt(s.exams_attempted, '0')}</td>
                    <td>${s.best_pct === null ? '—' : s.best_pct + '%'}</td>
                    <td>${s.avg_pct === null ? '—' : s.avg_pct + '%'}</td>
                    <td>${s.last_attempt_at ? fmtDate(s.last_attempt_at) : '<span class="muted">Never</span>'}</td>
                    <td>
                        <button type="button" class="btn btn-outline btn-sm"
                            onclick="openStudentDetail('${key}')">View</button>
                    </td>
                </tr>`;
            }).join('');
        }

        renderPagination('studentsPagination', data.total, ROSTER_LIMIT, page, loadStudents);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="11" class="loading-spinner">Error: ${escHtml(e.message)}</td></tr>`;
    }
}

// ── Allow list ────────────────────────────────────────────────────────────────

const ALLOW_LIMIT = 25;

// Set while an existing row is being edited; null means the form adds.
let editingAllowId = null;

function allowFormValues() {
    const val = id => (document.getElementById(id)?.value || '').trim();
    return {
        roll_number: val('allowRoll'),
        name: val('allowName'),
        email: val('allowEmail'),
        programme: val('allowProgramme'),
        discipline: val('allowDiscipline')
    };
}

function resetAllowForm() {
    editingAllowId = null;
    ['allowId', 'allowRoll', 'allowName', 'allowEmail', 'allowProgramme', 'allowDiscipline']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('allowFormTitle').textContent = 'Add a student';
    document.getElementById('allowSubmitBtn').textContent = 'Add to allow list';
    document.getElementById('allowCancelEdit').style.display = 'none';
}

async function submitAllowForm(e) {
    e.preventDefault();
    const body = allowFormValues();
    const btn = document.getElementById('allowSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        const editing = editingAllowId;
        const data = await apiFetch(editing ? `/allowlist/${editing}` : '/allowlist', {
            method: editing ? 'PUT' : 'POST',
            body: JSON.stringify(body)
        });
        showToast(data.message || 'Saved');
        resetAllowForm();
        // A new entry sorts to the top, so go back to page one to show it.
        loadAllowlist(editing ? pages.allowlist : 1);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        // A successful save clears editingAllowId, so the label follows the mode
        // the form is left in rather than the one it was submitted in.
        btn.disabled = false;
        btn.textContent = editingAllowId ? 'Save changes' : 'Add to allow list';
    }
}

// Rows carry their own data so editing needs no extra round trip.
let allowRows = [];

function editAllowed(id) {
    const row = allowRows.find(r => r.id === id);
    if (!row) return;
    editingAllowId = id;
    document.getElementById('allowId').value = id;
    document.getElementById('allowRoll').value = row.roll_number || '';
    document.getElementById('allowName').value = row.name || '';
    document.getElementById('allowEmail').value = row.email || '';
    document.getElementById('allowProgramme').value = row.programme || '';
    document.getElementById('allowDiscipline').value = row.discipline || '';
    document.getElementById('allowFormTitle').textContent = `Editing ${row.name}`;
    document.getElementById('allowSubmitBtn').textContent = 'Save changes';
    document.getElementById('allowCancelEdit').style.display = 'inline-flex';
    document.getElementById('allowForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function toggleAllowed(id, makeActive) {
    try {
        await apiFetch(`/allowlist/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: makeActive })
        });
        showToast(makeActive ? 'Access restored' : 'Access blocked');
        loadAllowlist(pages.allowlist);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function removeAllowed(id) {
    const row = allowRows.find(r => r.id === id);
    const who = row ? `${row.name} (${row.email})` : 'this entry';
    if (!confirm(`Remove ${who} from the allow list?\n\nThey will no longer be able to sign in. Past attempts and results are kept.`)) return;
    try {
        const data = await apiFetch(`/allowlist/${id}`, { method: 'DELETE' });
        showToast(data.message || 'Removed');
        loadAllowlist(pages.allowlist);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function loadAllowlist(page = 1) {
    pages.allowlist = page;
    const val = id => (document.getElementById(id)?.value || '').trim();
    const params = new URLSearchParams({ page, limit: ALLOW_LIMIT });
    if (val('allowSearch')) params.append('search', val('allowSearch'));
    if (val('allowStatus')) params.append('status', val('allowStatus'));

    const tbody = document.getElementById('allowTableBody');
    tbody.innerHTML = `<tr><td colspan="8" class="loading-spinner"><div class="spinner"></div>Loading…</td></tr>`;

    try {
        const data = await apiFetch(`/allowlist?${params}`);
        const sum = data.summary || {};
        document.getElementById('allowTotal').textContent = fmt(sum.total, '0');
        document.getElementById('allowActive').textContent = fmt(sum.active, '0');
        document.getElementById('allowInactive').textContent = fmt(sum.inactive, '0');
        document.getElementById('allowSignedIn').textContent = fmt(sum.signed_in, '0');

        allowRows = data.students || [];

        if (!allowRows.length) {
            tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
                <h3>Nobody on the allow list</h3>
                <p>Add a student with the form above.</p></div></td></tr>`;
        } else {
            tbody.innerHTML = allowRows.map(r => {
                const active = Number(r.is_active) === 1;
                return `
                <tr>
                    <td>
                        <div class="name-cell">${escHtml(r.name)}</div>
                        <div class="sub-text">${escHtml(r.email)}</div>
                    </td>
                    <td>${fmt(r.roll_number)}</td>
                    <td>${fmt(r.programme)}</td>
                    <td>${r.discipline ? `<span class="badge badge-neutral">${escHtml(r.discipline)}</span>` : '—'}</td>
                    <td>${active
                        ? '<span class="badge badge-neutral">Active</span>'
                        : '<span class="badge badge-danger">Blocked</span>'}</td>
                    <td>${Number(r.has_account)
                        ? '<span class="badge badge-neutral">Yes</span>'
                        : '<span class="muted">Not yet</span>'}</td>
                    <td>${fmtDate(r.created_at)}</td>
                    <td>
                        <div class="row-actions">
                            <button type="button" class="btn btn-outline btn-sm"
                                onclick="editAllowed(${r.id})">Edit</button>
                            <button type="button" class="btn btn-outline btn-sm"
                                onclick="toggleAllowed(${r.id}, ${!active})">${active ? 'Block' : 'Unblock'}</button>
                            <button type="button" class="btn btn-danger btn-sm"
                                onclick="removeAllowed(${r.id})">Remove</button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }

        renderPagination('allowPagination', data.total, ALLOW_LIMIT, page, loadAllowlist);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="loading-spinner">Error: ${escHtml(e.message)}</td></tr>`;
    }
}

// ── Coverage by exam ──────────────────────────────────────────────────────────

async function loadCoverage() {
    const tbody = document.getElementById('coverageTableBody');
    tbody.innerHTML = `<tr><td colspan="9" class="loading-spinner"><div class="spinner"></div>Loading…</td></tr>`;
    try {
        const data = await apiFetch('/exam-coverage');
        if (!data.exams.length) {
            tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
                <h3>No published mock exams</h3></div></td></tr>`;
            return;
        }
        tbody.innerHTML = data.exams.map(e => {
            const eligible = Number(e.eligible) || 0;
            const done = Number(e.students_attempted) || 0;
            const pct = eligible ? Math.round((done / eligible) * 1000) / 10 : 0;
            return `
            <tr>
                <td>
                    <div class="name-cell">${escHtml(e.title)}</div>
                    <div class="sub-text">${escHtml(e.code || '')} · ${e.total_questions} Q · ${e.duration_minutes} min</div>
                </td>
                <td>${eligible}</td>
                <td>${done}</td>
                <td>${Math.max(0, eligible - done)}</td>
                <td>
                    <div class="coverage-meter${done === 0 ? ' is-zero' : ''}">
                        <div class="meter-track"><div class="meter-fill" style="width:${pct}%"></div></div>
                        <span class="meter-value">${pct}%</span>
                    </div>
                </td>
                <td>${e.attempts}</td>
                <td>${e.avg_pct === null ? '—' : e.avg_pct + '%'}</td>
                <td>${e.last_attempt_at ? fmtDate(e.last_attempt_at) : '<span class="muted">Never</span>'}</td>
                <td>
                    <button type="button" class="btn btn-outline btn-sm"
                        onclick="drillIntoExam(${e.id})">Who is missing</button>
                </td>
            </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="loading-spinner">Error: ${escHtml(e.message)}</td></tr>`;
    }
}

// Jump from a coverage row straight to the students who have not sat that exam.
function drillIntoExam(examId) {
    // Set the filters before navigating: navigateTo() refreshes the section it
    // lands on, so doing it the other way round fires a throwaway query first.
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('fExam', String(examId));
    set('fStatus', 'not_attempted');
    pages.students = 1;

    if (currentSection === 'students') loadStudents(1);
    else navigateTo('students');
}

async function openStudentDetail(studentKey) {
    const panel = document.getElementById('studentDetail');
    const content = document.getElementById('studentDetailContent');
    panel.classList.add('open');
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Loading…</p></div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const data = await apiFetch(`/students/${studentKey}`);
        const s = data.student;
        document.getElementById('studentDetailTitle').textContent = s.name;

        const totalAttempts = data.examStats.reduce((n, e) => n + Number(e.attempts), 0);
        const examsSat = data.examStats.filter(e => Number(e.attempts) > 0).length;

        content.innerHTML = `
            <div class="detail-meta-grid">
                <div class="detail-meta-item"><div class="meta-label">Email</div><div class="meta-value" style="font-size:13px">${escHtml(s.email)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Roll No</div><div class="meta-value">${fmt(s.roll_number)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Programme</div><div class="meta-value" style="font-size:14px">${fmt(s.programme)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Discipline</div><div class="meta-value" style="font-size:14px">${fmt(s.discipline)}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Signed In</div><div class="meta-value" style="font-size:14px">${s.has_signed_in ? fmtDate(s.registered_at) : 'Never'}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Mocks Taken</div><div class="meta-value">${totalAttempts}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Exams Sat</div><div class="meta-value">${examsSat} / ${data.examStats.length}</div></div>
                <div class="detail-meta-item"><div class="meta-label">Violations</div><div class="meta-value">${data.violations.length}</div></div>
            </div>

            <h4 class="detail-subhead">Performance on each mock exam</h4>
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead><tr>
                        <th>Mock exam</th><th>Attempts</th><th>Best</th><th>Best %</th>
                        <th>Avg</th><th>Last attempt</th>
                    </tr></thead>
                    <tbody>
                        ${data.examStats.map(e => Number(e.attempts) === 0 ? `
                            <tr class="exam-stat-row-none">
                                <td>${escHtml(e.title)}</td>
                                <td><span class="badge badge-danger">Not attempted</span></td>
                                <td>—</td><td>—</td><td>—</td><td>—</td>
                            </tr>` : `
                            <tr>
                                <td>${escHtml(e.title)}</td>
                                <td><strong>${e.attempts}</strong></td>
                                <td>${fmtScore(e.best_score)} / ${fmtScore(e.max_score)}</td>
                                <td>${e.best_pct === null ? '—' : e.best_pct + '%'}</td>
                                <td>${fmtScore(e.avg_score)}</td>
                                <td>${fmtDate(e.last_attempt_at)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>

            <h4 class="detail-subhead">Every attempt</h4>
            ${data.attempts.length ? `
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead><tr>
                        <th>Exam</th><th>Score</th><th>Correct</th><th>Wrong</th>
                        <th>Time</th><th>Flags</th><th>Submitted</th>
                    </tr></thead>
                    <tbody>
                        ${data.attempts.map(a => `
                            <tr>
                                <td>${escHtml(a.title)}${a.kind === 'legacy' ? ' <span class="badge badge-neutral">Legacy</span>' : ''}</td>
                                <td><strong>${fmtScore(a.score)}</strong> / ${fmtScore(a.max_score)}</td>
                                <td>${fmt(a.total_correct)}</td>
                                <td>${fmt(a.total_wrong)}</td>
                                <td>${fmtTime(a.time_taken_seconds)}</td>
                                <td>${Number(a.auto_submitted) ? '<span class="badge badge-danger">Auto</span>' :
                                     (Number(a.violation_count) ? `<span class="badge badge-warning">${a.violation_count}</span>` : '—')}</td>
                                <td>${fmtDate(a.created_at)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>` : '<p class="muted" style="font-size:13px">No attempts recorded.</p>'}

            ${data.violations.length ? `
            <h4 class="detail-subhead">Violations</h4>
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead><tr><th>Exam</th><th>Type</th><th>Count</th><th>Auto-Submitted</th><th>Date</th></tr></thead>
                    <tbody>
                        ${data.violations.map(v => `
                            <tr>
                                <td>${escHtml(v.test_title)}</td>
                                <td><span class="badge badge-warning">${escHtml(v.violation_type)}</span></td>
                                <td>${v.violation_count}</td>
                                <td>${v.auto_submitted ? '<span class="badge badge-danger">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
                                <td>${fmtDate(v.created_at)}</td>
                            </tr>`).join('')}
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

// Downloads go through fetch rather than a plain link because the admin API is
// Bearer-authenticated; an <a href> would arrive without the token.
async function download(path, filename) {
    try {
        showToast('Preparing export…');
        const res = await fetch(`${API}${path}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`Export failed (${res.status})`);

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('Export downloaded');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

const extFor = format => (format === 'csv' ? 'csv' : 'xlsx');
const today = () => new Date().toISOString().slice(0, 10);

// The roster export carries the on-screen filters, so the sheet matches the view.
function exportRoster(format = 'xlsx') {
    const params = rosterFilters();
    params.set('format', format);
    download(`/export/roster?${params}`, `mock-compliance_${today()}.${extFor(format)}`);
}

// One row per student per exam — the sheet to hand to a department office.
function exportMatrix(format = 'xlsx') {
    const params = new URLSearchParams();
    ['fExam:exam_id', 'fProgramme:programme', 'fDiscipline:discipline'].forEach(pair => {
        const [id, key] = pair.split(':');
        const v = (document.getElementById(id)?.value || '').trim();
        if (v) params.append(key, v);
    });
    params.set('format', format);
    download(`/export/matrix?${params}`, `student-exam-matrix_${today()}.${extFor(format)}`);
}

function exportUrl(type, format = 'xlsx') {
    const params = new URLSearchParams({ format });
    download(`/export/${type}?${params}`, `${type}_${today()}.${extFor(format)}`);
}

// Kept so the existing Attempts / Warnings buttons keep working.
function exportData(type, format = 'xlsx') {
    exportUrl(type === 'students' ? 'roster' : type, format);
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
