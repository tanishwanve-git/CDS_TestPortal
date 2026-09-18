// test-arena.js — Exam Logic with session persistence & custom modal

// Automatically detect if running under /mock or /mock_test or root
const subpathMatch = window.location.pathname.match(/^(\/mock[^\/]*)/);
const BASE_PATH = subpathMatch ? subpathMatch[1] : '';
const API_BASE = `${BASE_PATH}/api`;

const token = localStorage.getItem('token');
const testId = localStorage.getItem('currentTestId');

// ---------- State ----------
let testData = null;
let currentSections = [];
let currentSectionIndex = 0;
let currentQuestions = []; // questions of the active section
let currentIndex = 0; // question index within the section
let userAnswers = {};     // { questionId: "A" | "B" | ... }
let timerInterval;
let sectionTimeLeft;      // seconds left in current section
let isSubmitting = false;

// ---------- Exam Security ----------
let violationCount = 0;

function handleViolation() {
    if (isSubmitting) return;
    violationCount++;
    if (violationCount === 1) {
        // Show centered warning modal with blur
        document.getElementById('violationOverlay').classList.add('show');
    } else {
        // Auto-submit on 2nd violation
        removeSecurityListeners();
        performSubmit();
    }
}

function dismissWarning() {
    document.getElementById('violationOverlay').classList.remove('show');
}

function onVisibilityChange() {
    if (document.hidden) handleViolation();
}

function onFullscreenChange() {
    // Fire only when fullscreen is EXITED (not when entering)
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        handleViolation();
    }
}

function removeSecurityListeners() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
}

function attachSecurityListeners() {
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
}

// ---------- Session-storage keys ----------
const ANSWERS_KEY = `answers_${testId}`;
const SECTION_STARTTIME_KEY = `sectionStart_${testId}`;
const QUESTION_KEY = `currentQ_${testId}`;
const SECTION_INDEX_KEY = `currentSec_${testId}`;

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async () => {
    if (!token || !testId) {
        window.location.href = `${BASE_PATH}/dashboard.html`;
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/tests/${testId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Could not load test content');

        const data = await response.json();
        testData = data.test;
        currentSections = data.sections;

        document.getElementById('testTitle').innerText = testData.title;

        // --- Restore or initialise saved state ---
        const savedAnswers = sessionStorage.getItem(ANSWERS_KEY);
        userAnswers = savedAnswers ? JSON.parse(savedAnswers) : {};

        // Restore section index
        currentSectionIndex = parseInt(sessionStorage.getItem(SECTION_INDEX_KEY) || '0');

        // If they somehow refreshed after the last section but before submit completed
        if (currentSectionIndex >= currentSections.length) {
            currentSectionIndex = currentSections.length - 1;
        }

        loadSection(currentSectionIndex);

        // ── Fullscreen entry on test-arena page ──────────────────────────
        // Navigation from dashboard exits fullscreen in most browsers.
        // Show an overlay asking user to click → then request fullscreen.
        const fsOverlay = document.getElementById('fsEntryOverlay');
        const tryFullscreen = async () => {
            try {
                const el = document.documentElement;
                if (el.requestFullscreen) await el.requestFullscreen();
                else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
            } catch { /* blocked — proceed without fullscreen */ }
            fsOverlay.classList.remove('show');
            // Start security monitoring only AFTER fullscreen is entered
            attachSecurityListeners();
        };

        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            // Not in fullscreen yet → show entry overlay
            fsOverlay.classList.add('show');
            fsOverlay.addEventListener('click', tryFullscreen, { once: true });
        } else {
            // Already fullscreen (e.g. browser maintained it) → just attach
            attachSecurityListeners();
        }

    } catch (err) {
        alert('Error loading test: ' + err.message);
        window.location.href = `${BASE_PATH}/dashboard.html`;
    }
});

// ---------- Section Logic ----------
function loadSection(secIdx) {
    currentSectionIndex = secIdx;
    sessionStorage.setItem(SECTION_INDEX_KEY, String(secIdx));

    const section = currentSections[secIdx];
    currentQuestions = section.questions;

    // Timer logic for section
    const savedStartTime = sessionStorage.getItem(`${SECTION_STARTTIME_KEY}_${secIdx}`);
    const sectionDurationSecs = section.duration_minutes * 60;

    let timeLeft;
    if (savedStartTime) {
        const elapsed = Math.floor((Date.now() - parseInt(savedStartTime)) / 1000);
        timeLeft = Math.max(sectionDurationSecs - elapsed, 0);
    } else {
        sessionStorage.setItem(`${SECTION_STARTTIME_KEY}_${secIdx}`, String(Date.now()));
        timeLeft = sectionDurationSecs;
    }

    // Update UI for section
    const titleEl = document.getElementById('testTitle');
    titleEl.innerHTML = `${testData.title} <span style="color:var(--primary); font-size:0.9em; margin-left:10px;">► ${section.section_name}</span>`;

    setupPalette();
    startTimer(timeLeft);

    // Question restore logic
    let savedQ = parseInt(sessionStorage.getItem(QUESTION_KEY) || '0');
    // If returning to a previous section (shouldn't happen in strict mode), or moving to new one
    if (savedQ >= currentQuestions.length) savedQ = 0;

    renderQuestion(savedQ);
}

function submitCurrentSection() {
    clearInterval(timerInterval);

    if (currentSectionIndex < currentSections.length - 1) {
        // Move to next section
        sessionStorage.setItem(QUESTION_KEY, '0'); // reset question index
        loadSection(currentSectionIndex + 1);
    } else {
        // Last section completed, submit whole test
        performSubmit();
    }
}

// ---------- Render ----------
function renderQuestion(index) {
    currentIndex = index;
    // Persist current question number
    sessionStorage.setItem(QUESTION_KEY, String(index));
    const q = currentQuestions[index];

    document.getElementById('currentQNum').innerText = index + 1;

    // Helper to extract Google Drive direct link
    const getDirectUrl = (url) => {
        if (!url) return '';
        const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/);
        if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
        // Prefix root-relative paths (e.g. "/questions/...") with the detected /mock subpath
        return url.startsWith('/') ? `${BASE_PATH}${url}` : url;
    };

    let qHtml = q.question_text.replace(/\n/g, '<br>');
    if (q.image_url && q.image_url.trim() !== '') {
        const directUrl = getDirectUrl(q.image_url);
        qHtml += `<br><img src="${directUrl}" alt="Question Image" style="max-width: 100%; max-height: 350px; margin-top: 15px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">`;
    }
    document.getElementById('qText').innerHTML = qHtml;

    const list = document.getElementById('optionsList');
    list.innerHTML = '';

    if (q.question_type === 'NAT') {
        const storedAns = userAnswers[q.id] || '';
        list.innerHTML = `
            <div style="margin-top:20px;">
                <input type="text" id="natInput_${q.id}" value="${storedAns}" placeholder="Enter your numerical answer here" 
                       style="padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px; width: 100%; box-sizing: border-box;" 
                       oninput="handleNatInput(${q.id}, this.value)">
            </div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
                <i>Marks: +${parseFloat(q.marks ?? 4)} / -${parseFloat(q.negative_marks ?? 1)}</i>
            </div>
        `;
    } else {
        // Options stored as JSON object  { "A": "...", "B": "..." }
        const options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;

        Object.entries(options).forEach(([key, value]) => {
            const isSelected = userAnswers[q.id] === key;

            // Check if string is a direct image URL or a Google Drive link
            const isDriveLink = (typeof value === 'string' && value.match(/drive\.google\.com/));
            const isImage = (typeof value === 'string' && (value.match(/^(https?:\/\/|\/).*\.(png|jpg|jpeg|gif|webp|svg)$/i) || isDriveLink));

            let displayValue = value;
            if (isImage) {
                const directUrl = getDirectUrl(value);
                displayValue = `<br><img src="${directUrl}" alt="Option ${key}" style="max-height: 150px; max-width: 100%; border-radius: 4px; margin-top: 10px;">`;
            }

            list.innerHTML += `
                <li class="option-item ${isSelected ? 'selected' : ''}" onclick="selectOption(${q.id}, '${key}')">
                    <input type="radio" name="q_opt" value="${key}" ${isSelected ? 'checked' : ''}>
                    <span><strong>${key}:</strong> ${displayValue}</span>
                </li>
            `;
        });

        list.innerHTML += `
            <div style="margin-top: 15px; font-size: 0.9em; color: #666;">
                <i>Marks: +${parseFloat(q.marks ?? 4)} / -${parseFloat(q.negative_marks ?? 1)}</i>
            </div>
        `;

        // Bug 3: Clear Selection button — only shown when an answer is selected
        if (userAnswers[q.id] !== undefined) {
            list.innerHTML += `
                <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
                    <button type="button"
                        onclick="clearSelection(${q.id})"
                        style="background: transparent; border: 1px solid #3F3F46; border-radius: 6px;
                               color: #A1A1AA; font-size: 0.82rem; padding: 5px 14px; cursor: pointer;
                               transition: all 0.2s; font-family: inherit;"
                        onmouseover="this.style.borderColor='#EF4444';this.style.color='#EF4444';"
                        onmouseout="this.style.borderColor='#3F3F46';this.style.color='#A1A1AA';">
                        ✕ Clear Selection
                    </button>
                </div>
            `;
        }
    }

    updatePaletteUI();
    document.getElementById('prevBtn').disabled = currentIndex === 0;

    const nextBtn = document.getElementById('nextBtn');
    if (currentIndex === currentQuestions.length - 1) {
        if (currentSectionIndex === currentSections.length - 1) {
            nextBtn.innerText = 'Save & Review Info';
        } else {
            nextBtn.innerText = 'Save & Submit Section';
        }
    } else {
        nextBtn.innerText = 'Save & Next';
    }

    // ── Contextual sidebar submit buttons: show Section or Final Test button ──
    const sectionBtn = document.getElementById('submitSectionBtn');
    const finalTestBtn = document.getElementById('submitTestBtn');
    const isLastSection = currentSectionIndex === currentSections.length - 1;

    if (isLastSection) {
        // Last section: show "Submit Final Test", hide "Submit Section"
        if (sectionBtn) sectionBtn.style.display = 'none';
        if (finalTestBtn) finalTestBtn.style.display = 'block';
    } else {
        // Mid sections: show "Submit Section", hide "Submit Final Test"
        if (sectionBtn) sectionBtn.style.display = 'block';
        if (finalTestBtn) finalTestBtn.style.display = 'none';
    }
}

// ── Bug 3 Fix: Toggle deselect — clicking a selected option unselects it ──
function selectOption(qId, key) {
    if (userAnswers[qId] === key) {
        // Already selected — deselect (clear the answer)
        delete userAnswers[qId];
    } else {
        userAnswers[qId] = key;
    }
    sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(userAnswers));
    renderQuestion(currentIndex);
}

// Explicit clear button handler
function clearSelection(qId) {
    delete userAnswers[qId];
    sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(userAnswers));
    renderQuestion(currentIndex);
}

function handleNatInput(qId, val) {
    if (val.trim() === '') {
        delete userAnswers[qId];
    } else {
        userAnswers[qId] = val;
    }
    sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(userAnswers));
    updatePaletteUI();
}

// ---------- Palette ----------
function setupPalette() {
    const grid = document.getElementById('paletteGrid');
    grid.innerHTML = '';
    currentQuestions.forEach((_, i) => {
        const box = document.createElement('div');
        box.className = 'palette-box';
        box.innerText = i + 1;
        box.onclick = () => renderQuestion(i);
        grid.appendChild(box);
    });
}

function updatePaletteUI() {
    document.querySelectorAll('.palette-box').forEach((box, i) => {
        const qId = currentQuestions[i].id;
        box.className = 'palette-box';
        if (userAnswers[qId] !== undefined) box.classList.add('answered');
        if (i === currentIndex) box.classList.add('active');
    });
}

// ---------- Timer ----------
function startTimer(seconds) {
    if (timerInterval) clearInterval(timerInterval);
    let timeLeft = seconds;

    updateTimerDisplay(timeLeft);

    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerDisplay(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            submitCurrentSection(); // auto-submit current section
        }
        if (timeLeft < 60) {
            document.getElementById('timerBadge').className = 'timer-badge'; // Can add alert class here if want
            document.getElementById('timerBadge').style.color = 'red';
            document.getElementById('timerBadge').style.borderColor = 'red';
        } else {
            document.getElementById('timerBadge').style.color = '';
            document.getElementById('timerBadge').style.borderColor = '';
        }
    }, 1000);
}

function updateTimerDisplay(timeLeft) {
    const min = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const sec = (timeLeft % 60).toString().padStart(2, '0');
    document.getElementById('timeRemaining').innerText = `${min}:${sec}`;
}

// ---------- Custom Submit Modal ----------
const submitModal = document.getElementById('submitModal');
const confirmBtn = document.getElementById('confirmSubmitBtn');
const cancelBtn = document.getElementById('cancelSubmitBtn');

document.getElementById('submitTestBtn').onclick = (e) => {
    e.preventDefault();
    document.querySelector('#submitModal h3').innerText = 'Submit Test?';
    document.querySelector('#submitModal p').innerText = 'Once submitted, you cannot change your answers. Are you sure you want to submit?';
    confirmBtn.onclick = async () => {
        submitModal.classList.remove('active');
        await performSubmit();
    };
    submitModal.classList.add('active');   // show modal
};

cancelBtn.onclick = () => {
    submitModal.classList.remove('active'); // hide modal
};

// Clicking outside the modal box also cancels
submitModal.addEventListener('click', (e) => {
    if (e.target === submitModal) submitModal.classList.remove('active');
});

function showSectionCompleteModal() {
    document.querySelector('#submitModal h3').innerText = 'Submit Section?';
    document.querySelector('#submitModal p').innerText = `You are about to submit "${currentSections[currentSectionIndex].section_name}". You CANNOT return to this section later. Proceed to next section?`;
    confirmBtn.onclick = () => {
        submitModal.classList.remove('active');
        submitCurrentSection();
    };
    submitModal.classList.add('active');
}

// ── Wire sidebar submit buttons after DOM is ready ───────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // "Save & Submit Section" button in palette sidebar (visible on non-last sections)
    const submitSectionBtn = document.getElementById('submitSectionBtn');
    if (submitSectionBtn) {
        submitSectionBtn.onclick = () => {
            showSectionCompleteModal();
        };
    }
    // Note: submitTestBtn (sidebar) is wired above via document.getElementById('submitTestBtn').onclick
});


// ---------- Actual Submission ----------
async function performSubmit() {
    if (isSubmitting) return;
    isSubmitting = true;

    // Stop security monitoring once submission starts
    removeSecurityListeners();
    dismissWarning();

    const submitBtn = document.getElementById('submitTestBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Submitting...';
    }

    clearInterval(timerInterval);

    try {
        // Approximate total time calculation across sections
        let totalTimeTaken = 0;
        for (let i = 0; i < currentSections.length; i++) {
            const startStr = sessionStorage.getItem(`${SECTION_STARTTIME_KEY}_${i}`);
            if (startStr) {
                totalTimeTaken += Math.floor((Date.now() - parseInt(startStr)) / 1000);
            }
        }

        const response = await fetch(`${API_BASE}/tests/${testId}/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                answers: userAnswers,
                time_taken_seconds: totalTimeTaken,
                violation_count: violationCount,
                auto_submitted: isSubmitting && violationCount >= 2
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Clear ALL saved state on success
            sessionStorage.removeItem(ANSWERS_KEY);
            sessionStorage.removeItem(SECTION_INDEX_KEY);
            sessionStorage.removeItem(QUESTION_KEY);
            for (let i = 0; i < 10; i++) {
                sessionStorage.removeItem(`${SECTION_STARTTIME_KEY}_${i}`);
            }
            // BUG-002 FIX: Clear currentTestId so pressing Back after
            // leaving test-arena redirects to dashboard instead of re-loading
            // the already-submitted test.
            localStorage.removeItem('currentTestId');

            const resultModal = document.getElementById('resultModal');
            let maxScore = 0;
            currentSections.forEach(s => {
                s.questions.forEach(q => {
                    maxScore += parseFloat(q.marks || 4);
                });
            });

            document.getElementById('scoreDisplay').innerText = `${data.score} / ${maxScore}`;
            resultModal.classList.add('active');

        } else {
            throw new Error(data.message || 'Submission failed');
        }

    } catch (err) {
        console.error('Submission error:', err);

        let errorModal = document.getElementById('errorModal');
        if (!errorModal) {
            errorModal = document.createElement('div');
            errorModal.style.position = 'fixed';
            errorModal.style.top = '20px';
            errorModal.style.left = '50%';
            errorModal.style.transform = 'translateX(-50%)';
            errorModal.style.background = '#f8d7da';
            errorModal.style.color = '#721c24';
            errorModal.style.padding = '15px 30px';
            errorModal.style.borderRadius = '8px';
            errorModal.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';
            errorModal.style.zIndex = '9999';
            errorModal.style.fontWeight = '500';
            errorModal.id = 'errorModal';
            document.body.appendChild(errorModal);
        }
        errorModal.innerText = 'Submission failed: ' + err.message;
        setTimeout(() => { if (errorModal) errorModal.remove(); }, 5000);

        isSubmitting = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Submit Final Test';
        }
    }
}

// ---------- Navigation buttons ----------
document.getElementById('nextBtn').onclick = (e) => {
    e.preventDefault();
    if (currentIndex < currentQuestions.length - 1) {
        renderQuestion(currentIndex + 1);
    } else {
        // Attempting to move past the last question in a section
        if (currentSectionIndex < currentSections.length - 1) {
            showSectionCompleteModal();
        } else {
            // Last question of last section -> trigger final submit modal
            document.getElementById('submitTestBtn').click();
        }
    }
};

document.getElementById('prevBtn').onclick = (e) => {
    e.preventDefault();
    if (currentIndex > 0) renderQuestion(currentIndex - 1);
};
