// dashboard.js - Student Dashboard Logic

// Automatically detect if running under /mock (module scope so all functions can use it)
const subpathMatch = window.location.pathname.match(/^(\/mock[^\/]*)/);
const BASE_PATH = subpathMatch ? subpathMatch[1] : '';
const API_BASE = `${BASE_PATH}/api`;

let allMockExams = [];     // cache for the rules modal
let allAvailableTests = []; // legacy fixed-paper tests

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = `${BASE_PATH}/index.html`;
        return;
    }

    // ---------- Elements ----------
    const studentNameEl = document.getElementById('studentName');
    const userNameHeader = document.getElementById('userNameHeader');
    const avatarEl = document.getElementById('avatarLetter');
    const mockGrid = document.getElementById('mockExamsGrid');
    const availableGrid = document.getElementById('availableTestsGrid');
    const legacySection = document.getElementById('legacyTestsSection');
    const historyBody = document.getElementById('scoresTableBody');
    const testsTakenEl = document.getElementById('testsTaken');
    const testsRemainingEl = document.getElementById('testsRemaining');

    // ---------- Profile from localStorage (instant render) ----------
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const displayName = user.name || 'Student';

    if (studentNameEl) studentNameEl.innerText = displayName;
    if (userNameHeader) userNameHeader.innerText = displayName;
    if (avatarEl) avatarEl.innerText = displayName.charAt(0).toUpperCase();

    const rollEl = document.getElementById('studentRoll');
    const branchEl = document.getElementById('studentBranch');
    const programmeEl = document.getElementById('studentProgramme');
    if (rollEl) rollEl.innerText = user.roll_number ? `Roll no. ${user.roll_number}` : 'Roll no. —';
    if (branchEl) branchEl.innerText = user.branch || user.discipline || '—';
    if (programmeEl) {
        const prog = user.programme || '';
        if (prog) {
            programmeEl.innerText = prog;
            programmeEl.style.display = 'inline-flex';
        } else {
            programmeEl.style.display = 'none';
        }
    }

    // ---------- Logout ----------
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.clear();
            window.location.href = `${BASE_PATH}/index.html`;
        });
    }

    // ---------- Admin Console Button Check ----------
    // Silently probe the admin API — if the JWT is whitelisted as admin,
    // reveal the "Admin console" button in the header.
    const adminConsoleBtn = document.getElementById('adminConsoleBtn');
    if (adminConsoleBtn) {
        fetch(`${API_BASE}/admin/overview`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(res => {
            if (res.ok) {
                adminConsoleBtn.style.display = 'inline-flex';
                adminConsoleBtn.addEventListener('click', () => {
                    window.location.href = `${BASE_PATH}/admin`;
                });
            }
        }).catch(() => {});
    }

    // ---------- Fetch Dashboard Data ----------
    try {
        const authHeaders = { 'Authorization': `Bearer ${token}` };

        const [dashRes, mockRes] = await Promise.all([
            fetch(`${API_BASE}/users/dashboard`, { headers: authHeaders }),
            fetch(`${API_BASE}/tests/mock`, { headers: authHeaders })
        ]);

        if (!dashRes.ok) throw new Error(dashRes.status);

        const { history, availableTests, mockHistory = [] } = await dashRes.json();
        allAvailableTests = availableTests;

        // The mock endpoint is new; a portal running an older server still renders.
        allMockExams = mockRes.ok ? (await mockRes.json()).exams : [];

        // ---------- Stats ----------
        if (testsTakenEl) testsTakenEl.innerText = history.length + mockHistory.length;
        if (testsRemainingEl) testsRemainingEl.innerText = allMockExams.length;

        // ---------- Mock exam cards ----------
        if (mockGrid) {
            mockGrid.innerHTML = allMockExams.length === 0
                ? `<div class="panel"><div class="empty-state">
                       <h3>No mock exams published yet</h3>
                       <p>An administrator needs to import the question bank.</p>
                   </div></div>`
                : allMockExams.map(renderMockCard).join('');
        }

        // ---------- Legacy fixed tests (only shown if any still exist) ----------
        if (availableGrid && legacySection) {
            if (availableTests.length) {
                legacySection.style.display = '';
                availableGrid.innerHTML = availableTests.map(test => `
                    <div class="exam-card">
                        <div class="exam-card-body">
                            <div class="exam-title"><h3>${escapeHtml(test.title)}</h3></div>
                            <div class="exam-spec">${test.total_questions} questions &middot; ${test.duration_minutes} min</div>
                        </div>
                        <div class="exam-card-foot">
                            <button type="button" class="btn btn-primary btn-block" onclick="startTest(${test.id})">Start test</button>
                        </div>
                    </div>
                `).join('');
            } else {
                legacySection.style.display = 'none';
            }
        }

        // ---------- Combined score history, newest first ----------
        if (historyBody) {
            const rows = [
                ...mockHistory.map(r => ({
                    kind: 'mock',
                    id: r.attempt_id,
                    title: r.title,
                    date: r.submitted_at,
                    score: Number(r.score),
                    maxScore: Number(r.max_score),
                    correct: r.total_correct,
                    answered: r.total_answered
                })),
                ...history.map(r => ({
                    kind: 'legacy',
                    id: r.id,
                    testId: r.test_id,
                    title: r.title,
                    date: r.created_at,
                    score: Number(r.score),
                    maxScore: Number(r.total_questions) * 4,
                    correct: null,
                    answered: null
                }))
            ].sort((a, b) => new Date(b.date) - new Date(a.date));

            historyBody.innerHTML = rows.length === 0
                ? `<tr><td colspan="5"><div class="empty-state">
                       <h3>No attempts yet</h3><p>Your scores will appear here once you finish a test.</p>
                   </div></td></tr>`
                : rows.map(row => {
                    const accuracy = (row.answered && row.answered > 0)
                        ? `${Math.round((row.correct / row.answered) * 100)}%`
                        : '—';
                    const onclick = row.kind === 'mock'
                        ? `goToMockReview(${row.id})`
                        : `goToReview(${row.id}, ${row.testId})`;
                    return `
                    <tr>
                        <td><button type="button" class="row-link" onclick="${onclick}">${escapeHtml(row.title)}</button></td>
                        <td class="num">${row.date ? new Date(row.date).toLocaleDateString() : '—'}</td>
                        <td class="score-cell">${formatScore(row.score)} / ${formatScore(row.maxScore)}</td>
                        <td class="num">${accuracy}</td>
                        <td><span class="tag tag-quiet">Completed</span></td>
                    </tr>`;
                }).join('');
        }

    } catch (err) {
        console.error('Dashboard Error:', err);
        if (String(err.message).includes('401')) {
            localStorage.clear();
            window.location.href = `${BASE_PATH}/index.html`;
        }
    }

    // --- Modal Logic ---
    const rulesModal = document.getElementById('rulesModal');
    const closeRulesBtn = document.getElementById('closeRulesBtn');
    const cancelRulesBtn = document.getElementById('cancelRulesBtn');
    const startFinalBtn = document.getElementById('startFinalBtn');

    const closeModal = () => rulesModal.classList.remove('active');

    if (closeRulesBtn) closeRulesBtn.onclick = closeModal;
    if (cancelRulesBtn) cancelRulesBtn.onclick = closeModal;
    if (rulesModal) {
        rulesModal.onclick = (e) => {
            if (e.target === rulesModal) closeModal();
        };
    }

    if (startFinalBtn) {
        startFinalBtn.onclick = async () => {
            const pendingExamId = localStorage.getItem('pendingMockExamId');
            const pendingTestId = localStorage.getItem('pendingTestId');

            startFinalBtn.disabled = true;
            const originalLabel = startFinalBtn.innerText;
            let arenaPage = 'test-arena.html';

            try {
                if (pendingExamId) {
                    // Ask the server to draw this attempt's paper before leaving the
                    // page — if the draw fails there is still somewhere to show it.
                    startFinalBtn.innerText = 'Preparing paper…';

                    const res = await fetch(`${API_BASE}/tests/mock/${pendingExamId}/start`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.message || 'Could not start the exam');

                    localStorage.setItem('currentAttemptId', String(data.attemptId));
                    localStorage.removeItem('currentTestId');
                    localStorage.removeItem('pendingMockExamId');
                    arenaPage = 'exam-arena.html';
                } else if (pendingTestId) {
                    localStorage.setItem('currentTestId', pendingTestId);
                    localStorage.removeItem('currentAttemptId');
                } else {
                    return;
                }

                // Enter fullscreen before navigating (must follow a user click).
                try {
                    const el = document.documentElement;
                    if (el.requestFullscreen) await el.requestFullscreen();
                    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
                } catch {
                    // Fullscreen may be blocked in some environments — proceed anyway
                }

                window.location.href = `${BASE_PATH}/${arenaPage}`;

            } catch (err) {
                alert('Could not start the exam: ' + err.message);
                startFinalBtn.disabled = false;
                startFinalBtn.innerText = originalLabel;
            }
        };
    }
});

// ---------- Rendering helpers ----------
function renderMockCard(exam) {
    const resuming = Boolean(exam.in_progress_attempt_id);
    const best = exam.best_score !== null && exam.best_score !== undefined
        ? `Best ${formatScore(Number(exam.best_score))} / ${exam.total_questions * 4}`
        : 'Not attempted';

    const sectionLabel = exam.section_count > 1
        ? `${exam.section_count} sections`
        : '1 section';

    const action = resuming ? 'Resume attempt' : (exam.attempts > 0 ? 'Re-attempt' : 'Start test');

    return `
        <div class="exam-card${exam.is_my_department ? ' is-mine' : ''}">
            <div class="exam-card-body">
                <div class="exam-title">
                    <h3>${escapeHtml(exam.title)}</h3>
                    ${exam.is_my_department ? '<span class="tag tag-accent">Your branch</span>' : ''}
                </div>
                <div class="exam-spec">
                    ${exam.total_questions} questions &middot; ${exam.duration_minutes} min &middot; ${sectionLabel}
                </div>
                <div class="exam-history">
                    ${best} &middot; ${exam.attempts} attempt${exam.attempts === 1 ? '' : 's'}
                    &middot; bank of ${exam.bank_size.toLocaleString()}
                </div>
            </div>
            <div class="exam-card-foot">
                <button type="button" class="btn btn-primary btn-block" onclick="startMockExam(${exam.id})">${action}</button>
            </div>
        </div>
    `;
}

function formatScore(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// ---------- Start a mock exam (show rules first) ----------
function startMockExam(examId) {
    const exam = allMockExams.find(e => e.id === examId);
    if (!exam) return;

    document.getElementById('modalTestTitle').innerText = exam.title;
    document.getElementById('modalQCount').innerText = exam.total_questions;
    document.getElementById('modalDuration').innerText = `${exam.duration_minutes} min`;
    const sectionsEl = document.getElementById('modalSections');
    if (sectionsEl) sectionsEl.innerText = exam.section_count;

    localStorage.setItem('pendingMockExamId', String(examId));
    localStorage.removeItem('pendingTestId');

    document.getElementById('rulesModal').classList.add('active');
}

// ---------- Start a legacy fixed test ----------
function startTest(testId) {
    const test = allAvailableTests.find(t => t.id === testId);
    if (!test) return;

    document.getElementById('modalTestTitle').innerText = test.title;
    document.getElementById('modalQCount').innerText = test.total_questions;
    document.getElementById('modalDuration').innerText = `${test.duration_minutes} min`;
    const sectionsEl = document.getElementById('modalSections');
    if (sectionsEl) sectionsEl.innerText = '—';

    localStorage.setItem('pendingTestId', String(testId));
    localStorage.removeItem('pendingMockExamId');

    document.getElementById('rulesModal').classList.add('active');
}

// ---------- Go to Review ----------
function goToMockReview(attemptId) {
    localStorage.setItem('reviewAttemptId', String(attemptId));
    localStorage.removeItem('reviewResultId');
    window.location.href = `${BASE_PATH}/exam-review.html`;
}

function goToReview(resultId, testId) {
    localStorage.setItem('reviewResultId', resultId);
    localStorage.setItem('reviewTestId', testId);
    localStorage.removeItem('reviewAttemptId');
    window.location.href = `${BASE_PATH}/review.html`;
}
