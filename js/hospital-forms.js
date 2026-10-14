(function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', function() {
        function catalog(inputId, amountId, list, listId) {
            var input = document.getElementById(inputId), amount = document.getElementById(amountId);
            if (!input) return;
            var datalist = document.createElement('datalist');
            datalist.id = listId;
            list.forEach(function(item) { var option = document.createElement('option'); option.value = item.name; option.label = '₹' + item.price; datalist.appendChild(option); });
            document.body.appendChild(datalist); input.setAttribute('list', listId);
            input.addEventListener('input', function() {
                var test = list.find(function(item) { return item.name.toLowerCase() === input.value.trim().toLowerCase(); });
                if (test && amount) amount.value = test.price;
                if (test && test.type && document.getElementById('imgType')) document.getElementById('imgType').value = test.type;
            });
        }
        catalog('labTestName', 'labTestAmount', HOSPITAL_POLICY.labs, 'hospitalLabPrices');
        catalog('imgTestName', 'imgTestAmount', HOSPITAL_POLICY.imaging, 'hospitalImagingPrices');
        var type = document.getElementById('imgType');
        if (type) {
            type.innerHTML = '<option value="Ultrasound">Ultrasound / USG</option><option value="ECG">ECG</option><option value="CTG">CTG</option>';
            type.addEventListener('change', function() {
                if (!['ECG', 'CTG'].includes(type.value)) return;
                var input = document.getElementById('imgTestName');
                if (input) { input.value = type.value; input.dispatchEvent(new Event('input')); }
            });
        }
        var cert = document.getElementById('certNumberInput');
        if (cert) {
            var label = cert.parentElement.querySelector('label');
            if (label) label.textContent = 'Certificate number (Automatic)';
            var hint = document.getElementById('certLastNumberHint');
            if (hint) hint.textContent = 'A unique yearly number is reserved when the certificate is issued.';
        }
        var imagingFile = document.getElementById('reportPdfFile');
        if (imagingFile) {
            imagingFile.accept = 'application/pdf,image/jpeg,image/png';
            var label = imagingFile.parentElement.querySelector('label');
            if (label) label.textContent = 'Scanned report — PDF, JPG or PNG (under 20 MB)';
        }
        var labFile = document.getElementById('labPdfFile');
        if (labFile) {
            labFile.accept = 'application/pdf,image/jpeg,image/png';
            var label = labFile.parentElement.querySelector('label');
            if (label) label.textContent = 'Scanned lab report — PDF, JPG or PNG (under 10 MB)';
        }
    });
})();
