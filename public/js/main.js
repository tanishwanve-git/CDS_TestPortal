document.addEventListener('DOMContentLoaded', () => {
    // Automatically detect if running under /mock or root
    const subpathMatch = window.location.pathname.match(/^(\/mock[^\/]*)/);
    const API_BASE = subpathMatch ? `${subpathMatch[1]}/api` : '/api';

    const msgBox = document.getElementById('authMessage');

    // ── Utility: show message box ───────────────────────────────────────────
    function showMessage(msg, isSuccess = false) {
        if (!msgBox) return;
        msgBox.style.display = 'block';
        msgBox.style.backgroundColor = isSuccess ? '#14532d22' : '#7f1d1d22';
        msgBox.style.color            = isSuccess ? '#4ade80'   : '#f87171';
        msgBox.style.border           = isSuccess ? '1px solid #22c55e33' : '1px solid #ef444433';
        msgBox.innerText = msg;
    }

    // ── Initialize Google Sign-In ───────────────────────────────────────────
    async function initGoogle() {
        let clientId = "781921574284-1nmsp5uq85eucrc6akrss2669k40h1b4.apps.googleusercontent.com";
        try {
            const res = await fetch(`${API_BASE}/auth/config`);
            if (res.ok) {
                const data = await res.json();
                if (data.googleClientId) clientId = data.googleClientId;
            }
        } catch (e) { /* fallback to static clientId */ }

        const renderBtn = () => {
            if (window.google) {
                google.accounts.id.initialize({
                    client_id: clientId,
                    callback: handleGoogleSignIn
                });
                const container = document.getElementById("g_id_signin");
                if (container) {
                    google.accounts.id.renderButton(
                        container,
                        { theme: "outline", size: "large", width: "100%", text: "signin_with" }
                    );
                }
            } else {
                setTimeout(renderBtn, 300);
            }
        };
        renderBtn();
    }
    initGoogle();

    // ── Handle Google OAuth Response ────────────────────────────────────────
    async function handleGoogleSignIn(googleResponse) {
        if (msgBox) msgBox.style.display = 'none';

        try {
            const response = await fetch(`${API_BASE}/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: googleResponse.credential })
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                window.location.href = 'dashboard.html';
            } else {
                showMessage(data.error || data.message || 'Access Denied: You are not authorized to access this portal.');
            }
        } catch (err) {
            console.error('Google Auth Error:', err);
            showMessage('Failed to connect to server. Please try again.');
        }
    }
});
