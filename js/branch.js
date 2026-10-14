/* Multi-branch hooks. Single-site hospitals keep branchId empty / "main". */
(function () {
    var cache = null;

    function loadSettings() {
        if (cache) return Promise.resolve(cache);
        return db.collection('hospitalSettings').doc('main').get().then(function (doc) {
            cache = doc.exists ? doc.data() : {};
            return cache;
        }).catch(function () {
            cache = {};
            return cache;
        });
    }

    function listBranches() {
        return loadSettings().then(function (s) {
            var branches = Array.isArray(s.branches) && s.branches.length
                ? s.branches
                : [{ id: 'main', name: s.hospitalName || 'Main Campus' }];
            return branches;
        });
    }

    function currentBranchId() {
        return localStorage.getItem('hms_branch_id') || 'main';
    }

    function setCurrentBranch(id) {
        localStorage.setItem('hms_branch_id', id || 'main');
        window.dispatchEvent(new CustomEvent('hms-branch-changed', { detail: { branchId: currentBranchId() } }));
    }

    function stamp(data) {
        data = data || {};
        if (!data.branchId) data.branchId = currentBranchId();
        return data;
    }

    function matchesBranch(docData) {
        var bid = currentBranchId();
        if (!bid || bid === 'all') return true;
        var d = (docData && docData.branchId) || 'main';
        return d === bid;
    }

    function ensureBranchSwitcher() {
        listBranches().then(function (branches) {
            if (!branches || branches.length < 2) return;
            var navUser = document.querySelector('.nav-user');
            if (!navUser || document.getElementById('branchSelect')) return;
            var sel = document.createElement('select');
            sel.id = 'branchSelect';
            sel.style.cssText = 'margin-right:8px;padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1;font-size:12px;';
            branches.forEach(function (b) {
                var opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name || b.id;
                if (b.id === currentBranchId()) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.onchange = function () { setCurrentBranch(sel.value); location.reload(); };
            navUser.insertBefore(sel, navUser.firstChild);
        });
    }

    window.hmsBranch = {
        list: listBranches,
        currentId: currentBranchId,
        set: setCurrentBranch,
        stamp: stamp,
        matches: matchesBranch,
        refresh: function () { cache = null; return loadSettings(); }
    };

    document.addEventListener('DOMContentLoaded', ensureBranchSwitcher);
})();
