// dashboard.js - Student Dashboard Logic

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    // ---------- Elements ----------
    const studentNameEl = document.getElementById('studentName');
    const userNameHeader = document.getElementById('userNameHeader');
    const avatarEl = document.getElementById('avatarLetter');
    const availableGrid = document.getElementById('availableTestsGrid');
    const historyBody = document.getElementById('scoresTableBody');
    const testsTakenEl = document.getElementById('testsTaken');
    const testsRemainingEl = document.getElementById('testsRemaining');

    // ---------- Profile from localStorage (instant render) ----------
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const displayName = user.name || 'Student';

    if (studentNameEl) studentNameEl.innerText = displayName;
    if (userNameHeader) userNameHeader.innerText = displayName;
    if (avatarEl) avatarEl.innerText = displayName.charAt(0).toUpperCase();

    // Fix 2: show roll number and branch from stored user object
    const rollEl = document.getElementById('studentRoll');
    const branchEl = document.getElementById('studentBranch');
    if (rollEl) rollEl.innerText = user.roll_number ? `Roll No: ${user.roll_number}` : 'Roll No: —';
    if (branchEl) branchEl.innerText = user.branch || '—';

    // ---------- Logout ----------
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.clear();
            window.location.href = 'index.html';
        });
    }

    // ---------- Fetch Dashboard Data ----------
    try {
        const response = await fetch('/api/users/dashboard', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error(response.status);

        const { history, availableTests } = await response.json();
        allAvailableTests = availableTests; // Store in global for modal access

        // Stats
        if (testsTakenEl) testsTakenEl.innerText = history.length;
        if (testsRemainingEl) testsRemainingEl.innerText = availableTests.length;

        // Available Tests
        if (availableGrid) {
            availableGrid.innerHTML = availableTests.length === 0
                ? '<p style="color:#5f6368;padding:1rem;">No new tests available. Check back later!</p>'
                : availableTests.map(test => `
                    <div class="test-card">
                        <div class="test-info">
                            <h3>${test.title}</h3>
                            <p>${test.total_questions} Questions &nbsp;|&nbsp; ${test.duration_minutes} Minutes</p>
                        </div>
                        <button class="btn btn-primary" onclick="startTest(${test.id})">Start Test</button>
                    </div>
                `).join('');
        }

        // History
        if (historyBody) {
            historyBody.innerHTML = history.length === 0
                ? '<tr><td colspan="5" style="text-align:center;color:#5f6368;padding:1rem;">No past tests found.</td></tr>'
                : history.map(row => `
                    <tr>
                        <td>
                            <button class="review-btn" onclick="goToReview(${row.id}, ${row.test_id})">${row.title}</button>
                        </td>
                        <td>${new Date(row.created_at).toLocaleDateString()}</td>
                        <td>${row.score} / ${row.total_questions * 4}</td>
                        <td><span class="status-pass">Completed</span></td>
                    </tr>
                `).join('');
        }

    } catch (err) {
        console.error('Dashboard Error:', err);
        if (String(err.message).includes('401')) {
            localStorage.clear();
            window.location.href = 'index.html';
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
            const testId = localStorage.getItem('pendingTestId');
            if (!testId) return;

            // Enter fullscreen before starting (must be called from a user-click event)
            try {
                const el = document.documentElement;
                if (el.requestFullscreen) await el.requestFullscreen();
                else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen(); // Safari
            } catch {
                // Fullscreen may be blocked in some environments — proceed anyway
            }

            localStorage.setItem('currentTestId', testId);
            window.location.href = 'test-arena.html';
        };
    }
});

let allAvailableTests = []; // Local cache to populate modal

// ---------- Start Test (Show Rules First) ----------
function startTest(testId) {
    const test = allAvailableTests.find(t => t.id === testId);
    if (!test) return;

    // Populate modal
    document.getElementById('modalTestTitle').innerText = test.title;
    document.getElementById('modalQCount').innerText = test.total_questions;
    document.getElementById('modalDuration').innerText = `${test.duration_minutes} mins`;

    // Store testId for the final start button
    localStorage.setItem('pendingTestId', testId);

    // Show modal
    document.getElementById('rulesModal').classList.add('active');
}

// ---------- Go to Review ----------
function goToReview(resultId, testId) {
    localStorage.setItem('reviewResultId', resultId);
    localStorage.setItem('reviewTestId', testId);
    window.location.href = 'review.html';
}

