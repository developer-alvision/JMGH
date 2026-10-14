// Explain why the user landed back here, rather than dumping them on a
// blank login form with no reason given.
(function () {
  var reason = new URLSearchParams(window.location.search).get('reason');
  if (!reason) return;
  var err = document.getElementById('errorMessage');
  if (!err) return;
  err.textContent = reason === 'session'
    ? 'You were signed out because this account was used on another device.'
    : 'Your session has ended. Please sign in again.';
  err.style.display = 'block';
}());

document.getElementById("loginForm").addEventListener("submit", function(e) {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const btn = document.getElementById("loginBtn");
  const err = document.getElementById("errorMessage");
  btn.textContent = "Signing in...";
  btn.disabled = true;
  err.style.display = "none";
  auth.signInWithEmailAndPassword(email, password)
    .then(function(userCredential) {
      const user = userCredential.user;
      return callFunction('syncStaffUid').then(function() {
        return db.collection('staff').doc(user.uid).get();
      }).then(function(staffDoc) {
          if (!staffDoc.exists) {
            auth.signOut();
            throw new Error("Your account has been deactivated. Contact administrator.");
          }
          const staffData = staffDoc.data();
          const isActive = staffData.isActive === true || staffData.isActive === 'true';
          if (!isActive) {
            auth.signOut();
            throw new Error("Your account has been deactivated. Contact administrator.");
          }
          if (staffData.role === 'admin') {
            callFunction('applyHospitalPolicy').catch(function(error) {
              console.warn('Hospital catalog setup will retry on next administrator login:', error.message);
            });
            callFunction('refreshPublicDisplays').catch(function(error) {
              console.warn('Public display refresh will retry on next administrator login:', error.message);
            });
          }
          
          // Claim the account for this device. Any other session that is
          // still open will notice the new id and sign itself out.
          return claimSession(user.uid)
            .then(function() {
                return db.collection('logins').add({
                    email: email,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                }).catch(function(logError) { console.warn('Login audit unavailable:', logError.message); });
            })
            .then(function() {
                window.location.href = "dashboard.html";
            });
        });
    })
    .catch(function(error) {
      var message = 'Login failed. Please try again.';
      if (error.code === 'auth/user-not-found') message = 'No account found with this email address.';
      else if (error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') message = 'Incorrect email or password.';
      else if (error.code === 'functions/unavailable' || error.code === 'functions/internal') message = window.HMS_LOCAL ? 'Local services are unavailable. Start the app with npm start, then try again.' : 'The sign-in service is unavailable. Please try again shortly.';
      else if (error.code === 'auth/wrong-password') message = 'Incorrect password. Please try again.';
      else if (error.code === 'auth/invalid-email') message = 'Please enter a valid email address.';
      else if (error.code === 'auth/user-disabled') message = 'This account has been disabled. Contact administrator.';
      else if (error.code === 'auth/too-many-requests') message = 'Too many failed attempts. Please try again later.';
      else if (error.code === 'auth/network-request-failed') message = 'Network error. Please check your internet connection.';
      else if (error.message && error.message.includes("deactivated")) message = error.message;
      err.textContent = message;
      err.style.display = "block";
      btn.textContent = "Sign In";
      btn.disabled = false;
    });
});

if (window.HMS_LOCAL) {
  var help = document.createElement('p');
  help.style.cssText = 'font-size:13px;line-height:1.6;color:#64748b;margin-top:20px';
  help.innerHTML = 'Local emulator account (created by <code>npm run seed</code>):<br>• <code>admin@jyothsna.test</code>';
  document.querySelector('.login-form-wrapper').appendChild(help);
}
