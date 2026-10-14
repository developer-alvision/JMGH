(function (root) {
    'use strict';
    var policy = {
        version: '2026-10-13',
        departments: ['Gynaecology', 'Surgery'],
        fees: { newOP: 300, freeReviewDays: 7, review: 100, generalAfterMonth: 200, generalAfterThreeMonths: 300, phoneSurcharge: 100 },
        labs: [
            ['CBC', 'CBC (Complete Blood Count)', 300], ['BloodGroup', 'Blood Group', 50],
            ['ESR', 'ESR', 100], ['HbA1c', 'HbA1c', 400], ['BTCT', 'BT / CT', 100],
            ['RBS', 'Random Blood Sugar (RBS)', 50], ['BSF', 'Fasting Blood Sugar (FBS)', 50],
            ['BSPP', 'Postprandial Blood Sugar (PPBS)', 50], ['Urea', 'Blood Urea', 100],
            ['Creatinine', 'Serum Creatinine', 100], ['Lipid', 'Lipid Profile', 300],
            ['Calcium', 'Serum Calcium', 150], ['VitaminD', 'Vitamin D', 900], ['VitaminB12', 'Vitamin B12', 900],
            ['CRP', 'CRP', 400], ['Widal', 'Widal', 100], ['Dengue', 'Dengue', 500],
            ['PT', 'PT', 400], ['APTT', 'APTT', 400], ['HIV', 'HIV', 300], ['HBsAg', 'HBsAg', 200],
            ['VDRL', 'VDRL', 200], ['HCV', 'HCV', 300], ['UPT', 'Urine Pregnancy Test (UPT)', 100],
            ['Urine', 'Complete Urine Examination (CUE)', 150], ['Thyroid', 'Thyroid Function Test (TFT)', 500],
            ['LH', 'Serum LH', 600], ['TSH', 'TSH', 600], ['Prolactin', 'Prolactin', 600],
            ['AMH', 'AMH', 1000], ['BetaHCG', 'Beta hCG', 500], ['Electrolytes', 'Serum Electrolytes', 400],
            ['OGTT', 'OGTT', 400], ['Semen', 'Semen Analysis', 1000], ['Malaria', 'MP Antigen', 200]
        ].map(function (row) { return { id: row[0], name: row[1], price: row[2], category: 'Lab' }; }),
        imaging: [
            { id: 'ECG', name: 'ECG', price: 500, type: 'ECG', category: 'Imaging' },
            { id: 'CTG', name: 'CTG', price: 500, type: 'CTG', category: 'Imaging' },
            { id: 'UltrasoundAbdomen', name: 'USG Abdomen', price: 500, type: 'Ultrasound', category: 'Imaging' },
            { id: 'VaginalScan', name: 'Vaginal Scan', price: 550, type: 'Ultrasound', category: 'Imaging' }
        ]
    };
    function day(value) {
        if (!value) return null;
        if (value.toDate) value = value.toDate();
        var match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        var date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
        if (isNaN(date.getTime())) return null;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }
    function addMonths(value, months) {
        var date = day(value), originalDay = date.getDate();
        date.setDate(1); date.setMonth(date.getMonth() + months);
        date.setDate(Math.min(originalDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
        return date;
    }
    // Follow-up eligibility is anchored to the last new/full-fee OP episode,
    // rather than extended indefinitely by each discounted review.
    function calculateFee(options) {
        options = options || {};
        var at = day(options.date) || day(new Date());
        var previous = day(options.lastVisitDate), anchor = day(options.episodeDate) || previous;
        var fee = policy.fees.newOP, reason = 'New OP';
        if (options.freeOP === true || options.freeOP === 'true') {
            return { amount: 0, base: 0, surcharge: 0, reason: 'Doctor fee waived', startsEpisode: false };
        }
        if (previous && previous <= at && options.visitType !== 'New') {
            var days = Math.round((at - previous) / 86400000);
            if (days <= policy.fees.freeReviewDays) {
                fee = 0; reason = 'Review within 7 days';
            } else if (options.isPregnant) {
                fee = 100; reason = 'Pregnancy review';
            } else if (anchor && at <= addMonths(anchor, 1)) {
                fee = 100; reason = 'General review within 1 month';
            } else if (anchor && at <= addMonths(anchor, 3)) {
                fee = 200; reason = 'General review after 1 month';
            } else { fee = 300; reason = 'General review after 3 months'; }
        }
        var surcharge = options.phone ? policy.fees.phoneSurcharge : 0;
        return { amount: fee + surcharge, base: fee, surcharge: surcharge, reason: reason + (surcharge ? ' + phone OP' : ''), startsEpisode: !previous || options.visitType === 'New' || (!options.isPregnant && anchor && at > addMonths(anchor, 3)) };
    }
    root.HOSPITAL_POLICY = policy;
    root.calculateHospitalOPFee = calculateFee;
    if (typeof module !== 'undefined' && module.exports) module.exports = { policy: policy, calculateFee: calculateFee };
})(typeof window !== 'undefined' ? window : globalThis);
