/* Bilingual UI (English / Telugu). Preference is local; clinical data stays as entered. */
(function () {
    var DICT = {
        'Dashboard': 'డాష్‌బోర్డ్',
        'Patients': 'రోగులు',
        'Appointments': 'అపాయింట్‌మెంట్లు',
        'Billing': 'బిల్లింగ్',
        'Pharmacy': 'ఫార్మసీ',
        'Lab Reports': 'ల్యాబ్ రిపోర్టులు',
        'Imaging': 'ఇమేజింగ్',
        'Bed Board': 'బెడ్ బోర్డ్',
        'OT Schedule': 'ఓటి షెడ్యూల్',
        'Certificates': 'సర్టిఫికేట్లు',
        'Accounts': 'అకౌంట్స్',
        'Staff': 'సిబ్బంది',
        'Maternity Care': 'మాతృత్వ సంరక్షణ',
        'Discharge': 'డిశ్చార్జ్',
        'OP Queue': 'ఓపి క్యూ',
        'Insurance Claims': 'బీమా క్లెయిమ్స్',
        'Packages': 'ప్యాకేజీలు',
        'Quality & Audit': 'నాణ్యత & ఆడిట్',
        'Inventory Alerts': 'స్టాక్ హెచ్చరికలు',
        'Tele-consult': 'టెలి-కన్సల్ట్',
        'USG Templates': 'యుఎస్‌జి టెంప్లేట్లు',
        'Owner Analytics': 'యజమాని విశ్లేషణ',
        'Doctor Dashboard': 'డాక్టర్ డాష్‌బోర్డ్',
        'Today Collections': 'నేటి వసూళ్లు',
        'Attendance': 'హాజరు',
        'Consultations Log': 'కన్సల్టేషన్ లాగ్',
        'Sign In': 'సైన్ ఇన్',
        'Logout': 'లాగ్ అవుట్',
        'Save': 'సేవ్',
        'Cancel': 'రద్దు',
        'Search': 'వెతకండి',
        'Print': 'ప్రింట్',
        'Export': 'ఎగుమతి',
        'Overview': 'అవలోకనం',
        'Quick Actions': 'త్వరిత చర్యలు',
        'Loading...': 'లోడ్ అవుతోంది...',
        'Access denied': 'ప్రవేశం నిరాకరించబడింది',
        'Hospital Receipt': 'ఆస్పత్రి రసీదు',
        'Receipt No': 'రసీదు సంఖ్య',
        'Patient Name': 'పేషెంట్ పేరు',
        'Age': 'వయస్సు',
        'Sex': 'లింగం',
        'Address': 'చిరునామా',
        'Date': 'తేదీ',
        'DO Admission': 'చేరిన తేదీ (DO Admission)',
        'DO Discharge': 'డిశ్చార్జ్ తేదీ (DO Discharge)',
        'Procedure Underwent': 'చేసిన చికిత్స / విధానం (Procedure Underwent)',
        'Payment Details': 'చెల్లింపు వివరాలు (Payment Details)',
        'Particulars': 'వివరాలు (Particulars)',
        'Amount': 'మొత్తం (Amount)',
        'Doctor fee': 'డాక్టర్ ఫీజు',
        'Operation theatre charges': 'ఆపరేషన్ థియేటర్ చార్జీలు',
        'Labour room charges': 'లేబర్ రూమ్ చార్జీలు',
        'Nursing charges': 'నర్సింగ్ చార్జీలు',
        'Anaesthetist charges': 'అనస్థీటిస్ట్ చార్జీలు',
        'Paediatrician charges': 'పీడియాట్రీషియన్ చార్జీలు',
        'Bed charges': 'బెడ్ చార్జీలు',
        'General ward': 'జనరల్ వార్డ్',
        'Private room (Small)': 'ప్రైవేట్ రూమ్ (చిన్నది)',
        'Private room (Big)': 'ప్రైవేట్ రూమ్ (పెద్దది)'
    };

    function currentLang() {
        return localStorage.getItem('hms_ui_lang') || 'en';
    }

    function setLang(lang) {
        localStorage.setItem('hms_ui_lang', lang === 'te' ? 'te' : 'en');
        applyI18n(document);
        var btn = document.getElementById('langToggleBtn');
        if (btn) btn.textContent = currentLang() === 'te' ? 'EN' : 'తెలుగు';
    }

    function t(text) {
        if (!text) return text;
        if (currentLang() !== 'te') return text;
        return DICT[text] || text;
    }

    function applyI18n(root) {
        root = root || document;
        root.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            if (!el.getAttribute('data-i18n-en')) el.setAttribute('data-i18n-en', key);
            el.textContent = t(el.getAttribute('data-i18n-en') || key);
        });
        // Translate sidebar labels after rebuild
        root.querySelectorAll('.sidebar-nav .nav-item').forEach(function (a) {
            var icon = a.querySelector('i');
            var raw = (a.getAttribute('data-label') || a.textContent || '').trim();
            if (!a.getAttribute('data-label')) {
                var clone = a.cloneNode(true);
                var ic = clone.querySelector('i');
                if (ic) ic.remove();
                a.setAttribute('data-label', clone.textContent.trim());
            }
            var label = a.getAttribute('data-label');
            a.innerHTML = (icon ? icon.outerHTML + ' ' : '') + escapeHtml(t(label));
        });
    }

    function ensureLangToggle() {
        var navUser = document.querySelector('.nav-user');
        if (!navUser || document.getElementById('langToggleBtn')) return;
        var btn = document.createElement('button');
        btn.id = 'langToggleBtn';
        btn.type = 'button';
        btn.className = 'btn-secondary';
        btn.style.cssText = 'padding:6px 10px;font-size:12px;margin-right:8px;';
        btn.textContent = currentLang() === 'te' ? 'EN' : 'తెలుగు';
        btn.onclick = function () { setLang(currentLang() === 'te' ? 'en' : 'te'); };
        navUser.insertBefore(btn, navUser.firstChild);
    }

    window.hmsI18n = { t: t, setLang: setLang, currentLang: currentLang, apply: applyI18n, DICT: DICT };

    document.addEventListener('DOMContentLoaded', function () {
        ensureLangToggle();
        applyI18n(document);
    });

    // Re-apply after sidebar rebuild
    var _build = window.buildSidebar;
    if (typeof _build === 'function') {
        window.buildSidebar = function (role) {
            _build(role);
            ensureLangToggle();
            applyI18n(document);
        };
    }
})();
