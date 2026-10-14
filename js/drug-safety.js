/* Pregnancy-aware drug safety hints for e-prescriptions (local reference, not a full clinical DB). */
(function () {
    var RULES = [
        { match: /isotretinoin|accutane/i, level: 'danger', note: 'Contraindicated in pregnancy (severe teratogen).' },
        { match: /warfarin|coumadin/i, level: 'danger', note: 'Avoid in pregnancy — fetal anticoagulant syndrome risk.' },
        { match: /valproate|sodium valproate|divalproex/i, level: 'danger', note: 'High teratogenic risk; prefer safer alternatives if pregnant.' },
        { match: /methotrexate/i, level: 'danger', note: 'Abortifacient / teratogen — contraindicated in pregnancy.' },
        { match: /misoprostol|cytotec/i, level: 'warning', note: 'Uterotonic — only use with clear obstetric indication.' },
        { match: /ace inhibitor|enalapril|ramipril|lisinopril|captopril/i, level: 'danger', note: 'ACE inhibitors contraindicated in pregnancy.' },
        { match: /arb\b|losartan|telmisartan|olmesartan/i, level: 'danger', note: 'ARBs contraindicated in pregnancy.' },
        { match: /tetracycline|doxycycline|minocycline/i, level: 'warning', note: 'Avoid in pregnancy — tooth/bone effects on fetus.' },
        { match: /ciprofloxacin|levofloxacin|ofloxacin|norfloxacin/i, level: 'warning', note: 'Fluoroquinolones generally avoided in pregnancy.' },
        { match: /ibuprofen|diclofenac|naproxen|mefenamic|nsaid/i, level: 'warning', note: 'NSAIDs — avoid especially in 3rd trimester (ductus arteriosus).' },
        { match: /aspirin|acetylsalicylic/i, level: 'info', note: 'Low-dose aspirin may be intentional in obstetric protocols; confirm indication.' },
        { match: /statin|atorvastatin|rosuvastatin|simvastatin/i, level: 'danger', note: 'Statins contraindicated in pregnancy.' },
        { match: /finasteride|dutasteride/i, level: 'danger', note: 'Anti-androgen — contraindicated in pregnancy.' },
        { match: /retinoid|tretinoin|adapalene/i, level: 'danger', note: 'Systemic/topical retinoids — avoid in pregnancy.' },
        { match: /carbimazole|methimazole/i, level: 'warning', note: 'Prefer PTU in 1st trimester if antithyroid needed.' },
        { match: /lithium/i, level: 'warning', note: 'Cardiac malformation risk — specialist review required.' },
        { match: /phenytoin|carbamazepine/i, level: 'warning', note: 'Antiepileptic teratogenicity — specialist advice.' }
    ];

    function checkDrugName(name) {
        name = String(name || '');
        for (var i = 0; i < RULES.length; i++) {
            if (RULES[i].match.test(name)) {
                return { level: RULES[i].level, note: RULES[i].note, drug: name };
            }
        }
        return null;
    }

    function checkList(names) {
        var hits = [];
        (names || []).forEach(function (n) {
            var hit = checkDrugName(n);
            if (hit) hits.push(hit);
        });
        return hits;
    }

    function renderBanner(container, hits, isPregnant) {
        if (!container) return;
        if (!hits || !hits.length) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';
        var title = isPregnant
            ? 'Pregnancy safety alerts'
            : 'Drug safety alerts (confirm pregnancy status)';
        container.innerHTML = '<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px 14px;margin:10px 0;">'
            + '<strong style="color:#9a3412;"><i class="fa-solid fa-triangle-exclamation"></i> ' + title + '</strong>'
            + '<ul style="margin:8px 0 0 18px;color:#7c2d12;font-size:13px;">'
            + hits.map(function (h) {
                var color = h.level === 'danger' ? '#b91c1c' : (h.level === 'warning' ? '#c2410c' : '#1d4ed8');
                return '<li style="margin-bottom:4px;"><span style="color:' + color + ';font-weight:600;">' + escapeHtml(h.drug) + ':</span> ' + escapeHtml(h.note) + '</li>';
            }).join('')
            + '</ul><div style="font-size:11px;color:#9a3412;margin-top:6px;">Reference aid only — verify with current obstetric guidelines before prescribing.</div></div>';
    }

    window.drugSafety = { checkDrugName: checkDrugName, checkList: checkList, renderBanner: renderBanner, RULES: RULES };
})();
