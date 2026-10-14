// Project comes from js/firebase-config.js, loaded before this file.
// On localhost the emulator settings in helpers.js apply instead.
var firebaseConfig = window.FIREBASE_CONFIG || {};
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
var db = firebase.firestore();

function createAdmissionsCollection() {
    var statusDiv = document.getElementById('status');
    statusDiv.textContent = 'Creating admissions collection...';
    statusDiv.style.color = '#475569';
    
    db.collection('admissions').doc('PLACEHOLDER').set({
        note: 'Collection initialized',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        isPlaceholder: true
    })
    .then(function() {
        statusDiv.textContent = 'Admissions collection created successfully!';
        statusDiv.style.color = 'green';
    })
    .catch(function(err) {
        statusDiv.textContent = 'Error: ' + err.message;
        statusDiv.style.color = 'red';
    });
}
