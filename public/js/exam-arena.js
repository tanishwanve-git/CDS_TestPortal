// exam-arena.js — the exam arena for randomised mock exams.
//
// Differences from the legacy test-arena.js, all of them deliberate:
//   · one clock for the whole paper instead of a locked timer per section, so a
//     student can move between sections and questions until they submit;
//   · the clock is the server's, derived from the attempt's `started_at`, so
//     reloading (or closing and reopening) the tab cannot buy extra time;
//   · every answer is autosaved to the server as it is given, so a crashed
//     browser resumes where it left off rather than losing the attempt;
//   · questions are images (the question text and its options are a single PNG
//     crop from the source paper), so the UI renders the image and supplies its
//     own answer controls beneath it.

// The portal can be reverse-proxied under a /mock (or /mock_test) subpath. The
// page filename deliberately does NOT start with "mock" — this regex would
// otherwise swallow it and point every API call at a path that doesn't exist.
const subpathMatch = window.location.pathname.match(/^(\/mock[^\/]*)\//);
const BASE_PATH = subpathMatch ? subpathMatch[1] : '';
const API_BASE = `${BASE_PATH}/api`;

const token = localStorage.getItem('token');
const attemptId = localStorage.getItem('currentAttemptId');

// ---------- State ----------
let attempt = null;
let sections = [];        // [{ section_name, questions: [...] }]
let flatQuestions = [];   // every question in paper order, with sectionIndex attached
let currentIndex = 0;     // index into flatQuestions
let answers = {};         // { questionId: "A" | "12.5" }
let visited = new Set();  // question ids the student has looked at
let timerInterval = null;
let deadline = null;      // epoch ms
let isSubmitting = false;
let violationCount = 0;

// ---------- Local cache ----------
// Answers live on the server, but a copy in sessionStorage means a reload inside
// a flaky network still shows what was typed.
const ANSWERS_KEY = `mockAnswers_${attemptId}`;

// ---------- Proctoring ----------
function handleViolation() {
    if (isSubmitting) return;
    violationCount++;
    if (violationCount === 1) {
        document.getElementById('violationOverlay').classList.add('show');
    } else {
        removeSecurityListeners();
        performSubmit(true);
    }
}

function dismissWarning() {
    document.getElementById('violationOverlay').classList.remove('show');
}

function onVisibilityChange() {
    if (document.hidden) handleViolation();
}

function onFullscreenChange() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) handleViolation();
}

function attachSecurityListeners() {
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
}

function removeSecurityListeners() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async () => {
    if (!token || !attemptId) {
        window.location.href = `${BASE_PATH}/dashboard.html`;
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/tests/mock/attempt/${attemptId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 409) {
            // Already submitted — send them to the review rather than a dead page.
            localStorage.removeItem('currentAttemptId');
            localStorage.setItem('reviewAttemptId', attemptId);
            window.location.href = `${BASE_PATH}/exam-review.html`;
            return;
        }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Could not load the exam');

        const data = await res.json();
        attempt = data.attempt;
        sections = data.sections;

        // Server-side answers win; the local cache only fills gaps.
        const cached = JSON.parse(sessionStorage.getItem(ANSWERS_KEY) || '{}');
        answers = { ...cached, ...data.savedAnswers };

        flatQuestions = [];
        sections.forEach((section, sIdx) => {
            section.questions.forEach(q => {
                flatQuestions.push({ ...q, sectionIndex: sIdx, sectionName: section.section_name });
            });
        });

        if (!flatQuestions.length) throw new Error('This attempt has no questions');

        document.getElementById('testTitle').innerText = attempt.title;
        document.getElementById('qOfTotal').innerText = `of ${flatQuestions.length}`;

        deadline = Date.now() + attempt.seconds_remaining * 1000;

        renderSectionTabs();
        renderPalette();
        renderQuestion(0);
        startTimer();
        preloadImages();

        if (attempt.seconds_remaining <= 0) {
            // The clock already ran out while they were away — submit what was saved.
            await performSubmit(true);
            return;
        }

        // ── Fullscreen entry ──────────────────────────────────────────────
        const fsOverlay = document.getElementById('fsEntryOverlay');
        const tryFullscreen = async () => {
            try {
                const el = document.documentElement;
                if (el.requestFullscreen) await el.requestFullscreen();
                else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
            } catch { /* blocked — proceed without fullscreen */ }
            fsOverlay.classList.remove('show');
            attachSecurityListeners();
        };

        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            fsOverlay.classList.add('show');
            fsOverlay.addEventListener('click', tryFullscreen, { once: true });
        } else {
            attachSecurityListeners();
        }

    } catch (err) {
        alert('Error loading exam: ' + err.message);
        window.location.href = `${BASE_PATH}/dashboard.html`;
    }
});

// ---------- Rendering ----------
function imageSrc(url) {
    if (!url) return '';
    return url.startsWith('/') ? `${BASE_PATH}${url}` : url;
}

// Browsers fetch each PNG on demand; warming the next few keeps navigation snappy
// without pulling all 50 images at once.
function preloadImages() {
    const warm = (from, count) => {
        for (let i = from; i < Math.min(from + count, flatQuestions.length); i++) {
            const img = new Image();
            img.src = imageSrc(flatQuestions[i].image_url);
        }
    };
    warm(0, 5);
    window.__warmFrom = warm;
}

function renderSectionTabs() {
    const tabs = document.getElementById('sectionTabs');
    // A single-section paper has nothing to switch between.
    if (sections.length <= 1) {
        tabs.style.display = 'none';
        return;
    }
    tabs.innerHTML = sections.map((s, i) => `
        <button type="button" class="section-tab" data-section="${i}" onclick="goToSection(${i})">
            ${escapeHtml(s.section_name)}<span class="tab-count">${s.questions.length}</span>
        </button>
    `).join('');
}

function renderPalette() {
    const body = document.getElementById('paletteBody');
    let n = 0;
    let html = '';

    sections.forEach((section, sIdx) => {
        if (sections.length > 1) {
            html += `<div class="palette-section-label">${escapeHtml(section.section_name)}</div>`;
        }
        html += '<div class="palette-grid compact">';
        section.questions.forEach(() => {
            const idx = n++;
            html += `<div class="palette-box" id="palette-${idx}" onclick="renderQuestion(${idx})">${idx + 1}</div>`;
        });
        html += '</div>';
    });

    body.innerHTML = html;
}

function updatePaletteUI() {
    flatQuestions.forEach((q, i) => {
        const box = document.getElementById(`palette-${i}`);
        if (!box) return;
        box.className = 'palette-box';
        if (visited.has(q.id)) box.classList.add('visited');
        if (answers[q.id] !== undefined && answers[q.id] !== '') box.classList.add('answered');
        if (i === currentIndex) box.classList.add('active');
    });

    document.querySelectorAll('.section-tab').forEach(tab => {
        tab.classList.toggle('active', Number(tab.dataset.section) === flatQuestions[currentIndex].sectionIndex);
    });
}

function renderQuestion(index) {
    currentIndex = index;
    const q = flatQuestions[index];
    visited.add(q.id);

    document.getElementById('currentQNum').innerText = index + 1;
    document.getElementById('qMarks').innerText =
        `${q.sectionName} · +${q.marks} marks, ${q.negative_marks > 0 ? `−${q.negative_marks}` : 'no'} negative`;

    const src = imageSrc(q.image_url);
    document.getElementById('qText').innerHTML = `
        <div class="q-image-wrap">
            <img class="q-image" src="${src}" alt="Question ${index + 1}"
                 onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'q-loading',innerText:'This question image could not be loaded. Please inform the invigilator.'}))">
            <button type="button" class="q-image-zoom" onclick="openLightbox('${src}')">Enlarge</button>
        </div>`;

    const list = document.getElementById('optionsList');

    if (q.question_type === 'NAT') {
        const stored = answers[q.id] ?? '';
        list.innerHTML = `
            <li>
                <input type="text" inputmode="decimal" class="nat-input" id="natInput"
                       value="${escapeHtml(stored)}" placeholder="Numerical answer"
                       autocomplete="off">
                <div class="nat-hint">Numerical answer type — enter a number only, e.g. 12.5 or &minus;3.</div>
            </li>`;
        const input = document.getElementById('natInput');
        input.addEventListener('input', () => setAnswer(q.id, input.value));
    } else {
        list.innerHTML = q.options.map(letter => {
            const selected = answers[q.id] === letter;
            return `
            <li class="option-item${selected ? ' selected' : ''}" onclick="selectOption(${q.id}, '${letter}')">
                <input type="radio" name="q_opt" value="${letter}" ${selected ? 'checked' : ''}>
                <span class="opt-letter">${letter}</span>
            </li>`;
        }).join('');
    }

    document.getElementById('prevBtn').disabled = index === 0;
    document.getElementById('nextBtn').innerText =
        index === flatQuestions.length - 1 ? 'Save & review' : 'Save & next';

    updatePaletteUI();
    if (window.__warmFrom) window.__warmFrom(index + 1, 3);
}

function goToSection(sectionIndex) {
    const first = flatQuestions.findIndex(q => q.sectionIndex === sectionIndex);
    if (first >= 0) renderQuestion(first);
}

// ---------- Answering ----------
function selectOption(questionId, letter) {
    // Clicking the selected option again clears it.
    setAnswer(questionId, answers[questionId] === letter ? '' : letter);
    renderQuestion(currentIndex);
}

function setAnswer(questionId, value) {
    const clean = String(value ?? '').trim();
    if (clean === '') delete answers[questionId];
    else answers[questionId] = clean;

    sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
    updatePaletteUI();
    queueAutosave(questionId, clean);
}

// Autosave is debounced per question so typing a NAT answer doesn't fire a
// request per keystroke.
const autosaveTimers = {};
function queueAutosave(questionId, value) {
    clearTimeout(autosaveTimers[questionId]);
    autosaveTimers[questionId] = setTimeout(() => saveAnswer(questionId, value), 500);
}

async function saveAnswer(questionId, value) {
    const note = document.getElementById('autosaveNote');
    try {
        const res = await fetch(`${API_BASE}/tests/mock/attempt/${attemptId}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ questionId, answer: value })
        });
        if (!res.ok) throw new Error('save failed');
        if (note) {
            note.innerText = 'Saved';
            note.classList.remove('stale');
        }
    } catch {
        // Not fatal — the final submit sends every answer again.
        if (note) {
            note.innerText = 'Offline — answers sent on submit';
            note.classList.add('stale');
        }
    }
}

function clearCurrentResponse() {
    const q = flatQuestions[currentIndex];
    setAnswer(q.id, '');
    renderQuestion(currentIndex);
}

// ---------- Timer ----------
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    tick();
    timerInterval = setInterval(tick, 1000);
}

function tick() {
    const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    const badge = document.getElementById('timerBadge');

    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    const s = left % 60;
    document.getElementById('timeRemaining').innerText = h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    badge.classList.toggle('safe', left > 300);

    if (left <= 0) {
        clearInterval(timerInterval);
        performSubmit(true);
    }
}

// ---------- Submit ----------
const submitModal = document.getElementById('submitModal');

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('prevBtn').onclick = () => {
        if (currentIndex > 0) renderQuestion(currentIndex - 1);
    };

    document.getElementById('nextBtn').onclick = () => {
        if (currentIndex < flatQuestions.length - 1) renderQuestion(currentIndex + 1);
        else document.getElementById('submitTestBtn').click();
    };

    document.getElementById('clearBtn').onclick = clearCurrentResponse;

    document.getElementById('submitTestBtn').onclick = () => {
        const answered = Object.keys(answers).length;
        const unanswered = flatQuestions.length - answered;
        document.getElementById('submitModalBody').innerText =
            `You have answered ${answered} of ${flatQuestions.length} questions` +
            (unanswered ? `, leaving ${unanswered} unanswered.` : '.') +
            ' Once submitted you cannot change your answers.';
        submitModal.classList.add('active');
    };

    document.getElementById('cancelSubmitBtn').onclick = () => submitModal.classList.remove('active');
    submitModal.addEventListener('click', e => {
        if (e.target === submitModal) submitModal.classList.remove('active');
    });

    document.getElementById('confirmSubmitBtn').onclick = async () => {
        submitModal.classList.remove('active');
        await performSubmit(false);
    };

    document.getElementById('backToDashboardBtn').onclick = () => {
        window.location.href = `${BASE_PATH}/dashboard.html`;
    };

    document.getElementById('reviewAttemptBtn').onclick = () => {
        localStorage.setItem('reviewAttemptId', attemptId);
        window.location.href = `${BASE_PATH}/exam-review.html`;
    };
});

async function performSubmit(auto) {
    if (isSubmitting) return;
    isSubmitting = true;

    removeSecurityListeners();
    dismissWarning();
    clearInterval(timerInterval);

    const btn = document.getElementById('submitTestBtn');
    if (btn) { btn.disabled = true; btn.innerText = 'Submitting…'; }

    try {
        const res = await fetch(`${API_BASE}/tests/mock/attempt/${attemptId}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                answers,
                violation_count: violationCount,
                auto_submitted: Boolean(auto)
            })
        });

        const data = await res.json();

        if (!res.ok && res.status !== 409) throw new Error(data.message || 'Submission failed');

        sessionStorage.removeItem(ANSWERS_KEY);
        localStorage.removeItem('currentAttemptId');

        document.getElementById('scoreDisplay').innerText =
            `${formatScore(data.score)} / ${formatScore(data.maxScore)}`;
        document.getElementById('resultSummary').innerHTML = `
            <strong>${data.totalCorrect}</strong> correct ·
            <strong>${data.totalWrong}</strong> incorrect ·
            <strong>${flatQuestions.length - (data.totalAnswered || 0)}</strong> unanswered
            ${auto ? '<br><strong>This attempt was submitted automatically.</strong>' : ''}`;
        document.getElementById('resultModal').classList.add('active');

    } catch (err) {
        console.error('Submission error:', err);
        showToast('Submission failed: ' + err.message);
        isSubmitting = false;
        if (btn) { btn.disabled = false; btn.innerText = 'Submit final test'; }
        // Keep the clock running so a retry is still possible before the deadline.
        if (deadline > Date.now()) startTimer();
    }
}

// ---------- Small helpers ----------
function openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('imageLightbox').classList.add('show');
}

function closeLightbox() {
    document.getElementById('imageLightbox').classList.remove('show');
}

function formatScore(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function showToast(message) {
    let toast = document.getElementById('arenaToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'arenaToast';
        toast.className = 'arena-toast';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    setTimeout(() => toast.remove(), 5000);
}

// Keyboard shortcuts mirror the real GATE interface.
document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' && currentIndex < flatQuestions.length - 1) renderQuestion(currentIndex + 1);
    if (e.key === 'ArrowLeft' && currentIndex > 0) renderQuestion(currentIndex - 1);
    if (e.key === 'Escape') closeLightbox();
    const q = flatQuestions[currentIndex];
    if (q && q.question_type === 'MCQ' && /^[a-dA-D]$/.test(e.key)) {
        selectOption(q.id, e.key.toUpperCase());
    }
});
