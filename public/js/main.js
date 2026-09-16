document.addEventListener('DOMContentLoaded', () => {
    const authForm = document.getElementById('authForm');
    const toggleAuth = document.getElementById('toggleAuth');
    const registrationFields = document.getElementById('registrationFields');
    const authBtn = document.getElementById('authBtn');
    const toggleText = document.getElementById('toggleText');

    let isLogin = true;

    const msgBox = document.getElementById('authMessage');

    function showMessage(msg, isSuccess = false) {
        if (!msgBox) return;
        msgBox.style.display = 'block';
        msgBox.style.backgroundColor = isSuccess ? '#d4edda' : '#f8d7da';
        msgBox.style.color = isSuccess ? '#155724' : '#721c24';
        msgBox.innerText = msg;
    }

    // Fix 4: Show/Hide Password toggle
    const passwordInput = document.getElementById('password');
    const togglePasswordBtn = document.getElementById('togglePasswordBtn');
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', () => {
            const isHidden = passwordInput.type === 'password';
            passwordInput.type = isHidden ? 'text' : 'password';
            togglePasswordBtn.innerHTML = isHidden
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
                : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        });
    }

    // 1. Toggle Login/Sign Up
    if (toggleText) {
        toggleText.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'toggleAuth') {
                e.preventDefault();
                isLogin = !isLogin;

                registrationFields.style.display = isLogin ? 'none' : 'block';
                authBtn.innerText = isLogin ? 'Sign In' : 'Create Account';
                toggleText.innerHTML = isLogin
                    ? 'Don\'t have an account? <a href="#" id="toggleAuth">Sign Up</a>'
                    : 'Already have an account? <a href="#" id="toggleAuth">Sign In</a>';
            }
        });
    }

    // 2. Initialize Google Sign-In
    function initGoogle() {
        if (window.google) {
            google.accounts.id.initialize({
                client_id: "781921574284-1nmsp5uq85eucrc6akrss2669k40h1b4.apps.googleusercontent.com",
                callback: handleGoogleSignIn
            });
            google.accounts.id.renderButton(
                document.getElementById("g_id_signin"),
                { theme: "outline", size: "large", width: "100%" }
            );
        } else {
            setTimeout(initGoogle, 500);
        }
    }
    initGoogle();

    // 3. Form Submission (Login or Register)
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
            const payload = { email, password };

            if (!isLogin) {
                payload.name = document.getElementById('name').value;
                payload.roll_number = document.getElementById('roll_number').value;
                payload.branch = document.getElementById('branch').value;

                if (!payload.name) return showMessage('Name is required for registration');

                // Name validation: must not contain numbers
                if (/\d/.test(payload.name)) {
                    return showMessage('Name must not contain numbers');
                }

                if (!payload.branch) return showMessage('Please select a branch');
            }

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (response.ok) {
                    // Both login AND register now return a token → go straight to dashboard
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    window.location.href = 'dashboard.html';
                } else {
                    showMessage(data.message || 'Action failed');
                }
            } catch (err) {
                console.error('Auth Error:', err);
                showMessage('Connection error. Is the server running?');
            }
        });
    }

    // 4. Handle Google Response
    async function handleGoogleSignIn(googleResponse) {
        try {
            const response = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: googleResponse.credential })
            });

            const data = await response.json();

            if (response.ok) {
                // If Google user doesn't have roll number or branch, prompt them to complete profile
                if (!data.user.roll_number || !data.user.branch) {
                    localStorage.setItem('tempToken', data.token);

                    document.getElementById('authForm').style.display = 'none';
                    document.querySelector('.login-header p').innerText = 'Complete Your Profile';
                    if (msgBox) msgBox.style.display = 'none';

                    const cpForm = document.getElementById('completeProfileForm');
                    cpForm.style.display = 'block';
                    document.getElementById('cp_name').value = data.user.name || '';
                } else {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    window.location.href = 'dashboard.html';
                }
            } else {
                showMessage(data.message || 'Google Auth failed');
            }
        } catch (err) {
            console.error('Google Auth Error:', err);
            showMessage('Failed to connect to backend.');
        }
    }

    // 5. Complete Profile Form Submission (Google Users)
    const completeProfileForm = document.getElementById('completeProfileForm');
    if (completeProfileForm) {
        completeProfileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                name: document.getElementById('cp_name').value,
                roll_number: document.getElementById('cp_roll_number').value,
                branch: document.getElementById('cp_branch').value
            };

            if (!payload.name) return showMessage('Name is required');
            if (/\d/.test(payload.name)) return showMessage('Name must not contain numbers');
            if (!payload.branch) return showMessage('Please select a branch');

            try {
                const response = await fetch('/api/auth/complete-profile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('tempToken')}`
                    },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (response.ok) {
                    localStorage.setItem('token', localStorage.getItem('tempToken'));
                    localStorage.removeItem('tempToken');
                    localStorage.setItem('user', JSON.stringify(data.user));
                    window.location.href = 'dashboard.html';
                } else {
                    showMessage(data.message || 'Failed to complete profile');
                }
            } catch (err) {
                console.error('Complete Profile Error:', err);
                showMessage('Connection error. Is the server running?');
            }
        });
    }
});
