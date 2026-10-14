checkAccess(['lab_technician', 'doctor', 'nurse', 'admin', 'owner']);

let currentUserEmail = '';
let currentUserRole = '';
let allReports = [];
var selectedPatient_lab = null;
let activeReportDocId = null; // null for new, document ID when editing/completing a pending request

// ==========================================
// LAB MANUAL ENTRY CONFIG TEMPLATES (FIX 2)
// ==========================================
const LAB_TEMPLATES = {
    cbc: {
        title: "Complete Blood Count (CBC)",
        parameters: [
            { name: "Hemoglobin (Hb)", unit: "g/dL", min: 12.0, max: 16.0 },
            { name: "Total Leucocyte Count (TLC)", unit: "/cumm", min: 4000, max: 11000 },
            { name: "Red Blood Cell (RBC) Count", unit: "million/cumm", min: 4.0, max: 5.5 },
            { name: "Platelet Count", unit: "lakhs/cumm", min: 1.5, max: 4.5 },
            { name: "Packed Cell Volume (PCV)", unit: "%", min: 36.0, max: 48.0 },
            { name: "Mean Corpuscular Volume (MCV)", unit: "fL", min: 80, max: 100 },
            { name: "Neutrophils", unit: "%", min: 40, max: 75 }, { name: "Lymphocytes", unit: "%", min: 20, max: 45 },
            { name: "Eosinophils", unit: "%", min: 1, max: 6 }, { name: "Monocytes", unit: "%", min: 2, max: 10 },
            { name: "MCH", unit: "pg", min: 27, max: 32 }, { name: "MCHC", unit: "g/dL", min: 32, max: 36 }, { name: "ESR", unit: "mm/hr", min: 0, max: 20 }
        ]
    },
    hba1c: {
        title: "HbA1c (Glycated Haemoglobin)",
        parameters: [
            { name: "HbA1c", unit: "%", min: 4.0, max: 5.6 },
            { name: "Estimated Average Glucose (eAG)", unit: "mg/dL", min: 70, max: 116 }
        ]
    },
    fever: {
        title: "Fever Profile",
        parameters: [
            { name: "Malaria Parasite (Smear)", unit: "Result", rangeText: "Negative", isText: true },
            { name: "Widal Test (TO)", unit: "Titre", rangeText: "< 1:80", isText: true },
            { name: "Widal Test (TH)", unit: "Titre", rangeText: "< 1:80", isText: true },
            { name: "Dengue NS1 Antigen", unit: "Result", rangeText: "Negative", isText: true },
            { name: "Typhidot IgM", unit: "Result", rangeText: "Negative", isText: true }
        ]
    },
    lipid: {
        title: "Lipid Profile",
        parameters: [
            { name: "Total Cholesterol", unit: "mg/dL", min: 100, max: 200 },
            { name: "Triglycerides", unit: "mg/dL", min: 50, max: 150 },
            { name: "HDL Cholesterol (Good)", unit: "mg/dL", min: 40, max: 60 },
            { name: "LDL Cholesterol (Bad)", unit: "mg/dL", min: 50, max: 100 },
            { name: "VLDL Cholesterol", unit: "mg/dL", min: 5, max: 30 }
        ]
    },
    thyroid: {
        title: "Thyroid Profile",
        parameters: [
            { name: "Triiodothyronine (T3)", unit: "ng/mL", min: 0.8, max: 2.0 },
            { name: "Thyroxine (T4)", unit: "ug/dL", min: 4.8, max: 12.7 },
            { name: "Thyroid Stimulating Hormone (TSH)", unit: "uIU/mL", min: 0.27, max: 4.2 }
        ]
    },
    sugar: {
        title: "Blood Sugar (Fasting & PP)",
        parameters: [
            { name: "Fasting Blood Sugar", unit: "mg/dL", min: 70, max: 100 },
            { name: "Post Prandial Blood Sugar (PPBS)", unit: "mg/dL", min: 70, max: 140 }
        ]
    },
    urine: {
        title: "Urine Routine Examination",
        parameters: [
            { name: "Urine Colour", unit: "Visual", rangeText: "Pale Yellow", isText: true },
            { name: "Transparency", unit: "Visual", rangeText: "Clear", isText: true },
            { name: "pH", unit: "pH", min: 4.5, max: 8.0 },
            { name: "Specific Gravity", unit: "SG", min: 1.005, max: 1.030 },
            { name: "Urine Protein (Albumin)", unit: "Qualitative", rangeText: "Nil", isText: true },
            { name: "Urine Glucose (Sugar)", unit: "Qualitative", rangeText: "Nil", isText: true }
        ]
    },
    lft: {
        title: "Liver Function Test (LFT)",
        parameters: [
            { name: "Bilirubin Total", unit: "mg/dL", min: 0.2, max: 1.2 },
            { name: "Bilirubin Direct", unit: "mg/dL", min: 0.0, max: 0.3 },
            { name: "SGOT (AST)", unit: "U/L", min: 5, max: 40 },
            { name: "SGPT (ALT)", unit: "U/L", min: 5, max: 45 },
            { name: "Alkaline Phosphatase (ALP)", unit: "U/L", min: 40, max: 140 },
            { name: "Total Protein", unit: "g/dL", min: 6.0, max: 8.3 },
            { name: "Albumin", unit: "g/dL", min: 3.5, max: 5.0 }
        ]
    },
    kft: {
        title: "Kidney Function Test (KFT)",
        parameters: [
            { name: "Urea", unit: "mg/dL", min: 15, max: 45 },
            { name: "Creatinine", unit: "mg/dL", min: 0.6, max: 1.2 },
            { name: "Uric Acid", unit: "mg/dL", min: 3.5, max: 7.2 },
            { name: "Blood Urea Nitrogen (BUN)", unit: "mg/dL", min: 8, max: 23 }
        ]
    },
    electrolytes: {
        title: "Serum Electrolytes",
        parameters: [
            { name: "Sodium (Na+)", unit: "mmol/L", min: 135, max: 145 },
            { name: "Potassium (K+)", unit: "mmol/L", min: 3.5, max: 5.1 },
            { name: "Chloride (Cl-)", unit: "mmol/L", min: 96, max: 106 }
        ]
    },
    antenatal_profile: {
        title: "Antenatal Profile",
        parameters: [
            { name: "Blood Group", unit: "", rangeText: "As reported", isText: true }, { name: "Hb", unit: "g/dL", min: 11, max: 16 },
            { name: "HIV", unit: "Result", rangeText: "Non-reactive", isText: true }, { name: "HBsAg", unit: "Result", rangeText: "Non-reactive", isText: true },
            { name: "VDRL", unit: "Result", rangeText: "Non-reactive", isText: true }, { name: "Blood Sugar", unit: "mg/dL", min: 70, max: 140 },
            { name: "Urine Albumin", unit: "Result", rangeText: "Nil", isText: true }, { name: "TSH", unit: "uIU/mL", min: 0.27, max: 4.2 }
        ]
    },
    ogtt: {
        title: "OGTT (Glucose Tolerance)",
        parameters: [ { name: "Fasting Glucose", unit: "mg/dL", min: 70, max: 92 }, { name: "1 Hour Glucose", unit: "mg/dL", min: 70, max: 180 }, { name: "2 Hour Glucose", unit: "mg/dL", min: 70, max: 153 } ]
    },
    double_marker: {
        title: "Double Marker",
        parameters: [ { name: "Free beta-hCG", unit: "IU/L", rangeText: "As per gestational age", isText: true }, { name: "PAPP-A", unit: "mIU/mL", rangeText: "As per gestational age", isText: true }, { name: "Risk Assessment", unit: "Result", rangeText: "As reported", isText: true } ]
    },
    blood_sugar_complete: { title: "Blood Sugar (Fasting, PP & Random)", parameters: [{ name:"Fasting", unit:"mg/dL", min:70,max:100 },{ name:"Post Prandial",unit:"mg/dL",rangeText:"<140",isText:true},{ name:"Random",unit:"mg/dL",rangeText:"<140",isText:true}] },
    lipid_complete: { title: "Lipid Profile (Complete)", parameters: [{name:"Total Cholesterol",unit:"mg/dL",rangeText:"<200",isText:true},{name:"HDL",unit:"mg/dL",rangeText:">40",isText:true},{name:"LDL",unit:"mg/dL",rangeText:"<100",isText:true},{name:"VLDL",unit:"mg/dL",min:5,max:40},{name:"Triglycerides",unit:"mg/dL",rangeText:"<150",isText:true},{name:"Total/HDL Ratio",unit:"",rangeText:"As reported",isText:true}] },
    lft_complete: { title: "Liver Function Test (Complete)", parameters: [{name:"Bilirubin Total",unit:"mg/dL",min:0.3,max:1.2},{name:"Bilirubin Direct",unit:"mg/dL",min:0,max:0.3},{name:"SGOT/AST",unit:"U/L",min:5,max:40},{name:"SGPT/ALT",unit:"U/L",min:5,max:40},{name:"Alkaline Phosphatase",unit:"U/L",min:40,max:130},{name:"Total Protein",unit:"g/dL",min:6,max:8},{name:"Albumin",unit:"g/dL",min:3.5,max:5.5},{name:"Globulin",unit:"g/dL",min:2,max:3.5}] },
    kft_complete: { title: "Kidney Function Test (Complete)", parameters: [{name:"Urea",unit:"mg/dL",min:15,max:40},{name:"BUN",unit:"mg/dL",min:7,max:20},{name:"Creatinine",unit:"mg/dL",min:0.6,max:1.3},{name:"Uric Acid",unit:"mg/dL",min:3.5,max:7.2}] },
    electrolytes_complete: { title: "Electrolytes (Complete)", parameters: [{name:"Sodium",unit:"mEq/L",min:135,max:145},{name:"Potassium",unit:"mEq/L",min:3.5,max:5.1},{name:"Chloride",unit:"mEq/L",min:98,max:107},{name:"Calcium",unit:"mg/dL",min:8.5,max:10.5}] },
    thyroid_complete: { title: "Thyroid Profile (Complete)", parameters: [{name:"T3",unit:"ng/dL",min:80,max:200},{name:"T4",unit:"µg/dL",min:5,max:12},{name:"TSH",unit:"µIU/mL",min:0.4,max:4}] },
    urine_complete: { title: "Urine Routine (Complete)", parameters: [{name:"Colour",unit:"",rangeText:"Pale Yellow",isText:true},{name:"Appearance",unit:"",rangeText:"Clear",isText:true},{name:"pH",unit:"",min:5,max:8},{name:"Specific Gravity",unit:"",min:1.005,max:1.030},{name:"Albumin",unit:"",rangeText:"Nil",isText:true},{name:"Sugar",unit:"",rangeText:"Nil",isText:true},{name:"Pus Cells",unit:"/hpf",min:0,max:5},{name:"RBC",unit:"/hpf",min:0,max:2},{name:"Epithelial Cells",unit:"",rangeText:"Few",isText:true},{name:"Casts",unit:"",rangeText:"Nil",isText:true},{name:"Crystals",unit:"",rangeText:"Nil",isText:true}] },
    widal: { title:"Widal Test", parameters:[{name:"S. typhi O",unit:"Titre",rangeText:"As reported",isText:true},{name:"S. typhi H",unit:"Titre",rangeText:"As reported",isText:true},{name:"S. paratyphi AH",unit:"Titre",rangeText:"As reported",isText:true},{name:"S. paratyphi BH",unit:"Titre",rangeText:"As reported",isText:true}] },
    dengue: { title:"Dengue", parameters:[{name:"NS1 Antigen",unit:"Result",rangeText:"Negative",isText:true},{name:"IgG",unit:"Result",rangeText:"Negative",isText:true},{name:"IgM",unit:"Result",rangeText:"Negative",isText:true}] },
    malaria: { title:"Malaria", parameters:[{name:"Rapid Antigen",unit:"Result",rangeText:"Negative",isText:true},{name:"Smear",unit:"Result",rangeText:"Negative",isText:true}] },
    crp: { title:"CRP", parameters:[{name:"CRP",unit:"mg/L",min:0,max:6}] },
    coagulation: { title:"Coagulation Profile", parameters:[{name:"PT",unit:"sec",min:11,max:13.5},{name:"INR",unit:"",min:0.8,max:1.1},{name:"APTT",unit:"sec",min:25,max:35}] },
    triple_marker: { title:"Triple Marker", parameters:[{name:"AFP",unit:"MoM",rangeText:"As reported",isText:true},{name:"hCG",unit:"MoM",rangeText:"As reported",isText:true},{name:"uE3",unit:"MoM",rangeText:"As reported",isText:true},{name:"Risk",unit:"",rangeText:"As reported",isText:true}] },
    quadruple_marker: { title:"Quadruple Marker", parameters:[{name:"AFP",unit:"MoM",rangeText:"As reported",isText:true},{name:"hCG",unit:"MoM",rangeText:"As reported",isText:true},{name:"uE3",unit:"MoM",rangeText:"As reported",isText:true},{name:"Inhibin-A",unit:"MoM",rangeText:"As reported",isText:true},{name:"Risk",unit:"",rangeText:"As reported",isText:true}] },
    torch: { title:"TORCH Panel", parameters:["Toxoplasma IgG","Toxoplasma IgM","Rubella IgG","Rubella IgM","CMV IgG","CMV IgM","HSV IgG","HSV IgM"].map(function(name){return {name:name,unit:"Result",rangeText:"Negative",isText:true};}) },
    coombs: { title:"Coombs Test", parameters:[{name:"Direct",unit:"Result",rangeText:"Negative",isText:true},{name:"Indirect",unit:"Result",rangeText:"Negative",isText:true}] },
    pediatric_cbc: { title:"Pediatric CBC", parameters:[{name:"Haemoglobin",unit:"g/dL",min:11,max:14},{name:"WBC",unit:"cells/cumm",min:5000,max:15000},{name:"Platelets",unit:"lakh/cumm",min:1.5,max:4.5},{name:"Note",unit:"",rangeText:"Ranges vary by age",isText:true}] },
    mantoux: { title:"Mantoux / TB Test", parameters:[{name:"Induration",unit:"mm",rangeText:"As reported",isText:true}] },
    stool_routine: { title:"Stool Routine", parameters:["Colour","Consistency","Ova","Cyst","Pus Cells","RBC","Occult Blood"].map(function(name){return {name:name,unit:"",rangeText:"As reported",isText:true};}) },
    newborn_screening: { title:"Newborn Screening", parameters:[{name:"TSH",unit:"",rangeText:"Newborn reference",isText:true},{name:"G6PD",unit:"",rangeText:"As reported",isText:true},{name:"Phenylketonuria (PKU)",unit:"",rangeText:"Negative",isText:true},{name:"Congenital Hypothyroidism screen",unit:"",rangeText:"Negative",isText:true}] },
    newborn_bilirubin: { title:"Newborn Bilirubin (Jaundice)", parameters:[{name:"Total Bilirubin",unit:"mg/dL",rangeText:"Age-specific",isText:true},{name:"Direct Bilirubin",unit:"mg/dL",rangeText:"Age-specific",isText:true},{name:"Indirect Bilirubin",unit:"mg/dL",rangeText:"Age-specific",isText:true}] },
    cord_blood: { title:"Cord Blood", parameters:[{name:"Blood Group & Rh",unit:"",rangeText:"As reported",isText:true},{name:"Direct Coombs",unit:"Result",rangeText:"Negative",isText:true},{name:"Haemoglobin",unit:"g/dL",min:14,max:20},{name:"Bilirubin",unit:"mg/dL",rangeText:"As reported",isText:true}] },
    blood_group_rh: { title:"Blood Group & Rh Typing", parameters:[{name:"ABO Group",unit:"",rangeText:"As reported",isText:true},{name:"Rh Factor",unit:"",rangeText:"As reported",isText:true}] },
    widal_pediatric: { title:"Widal (Pediatric)", parameters:[{name:"S. typhi O",unit:"Titre",rangeText:"As reported",isText:true},{name:"S. typhi H",unit:"Titre",rangeText:"As reported",isText:true},{name:"S. paratyphi AH",unit:"Titre",rangeText:"As reported",isText:true},{name:"S. paratyphi BH",unit:"Titre",rangeText:"As reported",isText:true}] },
    blood_sugar_pediatric: { title:"Blood Sugar (Pediatric)", parameters:[{name:"Fasting",unit:"mg/dL",min:70,max:100},{name:"Post Prandial",unit:"mg/dL",rangeText:"<140",isText:true},{name:"Random",unit:"mg/dL",rangeText:"<140",isText:true}] },
    urine_pediatric: { title:"Urine Routine (Pediatric)", parameters:[{name:"Colour",unit:"",rangeText:"Pale Yellow",isText:true},{name:"Appearance",unit:"",rangeText:"Clear",isText:true},{name:"pH",unit:"",min:5,max:8},{name:"Specific Gravity",unit:"",min:1.005,max:1.030},{name:"Albumin",unit:"",rangeText:"Nil",isText:true},{name:"Sugar",unit:"",rangeText:"Nil",isText:true},{name:"Pus Cells",unit:"/hpf",min:0,max:5},{name:"RBC",unit:"/hpf",min:0,max:2}] }
};

document.addEventListener('DOMContentLoaded', function() {
    var select = document.getElementById('labTemplateSelect'); if (!select) return;
    Object.keys(LAB_TEMPLATES).forEach(function(key) { if (!select.querySelector('option[value="' + key + '"]')) { var option = document.createElement('option'); option.value = key; option.textContent = LAB_TEMPLATES[key].title; select.appendChild(option); } });
});

function switchLabModalTab(tabId) {
    const tabEnter = document.getElementById('tabEnterResultsBtn');
    const tabUpload = document.getElementById('tabUploadFileBtn');
    const enterContainer = document.getElementById('tabEnterResultsContainer');
    const uploadContainer = document.getElementById('tabUploadFileContainer');
    
    if (!tabEnter || !tabUpload || !enterContainer || !uploadContainer) return;
    
    if (tabId === 'enter') {
        tabEnter.classList.add('active');
        tabEnter.style.color = 'var(--primary-teal)';
        tabEnter.style.borderBottom = '2px solid var(--primary-teal)';
        
        tabUpload.classList.remove('active');
        tabUpload.style.color = '#64748b';
        tabUpload.style.borderBottom = 'none';
        
        enterContainer.style.display = 'block';
        uploadContainer.style.display = 'none';
        
        document.getElementById('labUploadMode').value = 'entered';
    } else {
        tabUpload.classList.add('active');
        tabUpload.style.color = 'var(--primary-teal)';
        tabUpload.style.borderBottom = '2px solid var(--primary-teal)';
        
        tabEnter.classList.remove('active');
        tabEnter.style.color = '#64748b';
        tabEnter.style.borderBottom = 'none';
        
        uploadContainer.style.display = 'block';
        enterContainer.style.display = 'none';
        
        const isPanel = document.getElementById('panelFields').style.display !== 'none';
        document.getElementById('labUploadMode').value = isPanel ? 'panel' : 'single';
    }
}
window.switchLabModalTab = switchLabModalTab;

function renderTemplateParameters(templateKey) {
    const tbody = document.getElementById('labParamsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!templateKey || !LAB_TEMPLATES[templateKey]) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 12px;">Select a template or click "Add Custom Row" to start.</td></tr>';
        return;
    }
    
    const template = LAB_TEMPLATES[templateKey];
    template.parameters.forEach((param, index) => {
        addLabParamRow(param.name, "", param.unit, param.isText ? param.rangeText : `${param.min} - ${param.max}`, param.min, param.max, param.isText, param.rangeText);
    });
}
window.renderTemplateParameters = renderTemplateParameters;

function addLabParamRow(name, val, unit, rangeText, min, max, isText, expectedText) {
    const tbody = document.getElementById('labParamsTableBody');
    if (!tbody) return;
    
    if (tbody.rows.length === 1 && tbody.rows[0].cells.length === 1) {
        tbody.innerHTML = '';
    }
    
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #f1f5f9';
    
    const rowId = 'row_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    tr.id = rowId;
    
    const nameVal = name || '';
    const valVal = val || '';
    const unitVal = unit || '';
    const rangeVal = rangeText || '';
    const minAttr = min !== undefined ? min : '';
    const maxAttr = max !== undefined ? max : '';
    const isTextAttr = isText ? 'true' : 'false';
    const expectedAttr = expectedText || '';
    
    tr.innerHTML = `
        <td style="padding: 6px 8px;"><input type="text" class="lab-p-name" value="${escapeHtml(nameVal)}" style="width:100%; border:1px solid #ddd; border-radius:4px; padding:4px;" placeholder="Parameter"></td>
        <td style="padding: 6px 8px; text-align:center;"><input type="text" class="lab-p-result" value="${escapeHtml(valVal)}" style="width:70px; border:1px solid #ddd; border-radius:4px; padding:4px; text-align:center;" placeholder="Result" oninput="updateLabParamFlag('${rowId}')"></td>
        <td style="padding: 6px 8px; text-align:center;"><input type="text" class="lab-p-unit" value="${escapeHtml(unitVal)}" style="width:60px; border:1px solid #ddd; border-radius:4px; padding:4px; text-align:center;" placeholder="Unit"></td>
        <td style="padding: 6px 8px; text-align:center;"><input type="text" class="lab-p-range" value="${escapeHtml(rangeVal)}" style="width:90px; border:1px solid #ddd; border-radius:4px; padding:4px; text-align:center;" placeholder="Range" data-min="${minAttr}" data-max="${maxAttr}" data-istext="${isTextAttr}" data-expected="${escapeHtml(expectedAttr)}"></td>
        <td style="padding: 6px 8px; text-align:center; font-weight:600;" class="lab-p-flag"></td>
        <td style="padding: 6px 8px; text-align:center;">
            <button type="button" class="btn-cancel" onclick="document.getElementById('${rowId}').remove(); checkLabParamsEmpty();" style="padding: 2px 6px; font-size: 11px; border-radius: 4px; color: red; border-color: red; background: none; cursor: pointer;">
                <i class="fa-solid fa-trash"></i>
            </button>
        </td>
    `;
    
    tbody.appendChild(tr);
    if (valVal) {
        updateLabParamFlag(rowId);
    }
}
window.addLabParamRow = addLabParamRow;

function updateLabParamFlag(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    
    const resultEl = row.querySelector('.lab-p-result');
    const rangeEl = row.querySelector('.lab-p-range');
    const flagEl = row.querySelector('.lab-p-flag');
    if (!resultEl || !rangeEl || !flagEl) return;
    
    const val = resultEl.value.trim();
    if (!val) {
        flagEl.textContent = '';
        flagEl.style.color = 'inherit';
        return;
    }
    
    const isText = rangeEl.dataset.istext === 'true';
    const expected = rangeEl.dataset.expected || '';
    let min = parseFloat(rangeEl.dataset.min);
    let max = parseFloat(rangeEl.dataset.max);
    
    if (isNaN(min) || isNaN(max)) {
        const match = rangeEl.value.match(/([0-9.]+)\s*-\s*([0-9.]+)/);
        if (match) {
            min = parseFloat(match[1]);
            max = parseFloat(match[2]);
        }
    }
    
    let flag = 'Normal';
    if (isText) {
        if (expected && val.toLowerCase().replace(/[^a-z0-9]/g, '') !== expected.toLowerCase().replace(/[^a-z0-9]/g, '')) {
            flag = 'Abnormal';
        }
    } else {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
            if (!isNaN(min) && numVal < min) {
                flag = 'Low';
            } else if (!isNaN(max) && numVal > max) {
                flag = 'High';
            }
        } else {
            flag = '';
        }
    }
    
    flagEl.textContent = flag;
    if (flag === 'High' || flag === 'Abnormal') {
        flagEl.style.color = '#dc2626';
    } else if (flag === 'Low') {
        flagEl.style.color = '#d97706';
    } else if (flag === 'Normal') {
        flagEl.style.color = '#10b981';
    } else {
        flagEl.style.color = 'inherit';
    }
}
window.updateLabParamFlag = updateLabParamFlag;

function checkLabParamsEmpty() {
    const tbody = document.getElementById('labParamsTableBody');
    if (tbody && tbody.rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 12px;">Select a template or click "Add Custom Row" to start.</td></tr>';
    }
}
window.checkLabParamsEmpty = checkLabParamsEmpty;

function autoSelectTemplate(testName) {
    if (!testName) return;
    const name = testName.toLowerCase().trim();
    const select = document.getElementById('labTemplateSelect');
    if (!select) return;
    
    if (name.includes('cbc') || name.includes('complete blood count')) {
        select.value = 'cbc';
    } else if (name.includes('hba1c') || name.includes('glycated')) {
        select.value = 'hba1c';
    } else if (name.includes('fever')) {
        select.value = 'fever';
    } else if (name.includes('lipid')) {
        select.value = 'lipid';
    } else if (name.includes('thyroid')) {
        select.value = 'thyroid';
    } else if (name.includes('sugar') || name.includes('glucose')) {
        select.value = 'sugar';
    } else if (name.includes('urine')) {
        select.value = 'urine';
    } else if (name.includes('lft') || name.includes('liver')) {
        select.value = 'lft';
    } else if (name.includes('kft') || name.includes('kidney') || name.includes('renal')) {
        select.value = 'kft';
    } else if (name.includes('electrolyte')) {
        select.value = 'electrolytes';
    } else {
        select.value = '';
    }
    
    renderTemplateParameters(select.value);
}
window.autoSelectTemplate = autoSelectTemplate;

getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    currentUserRole = (user.role || '').toLowerCase();
    
    // Toggle Pending Requests sections based on role
    const pendingRequestsContainer = document.getElementById('pendingRequestsContainer');
    if (pendingRequestsContainer) {
        if (['lab_technician', 'admin', 'owner', 'doctor'].includes(currentUserRole)) {
            pendingRequestsContainer.style.display = 'block';
            loadPendingRequests();
        } else {
            pendingRequestsContainer.style.display = 'none';
        }
    }
    
    const pendingLabWorkContainer = document.getElementById('pendingLabWorkContainer');
    if (pendingLabWorkContainer) {
        if (['lab_technician', 'admin', 'owner'].includes(currentUserRole)) {
            pendingLabWorkContainer.style.display = 'block';
            loadPendingLabWork();
        } else {
            pendingLabWorkContainer.style.display = 'none';
        }
    }
    
    // Hide billing elements for non-billing roles (FIX 1)
    const isBillingRole = ['receptionist', 'billing_staff', 'admin', 'pharmacist', 'owner'].includes(currentUserRole);
    if (!isBillingRole) {
        const filterGroup = document.getElementById('billingFilterGroup');
        if (filterGroup) filterGroup.style.display = 'none';
        document.querySelectorAll('.billing-col').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.lab-amount-group').forEach(el => el.style.display = 'none');
    }
    
    // Make sure default tab is Tab A when opening modal
    switchLabModalTab('enter');
    
    loadReports();

    // Auto-open upload modal from patient profile quick actions
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autoOpen') === 'true') {
        var uploadReportModal = document.getElementById('uploadReportModal');
        if (uploadReportModal) uploadReportModal.classList.add('active');
        var prePatientId = urlParams.get('patientId');
        if (prePatientId) {
            firebase.firestore().collection('patients')
            .where('patientId', '==', prePatientId)
            .get()
            .then(function(snap) {
                if (!snap.empty) {
                    var doc = snap.docs[0];
                    var p = doc.data();
                    document.getElementById('lab_patientSearchInput').value = p.name + ' — ' + p.patientId;
                    selectedPatient_lab = { 
                        patientId: p.patientId, 
                        docId: doc.id,
                        name: p.name, 
                        doctor: p.doctor || p.doctorName || p.assignedDoctor || '',
                        phone: p.phone || '',
                        department: p.department || '',
                        age: p.age || '',
                        gender: p.gender || ''
                    };
                    document.getElementById('lab_cardPatientName').textContent = p.name;
                    document.getElementById('lab_cardPatientId').textContent = p.patientId;
                    var ageGenderEl = document.getElementById('lab_cardAgeGender');
                    if (ageGenderEl) ageGenderEl.textContent = (p.age || '—') + ' / ' + (p.gender || '—');
                    if (typeof loadDoctors_lab === 'function') {
                        loadDoctors_lab(p.doctor || p.doctorName || p.assignedDoctor || '');
                    }
                    var deptSelect = document.getElementById('lab_deptSelect');
                    if (deptSelect) deptSelect.value = p.department || '';
                    document.getElementById('lab_selectedPatientCard').style.display = 'block';
                }
            });
        }
    }
});

// ==========================================
// 1. PENDING REQUESTS PANEL (PART 6)
// ==========================================
function loadPendingRequests() {
    const tbody = document.getElementById('pendingRequestsTableBody');
    if (!tbody) return;

    function renderSnap(snap) {
        tbody.innerHTML = '';
        var rows = [];
        snap.forEach(function (doc) {
            var r = doc.data();
            var st = String(r.status || '').toLowerCase();
            var billSt = String(r.billingStatus || 'unpaid').toLowerCase();
            if (st !== 'pending') return;
            if (billSt !== 'unpaid' && billSt !== 'unbilled') return;
            rows.push({ id: doc.id, r: r });
        });
        if (!rows.length) {
            setEmptyRow('pendingRequestsTableBody', 'No doctor-ordered tests awaiting billing.', 6);
            return;
        }
        rows.forEach(function (row) {
            var r = row.r;
            var tr = document.createElement('tr');
            var dateVal = r.createdAt ? formatDate(r.createdAt) : '—';
            tr.innerHTML = `
                <td><strong>${escapeHtml(r.patientName || '—')}</strong></td>
                <td>${escapeHtml(r.patientId || '—')}</td>
                <td>${escapeHtml(r.testName || '—')}</td>
                <td><span style="font-family: monospace; background: #f8fafc; padding: 2px 6px; border: 1px solid #e2e8f0;">${escapeHtml(r.linkedBillId || 'Unbilled')}</span></td>
                <td>${escapeHtml(dateVal)}</td>
                <td><span style="font-size:12px;color:#64748b;">Awaiting billing desk</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    db.collection('reports')
        .where('type', '==', 'lab')
        .where('status', '==', 'pending')
        .onSnapshot(renderSnap, function (err) {
            console.error('Error loading pending requests:', err);
            // Fallback without composite filter
            db.collection('reports').where('type', '==', 'lab').get().then(renderSnap)
                .catch(function (e2) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red; padding: 20px;">Error: ' + escapeHtml(e2.message) + '</td></tr>';
                });
        });
}

function openUploadForPending(docId) {
    activeReportDocId = docId;
    clearPatient_lab();
    
    db.collection('reports').doc(docId).get()
    .then(docSnap => {
        if (!docSnap.exists) {
            showToast("Report request not found.", "error");
            return;
        }
        const report = docSnap.data();
        
        // Find patient details
        db.collection('patients').where('patientId', '==', report.patientId).get()
        .then(snap => {
            if (!snap.empty) {
                const pDoc = snap.docs[0];
                const pData = pDoc.data();
                selectedPatient_lab = {
                    docId: pDoc.id,
                    patientId: pData.patientId,
                    name: pData.name,
                    doctor: pData.doctor || '',
                    department: pData.department || '',
                    phone: pData.phone || '',
                    age: pData.age || '',
                    gender: pData.gender || ''
                };
                
                // Pre-fill selected patient card
                document.getElementById('lab_patientSearchInput').value = selectedPatient_lab.name + ' — ' + selectedPatient_lab.patientId;
                document.getElementById('lab_cardPatientName').textContent = selectedPatient_lab.name;
                document.getElementById('lab_cardPatientId').textContent = selectedPatient_lab.patientId;
                document.getElementById('lab_cardAgeGender').textContent = (selectedPatient_lab.age || '—') + ' / ' + (selectedPatient_lab.gender || '—');
                
                loadDoctors_lab(report.referredBy || selectedPatient_lab.doctor);
                var deptSelect = document.getElementById('lab_deptSelect');
                if (deptSelect) deptSelect.value = report.visitDepartment || selectedPatient_lab.department || '';
                document.getElementById('lab_selectedPatientCard').style.display = 'block';
            } else {
                // Mock simple selected patient
                selectedPatient_lab = {
                    docId: '',
                    patientId: report.patientId,
                    name: report.patientName,
                    doctor: report.referredBy || '',
                    department: report.visitDepartment || '',
                    phone: '', age: '', gender: ''
                };
            }
            
            // Set Tab A as default & auto select template (FIX 2)
            switchLabModalTab('enter');
            autoSelectTemplate(report.testName || '');
            
            const nowLocalStr = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0, 16);
            document.getElementById('labSampleCollectedAt').value = nowLocalStr;
            document.getElementById('labReportedAt').value = nowLocalStr;
            document.getElementById('labRemarks').value = '';

            // Set Single Test Mode & Pre-fill test details
            if (document.getElementById('btnSingleTestMode')) {
                document.getElementById('btnSingleTestMode').click();
            }
            
            document.getElementById('labTestName').value = report.testName || '';
            document.getElementById('labTestAmount').value = report.amount || 0;
            document.getElementById('labTestDate').value = todayIso();
            document.getElementById('labStatus').value = 'ready'; // Pending requests are uploaded as ready
            document.getElementById('labNotes').value = report.notes || '';
            
            // Pre-select doctor in referred dropdown
            if (document.getElementById('labReferredBy')) {
                document.getElementById('labReferredBy').value = report.referredBy || '';
            }
            
            // Open upload modal
            document.getElementById('uploadReportModal').classList.add('active');
        });
    })
    .catch(err => {
        console.error("Error setting up pending upload:", err);
        showToast("Error retrieving pending request details.", "error");
    });
}
window.openUploadForPending = openUploadForPending;

// ==========================================
// 1B. PENDING LAB WORK FROM BILLING QUEUE (CHANGE 2, 3)
// ==========================================
function getOrdinal(n) {
    var s = ["th", "st", "nd", "rd"],
        v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function loadPendingLabWork() {
    var tbody = document.getElementById('pendingLabBody');
    var countEl = document.getElementById('pendingLabCount');
    if (!tbody) return;

    function renderQueue(snap) {
        if (countEl) countEl.textContent = snap.size + ' pending';
        if (snap.empty) {
            setEmptyRow('pendingLabBody', 'No pending lab work from billed orders.', 8);
            return;
        }
        var html = '';
        var idx = 1;
        snap.forEach(doc => {
            var q = doc.data();
            var pos = getOrdinal(idx++);
            var dateVal = q.createdAt ? formatDate(q.createdAt) : '—';
            var queueJson = JSON.stringify({
                queueDocId: doc.id,
                billDocId: q.billDocId,
                billId: q.billId,
                patientId: q.patientId,
                patientName: q.patientName,
                doctor: q.visitDoctor || '',
                testName: q.testName || '',
                amount: q.amount || 0,
                labNotes: q.labNotes || ''
            }).replace(/"/g, '&quot;');
            var isEmergency = q.isEmergency === true || q.isEmergency === 'true';
            var rowStyle = isEmergency ? 'background:#fafafa; border-bottom:1px solid #e2e8f0;' : 'border-bottom:1px solid #E2E8F0;';
            var badgeHtml = isEmergency ? ' <span class="status-badge" style="font-size:10px;">STAT</span>' : '';
            html += '<tr style="' + rowStyle + '">';
            html += '<td style="padding:10px 14px;font-weight:600;">' + pos + badgeHtml + '</td>';
            html += '<td style="padding:10px 14px;">' + escapeHtml(q.billId || '—') + '</td>';
            html += '<td style="padding:10px 14px;">' + escapeHtml(q.patientName || '') + '<br><small style="color:#666;">' + escapeHtml(q.patientId || '') + '</small></td>';
            html += '<td style="padding:10px 14px;">' + escapeHtml(q.visitDoctor || '') + '</td>';
            html += '<td style="padding:10px 14px;font-weight:500;">' + escapeHtml(q.testName || '') + '</td>';
            html += '<td style="padding:10px 14px;font-size:12px;color:#666;">' + escapeHtml(q.labNotes || '—') + '</td>';
            html += '<td style="padding:10px 14px;">' + escapeHtml(dateVal) + '</td>';
            html += '<td style="padding:10px 14px;"><button onclick="startLabUploadQueue(' + queueJson + ')" class="btn-primary" style="padding:7px 14px;font-size:12px;"><i class="fa-solid fa-upload"></i> Upload</button></td>';
            html += '</tr>';
        });
        tbody.innerHTML = html;
    }

    db.collection('labQueue')
    .where('reportStatus', '==', 'pending')
    .orderBy('isEmergency', 'desc')
    .orderBy('createdAt', 'asc')
    .onSnapshot(renderQueue, function (err) {
        console.warn('Pending lab queue composite query failed, falling back:', err.message);
        db.collection('labQueue').where('reportStatus', '==', 'pending')
            .onSnapshot(renderQueue, function (err2) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:red;">Error: ' + escapeHtml(err2.message) + '</td></tr>';
            });
    });
}
window.loadPendingLabWork = loadPendingLabWork;

function startLabUploadQueue(data) {
    window.currentQueueData = data;
    // Pre-fill patient in upload modal
    document.getElementById('lab_patientSearchInput').value = data.patientName + ' — ' + data.patientId;
    selectedPatient_lab = { patientId: data.patientId, name: data.patientName, doctor: data.doctor };
    document.getElementById('lab_cardPatientName').textContent = data.patientName;
    document.getElementById('lab_cardPatientId').textContent = data.patientId;
    document.getElementById('lab_selectedPatientCard').style.display = 'block';

    // Pre-fill referred doctor list
    loadDoctors_lab(data.doctor);

    // Set Tab A as default & auto select template (FIX 2)
    switchLabModalTab('enter');
    autoSelectTemplate(data.testName || '');
    
    const nowLocalStr = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0, 16);
    document.getElementById('labSampleCollectedAt').value = nowLocalStr;
    document.getElementById('labReportedAt').value = nowLocalStr;
    document.getElementById('labRemarks').value = '';

    // Pre-fill test name from queue
    if (document.getElementById('btnSingleTestMode')) {
        document.getElementById('btnSingleTestMode').click();
    }
    document.getElementById('labTestName').value = data.testName;
    document.getElementById('labTestAmount').value = data.amount || 0;

    // Show lab notes from reception
    if (data.labNotes) {
        var notesEl = document.getElementById('labNotesFromReception');
        if (notesEl) {
            notesEl.textContent = 'Notes from reception: ' + data.labNotes;
            notesEl.style.display = 'block';
        }
    } else {
        var notesEl = document.getElementById('labNotesFromReception');
        if (notesEl) notesEl.style.display = 'none';
    }

    // Open modal
    document.getElementById('uploadReportModal').classList.add('active');
}
window.startLabUploadQueue = startLabUploadQueue;

// ==========================================
// 2. REPORT LOADER & REALTIME SNAPSHOT
// ==========================================
function loadReports() {
    db.collection('reports')
        .where('type', '==', 'lab')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snap => {
            allReports = [];
            snap.forEach(doc => {
                allReports.push({ id: doc.id, ...doc.data() });
            });
            applyFilters();
        }, err => {
            console.error("Error loading lab reports:", err);
            const tbody = document.getElementById('reportsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:red;">Error loading reports: ' + err.message + '</td></tr>';
        });
}

// ==========================================
// 3. TABLE RENDERING (PART 4, 7, 8)
// ==========================================
function renderReports(reports) {
    const tbody = document.getElementById("reportsTableBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    if (reports.length === 0) {
        setEmptyRow('tbodyLabReports', 'No lab reports found matching current filters.', 10);
        return;
    }

    reports.forEach(report => {
        const tr = document.createElement('tr');
        
        // P7 Status colors
        const rStat = (report.status || 'pending').toLowerCase().trim();
        const statusColor = rStat === 'ready' ? '#10b981' : rStat === 'delivered' ? '#3b82f6' : '#f59e0b';
        
        // P4 Billing Status colors
        const bStatus = (report.billingStatus || 'unbilled').toLowerCase();
        let bBg = '#FEF3C7', bText = '#D4820A';
        if (bStatus === 'billed') { bBg = '#EFF6FF'; bText = '#1E6FB5'; }
        else if (bStatus === 'paid') { bBg = '#DCFCE7'; bText = '#0D7A70'; }
        else if (bStatus === 'due') { bBg = '#FEE2E2'; bText = '#DC2626'; }

        // Format dates
        const dateVal = report.reportDate || (report.createdAt ? formatDate(report.createdAt) : '—');
        
        // Check edit permission (lab_technician and admin only)
        const canEdit = (currentUserRole === 'lab_technician' || currentUserRole === 'admin');
        const editBtnHtml = canEdit ? `<button onclick="openEditReport('${report.id}')" class="btn-secondary" style="padding:4px 8px;font-size:0.8rem;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;"><i class="fa-solid fa-pen-to-square"></i> Edit</button>` : '';

        // Doctors see only their own reports (matched by name, not email)
        if (currentUserRole === 'doctor' && report.referredBy !== currentDoctorName && report.referredBy !== 'Admin' && report.referredBy !== '') {
            return;
        }

        const waNotified = report.notifyPatient === true;
        const waHtml = waNotified 
            ? `<span title="WhatsApp notification will be sent when bot is set up in Phase 7" style="color:#f59e0b;font-size:1.1rem;cursor:help;"><i class="fa-solid fa-bell"></i></span>`
            : `<span title="Patient notified or no notification pending" style="color:#10b981;font-size:1.1rem;"><i class="fa-solid fa-circle-check"></i></span>`;

        const isReady = (report.status || '').toLowerCase() === 'ready';
        const printBtnHtml = isReady ? `<button onclick="generateLabReportPDF('${report.id}')" class="btn-secondary" style="padding:4px 8px;font-size:0.8rem;background:#0D7A70;color:white;border:1px solid #0D7A70;cursor:pointer;"><i class="fa-solid fa-print"></i> Print</button>` : '';

        const statusCellHtml = canEdit ? `
            <select class="status-select" data-id="${report.id}" style="padding:4px 8px;border-radius:6px;border:1px solid #ddd;font-size:0.8rem;background:${statusColor}20;color:${statusColor};font-weight:600;cursor:pointer;outline:none;">
                <option value="pending" ${rStat === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="ready" ${rStat === 'ready' ? 'selected' : ''}>Ready</option>
                <option value="delivered" ${rStat === 'delivered' ? 'selected' : ''}>Delivered</option>
            </select>
        ` : `<span style="background:${statusColor}20;color:${statusColor};padding:4px 8px;border-radius:6px;font-size:0.8rem;font-weight:600;text-transform:capitalize;">${escapeHtml(rStat)}</span>`;

        tr.innerHTML = `
            <td><strong>${escapeHtml(report.reportId || report.id.substring(0, 8))}</strong></td>
            <td>${escapeHtml(report.patientName || '—')}</td>
            <td>${escapeHtml(report.patientId || '—')}</td>
            <td>${escapeHtml(report.referredBy || '—')}</td>
            <td>${escapeHtml(report.testName || '—')}</td>
            <td class="billing-col"><strong>${formatCurrency(report.totalAmount || report.amount || 0)}</strong></td>
            <td>${escapeHtml(dateVal)}</td>
            <td class="billing-col"><span style="background:${bBg};color:${bText};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:capitalize;">${escapeHtml(bStatus)}</span></td>
            <td>${statusCellHtml}</td>
            <td>${waHtml}</td>
            <td>
                <div style="display:flex; gap:6px;">
                    <button class="btn-primary view-report-btn" data-id="${report.id}" style="padding:4px 8px;font-size:0.8rem;"><i class="fa-solid fa-eye"></i> View</button>
                    ${printBtnHtml}
                    ${editBtnHtml}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Hide billing elements for non-billing roles (FIX 1)
    const isBillingRole = ['receptionist', 'billing_staff', 'admin', 'pharmacist', 'owner'].includes(currentUserRole);
    if (!isBillingRole) {
        document.querySelectorAll('.billing-col').forEach(el => el.style.display = 'none');
    }

    // Attach instant status update change listeners (PART 7)
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', (e) => {
            updateReportStatus(e.target.dataset.id, e.target.value);
        });
    });

    // Attach view listeners
    document.querySelectorAll('.view-report-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const btnEl = e.currentTarget;
            const report = allReports.find(r => r.id === btnEl.dataset.id);
            if (report) viewLabReport(report);
        });
    });
}

function updateReportStatus(id, newStatus) {
    if (newStatus.toLowerCase() === 'ready') {
        db.collection('reports').doc(id).get().then(doc => {
            if (!doc.exists) return;
            const rep = doc.data();
            const runner = (typeof finalizeDiagnosticReportReady === 'function')
                ? finalizeDiagnosticReportReady(id, rep, 'lab')
                : db.collection('reports').doc(id).update({ status: 'ready', notifyPatient: true, notifyDoctor: true });
            runner.then(function (meta) {
                if (meta && meta.phone) {
                    showToast('Report ready. Doctor notified. WhatsApp queued (24h download link). Kept 3 years.', 'success');
                } else {
                    showToast('Report ready. Doctor notified on dashboard. Patient record updated (3yr retention).', 'success');
                }
            }).catch(function (err) {
                showToast(err.message, 'error');
            });
        });
        return;
    }
    db.collection('reports').doc(id).update({
        status: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => showToast('Status updated.', 'success'))
      .catch(err => showToast(err.message, 'error'));
}
window.updateReportStatus = updateReportStatus;

// ==========================================
// 4. FILTER BAR LOGIC (PART 8)
// ==========================================
function applyFilters() {
    const patVal = document.getElementById('filterPatient').value.toLowerCase().trim();
    const statusVal = document.getElementById('filterStatus').value;
    const billVal = document.getElementById('filterBilling').value;
    const fromVal = document.getElementById('filterFromDate').value;
    const toVal = document.getElementById('filterToDate').value;
    
    let filtered = allReports;
    
    // 1. Patient Name / ID Search
    if (patVal) {
        filtered = filtered.filter(r => 
            (r.patientName && r.patientName.toLowerCase().includes(patVal)) ||
            (r.patientId && r.patientId.toLowerCase().includes(patVal)) ||
            (r.reportId && r.reportId.toLowerCase().includes(patVal))
        );
    }
    
    // 2. Report Status
    if (statusVal !== 'All') {
        filtered = filtered.filter(r => String(r.status || '').toLowerCase() === String(statusVal).toLowerCase());
    }
    
    // 3. Billing Status
    if (billVal !== 'All') {
        filtered = filtered.filter(r => (r.billingStatus || 'unbilled').toLowerCase() === billVal.toLowerCase());
    }
    
    // 4. Date Range
    if (fromVal) {
        const fromDate = new Date(fromVal);
        fromDate.setHours(0,0,0,0);
        filtered = filtered.filter(r => {
            const rDate = r.reportDate ? new Date(r.reportDate) : (r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null);
            if (!rDate) return false;
            rDate.setHours(0,0,0,0);
            return rDate >= fromDate;
        });
    }
    if (toVal) {
        const toDate = new Date(toVal);
        toDate.setHours(23,59,59,999);
        filtered = filtered.filter(r => {
            const rDate = r.reportDate ? new Date(r.reportDate) : (r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null);
            if (!rDate) return false;
            rDate.setHours(0,0,0,0);
            return rDate <= toDate;
        });
    }
    
    // Update count label
    const label = document.getElementById('reportsCountLabel');
    if (label) {
        label.textContent = `Showing ${filtered.length} reports`;
    }
    
    renderReports(filtered);
}
window.applyFilters = applyFilters;

// Filter Event Listeners
document.getElementById('btnApplyFilters') && document.getElementById('btnApplyFilters').addEventListener('click', applyFilters);
document.getElementById('btnClearFilters') && document.getElementById('btnClearFilters').addEventListener('click', () => {
    document.getElementById('filterPatient').value = '';
    document.getElementById('filterStatus').value = 'All';
    document.getElementById('filterBilling').value = 'All';
    document.getElementById('filterFromDate').value = '';
    document.getElementById('filterToDate').value = '';
    applyFilters();
});

// ==========================================
// 5. VIEW DETAIL MODAL (PART 3)
// ==========================================
function viewLabReport(report) {
    document.getElementById('viewReportId').textContent = escapeHtml(report.reportId || report.id.substring(0, 8));
    document.getElementById('viewReportPatient').textContent = escapeHtml(report.patientName || '—') + ' (' + escapeHtml(report.patientId || '—') + ')';
    document.getElementById('viewReportTest').textContent = escapeHtml(report.testName || '—');
    
    const listEl = document.getElementById('viewReportTestsList');
    if (listEl) {
        if (report.resultMode === 'entered' && report.tests && report.tests.length) {
            let html = `
                <table style="width:100%; font-size:12px; border-collapse:collapse; margin-top:8px;">
                    <thead>
                        <tr style="background:#f8fafc; border-bottom:1.5px solid #cbd5e1; text-align:left;">
                            <th style="padding:6px; font-weight:600;">Parameter</th>
                            <th style="padding:6px; text-align:center; font-weight:600;">Result</th>
                            <th style="padding:6px; text-align:center; font-weight:600;">Range</th>
                            <th style="padding:6px; text-align:center; font-weight:600;">Flag</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            report.tests.forEach(t => {
                let flagStyle = 'color:#64748b; font-weight:600;';
                if (t.flag === 'High' || t.flag === 'Abnormal') flagStyle = 'color:#dc2626; font-weight:700;';
                else if (t.flag === 'Low') flagStyle = 'color:#d97706; font-weight:700;';
                else if (t.flag === 'Normal') flagStyle = 'color:#10b981; font-weight:600;';
                
                html += `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:6px;">${escapeHtml(t.name)}</td>
                        <td style="padding:6px; text-align:center; font-weight:700;">${escapeHtml(t.result)} <span style="font-weight:normal; color:#64748b; font-size:10px;">${escapeHtml(t.unit)}</span></td>
                        <td style="padding:6px; text-align:center; color:#64748b;">${escapeHtml(t.normalRange)}</td>
                        <td style="padding:6px; text-align:center; ${flagStyle}">${escapeHtml(t.flag || '—')}</td>
                    </tr>
                `;
            });
            html += '</tbody></table>';
            listEl.innerHTML = html;
        } else if (report.tests && report.tests.length) {
            let html = '<ul style="margin:0; padding-left:15px; font-size:0.9rem; line-height: 1.6;">';
            report.tests.forEach(t => {
                html += `<li><strong>${escapeHtml(t.name)}</strong>: <span style="color: #0D7A70; font-weight:500;">${formatCurrency(t.amount)}</span></li>`;
            });
            html += '</ul>';
            listEl.innerHTML = html;
        } else {
            listEl.innerHTML = `<span style="font-size:0.9rem;"><strong>${escapeHtml(report.testName || '—')}</strong>: ${formatCurrency(report.totalAmount || report.amount || 0)}</span>`;
        }
    }

    document.getElementById('viewReportReferred').textContent = escapeHtml(report.referredBy || '—');
    document.getElementById('viewReportDate').textContent = escapeHtml(report.reportDate || (report.createdAt ? formatDate(report.createdAt) : '—'));
    document.getElementById('viewReportStatus').textContent = escapeHtml((report.status || 'pending').toLowerCase().trim());
    document.getElementById('viewReportNotes').textContent = escapeHtml(report.notes || 'No custom notes.');
    
    // Handle view PDF button in modal
    const pdfBtn = document.getElementById('viewReportPdfBtn');
    if (pdfBtn) {
        if (report.fileUrl || report.pdfUrl) {
            pdfBtn.style.display = 'inline-flex';
            pdfBtn.onclick = function() {
                window.open(report.fileUrl || report.pdfUrl, '_blank');
            };
        } else {
            pdfBtn.style.display = 'none';
        }
    }

    // Handle print report button (FIX 3)
    const printBtn = document.getElementById('viewReportPrintBtn');
    if (printBtn) {
        if ((report.status || '').toLowerCase() === 'ready') {
            printBtn.style.display = 'inline-flex';
            printBtn.onclick = function() {
                generateLabReportPDF(report.id);
            };
        } else {
            printBtn.style.display = 'none';
        }
    }

    document.getElementById('viewReportModal').classList.add('active');
}
document.getElementById('closeViewReportModal') && document.getElementById('closeViewReportModal').addEventListener('click', () => {
    document.getElementById('viewReportModal').classList.remove('active');
});

// CHANGE 7 — Unified PDF view report
function viewReport(reportId) {
    firebase.firestore().collection('reports').doc(reportId).get()
    .then(function(doc) {
        if (!doc.exists) { showToast('Report not found', 'error'); return; }
        var r = doc.data();
        if (r.pdfUrl || r.fileUrl) {
            window.open(r.pdfUrl || r.fileUrl, '_blank');
        } else {
            showToast('No PDF uploaded for this report yet', 'warning');
        }
    }).catch(function(err) {
        showToast('Error: ' + err.message, 'error');
    });
}
window.viewReport = viewReport;

// ==========================================
// 6. EDIT EXISTING REPORT (PART 7)
// ==========================================
function openEditReport(docId) {
    activeReportDocId = docId;
    clearPatient_lab();
    
    db.collection('reports').doc(docId).get()
    .then(docSnap => {
        if (!docSnap.exists) return;
        const report = docSnap.data();
        
        // Find patient
        db.collection('patients').where('patientId', '==', report.patientId).get()
        .then(snap => {
            if (!snap.empty) {
                const pDoc = snap.docs[0];
                const pData = pDoc.data();
                selectedPatient_lab = {
                    docId: pDoc.id,
                    patientId: pData.patientId,
                    name: pData.name,
                    doctor: pData.doctor || '',
                    department: pData.department || '',
                    phone: pData.phone || '',
                    age: pData.age || '',
                    gender: pData.gender || ''
                };
                document.getElementById('lab_patientSearchInput').value = selectedPatient_lab.name + ' — ' + selectedPatient_lab.patientId;
                document.getElementById('lab_cardPatientName').textContent = selectedPatient_lab.name;
                document.getElementById('lab_cardPatientId').textContent = selectedPatient_lab.patientId;
                document.getElementById('lab_cardAgeGender').textContent = (selectedPatient_lab.age || '—') + ' / ' + (selectedPatient_lab.gender || '—');
                
                loadDoctors_lab(report.referredBy || selectedPatient_lab.doctor);
                var deptSelect = document.getElementById('lab_deptSelect');
                if (deptSelect) deptSelect.value = report.visitDepartment || selectedPatient_lab.department || '';
                document.getElementById('lab_selectedPatientCard').style.display = 'block';
            }
            
            // Set Tab based on resultMode
            if (report.resultMode === 'entered') {
                switchLabModalTab('enter');
                const tbody = document.getElementById('labParamsTableBody');
                if (tbody) {
                    tbody.innerHTML = '';
                    if (report.tests && report.tests.length) {
                        report.tests.forEach(t => {
                            addLabParamRow(t.name, t.result || '', t.unit || '', t.normalRange || '', undefined, undefined, false, "");
                        });
                    }
                }
                document.getElementById('labSampleCollectedAt').value = report.sampleCollectedAt || '';
                document.getElementById('labReportedAt').value = report.reportedAt || '';
                document.getElementById('labRemarks').value = report.remarks || '';
                document.getElementById('labTemplateSelect').value = '';
            } else {
                switchLabModalTab('upload');
                // Set Single/Panel mode and pre-fill tests
                if (report.tests && report.tests.length > 1) {
                    document.getElementById('btnPanelMode').click();
                    document.getElementById('labPanelName').value = report.testName || '';
                    const container = document.getElementById('panelRowsContainer');
                    if (container) container.innerHTML = '';
                    report.tests.forEach(t => addPanelRow(t.name, t.amount));
                } else {
                    document.getElementById('btnSingleTestMode').click();
                    document.getElementById('labTestName').value = report.testName || '';
                    document.getElementById('labTestAmount').value = report.amount || 0;
                }
            }
            
            document.getElementById('labTestDate').value = report.reportDate || '';
            document.getElementById('labStatus').value = (report.status || 'pending').toLowerCase().trim();
            document.getElementById('labNotes').value = report.notes || '';
            if (document.getElementById('labReferredBy')) {
                document.getElementById('labReferredBy').value = report.referredBy || '';
            }
            
            // Open Modal
            document.getElementById('uploadReportModal').classList.add('active');
        });
    })
    .catch(err => {
        console.error("Error setting up edit report:", err);
        showToast("Error retrieving report details for editing.", "error");
    });
}
window.openEditReport = openEditReport;

// ==========================================
// 7. MODAL SINGLE/PANEL TOGGLE & ROW CALCULATOR (PART 3)
// ==========================================
const uploadReportModal = document.getElementById('uploadReportModal');
document.getElementById('uploadReportBtn') && document.getElementById('uploadReportBtn').addEventListener('click', () => {
    activeReportDocId = null; // Clear edit pointer
    clearPatient_lab();
    document.getElementById('uploadReportForm').reset();
    uploadReportModal.classList.add('active');
    
    // Set Single mode default
    if (document.getElementById('btnSingleTestMode')) {
        document.getElementById('btnSingleTestMode').click();
    }
});
document.getElementById('closeUploadModalBtn') && document.getElementById('closeUploadModalBtn').addEventListener('click', () => {
    activeReportDocId = null;
    uploadReportModal.classList.remove('active');
});
document.getElementById('cancelUploadBtn') && document.getElementById('cancelUploadBtn').addEventListener('click', () => {
    activeReportDocId = null;
    uploadReportModal.classList.remove('active');
});

const btnSingleMode = document.getElementById('btnSingleTestMode');
const btnPanelMode = document.getElementById('btnPanelMode');
const singleTestFields = document.getElementById('singleTestFields');
const panelFields = document.getElementById('panelFields');
const labUploadMode = document.getElementById('labUploadMode');

if (btnSingleMode && btnPanelMode) {
    btnSingleMode.addEventListener('click', () => {
        btnSingleMode.className = 'btn-primary';
        btnPanelMode.className = 'btn-secondary';
        btnPanelMode.style.cssText = 'flex:1; justify-content:center; background:#f1f5f9; color:#334155; border-color:#cbd5e1;';
        singleTestFields.style.display = 'block';
        panelFields.style.display = 'none';
        labUploadMode.value = 'single';
        document.getElementById('labTestName').required = true;
        document.getElementById('labPanelName').required = false;
    });

    btnPanelMode.addEventListener('click', () => {
        btnPanelMode.className = 'btn-primary';
        btnSingleMode.className = 'btn-secondary';
        btnSingleMode.style.cssText = 'flex:1; justify-content:center; background:#f1f5f9; color:#334155; border-color:#cbd5e1;';
        singleTestFields.style.display = 'none';
        panelFields.style.display = 'block';
        labUploadMode.value = 'panel';
        document.getElementById('labTestName').required = false;
        document.getElementById('labPanelName').required = true;
        if (document.getElementById('panelRowsContainer').children.length === 0) {
            addPanelRow();
        }
    });
}

function addPanelRow(testName = '', amount = 0) {
    const container = document.getElementById('panelRowsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:10px; align-items:center; margin-bottom: 5px;';
    row.innerHTML = `
        <input type="text" class="panel-test-name" placeholder="Test Name" value="${testName}" required style="flex:2; padding:10px 15px; border:1px solid var(--border-color); border-radius:6px;">
        <input type="number" class="panel-test-amount" placeholder="Amount" value="${amount || ''}" min="0" required style="flex:1; padding:10px 15px; border:1px solid var(--border-color); border-radius:6px;">
        <button type="button" class="btn-secondary btn-remove-row" style="padding:10px; color:red; border-color:red; height:42px;"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(row);

    row.querySelector('.panel-test-amount').addEventListener('input', calculatePanelTotal);
    row.querySelector('.btn-remove-row').addEventListener('click', () => {
        if (container.children.length > 1) {
            row.remove();
            calculatePanelTotal();
        } else {
            showToast('At least one test row is required in panel mode.', 'warning');
        }
    });
    calculatePanelTotal();
}

function calculatePanelTotal() {
    const amounts = document.querySelectorAll('.panel-test-amount');
    let total = 0;
    amounts.forEach(inp => {
        total += parseFloat(inp.value) || 0;
    });
    const totalEl = document.getElementById('labPanelTotalAmount');
    if (totalEl) totalEl.textContent = total.toFixed(2);
}

document.getElementById('btnAddPanelRow') && document.getElementById('btnAddPanelRow').addEventListener('click', () => addPanelRow());
document.getElementById('tabEnterResultsBtn') && document.getElementById('tabEnterResultsBtn').addEventListener('click', () => switchLabModalTab('enter'));
document.getElementById('tabUploadFileBtn') && document.getElementById('tabUploadFileBtn').addEventListener('click', () => switchLabModalTab('upload'));
document.getElementById('labTemplateSelect') && document.getElementById('labTemplateSelect').addEventListener('change', (e) => {
    var box = document.getElementById('labCustomTestBox');
    if (box) box.style.display = e.target.value === 'custom' ? 'block' : 'none';
    if (e.target.value !== 'custom') renderTemplateParameters(e.target.value);
});
document.getElementById('labApplyCustomTestBtn') && document.getElementById('labApplyCustomTestBtn').addEventListener('click', function () {
    var name = (document.getElementById('labCustomTestName') || {}).value || 'Custom Test';
    var raw = (document.getElementById('labCustomParams') || {}).value || '';
    var params = raw.split(/\n/).map(function (line) {
        var parts = line.split('|').map(function (p) { return p.trim(); });
        if (!parts[0]) return null;
        var row = { name: parts[0], unit: parts[1] || '', isText: false };
        if (parts[2] !== undefined && parts[2] !== '' && !isNaN(Number(parts[2]))) row.min = Number(parts[2]);
        if (parts[3] !== undefined && parts[3] !== '' && !isNaN(Number(parts[3]))) row.max = Number(parts[3]);
        if (row.min == null && row.max == null) { row.isText = true; row.rangeText = parts[2] || 'As reported'; }
        return row;
    }).filter(Boolean);
    if (!params.length) { showToast('Add at least one parameter line.', 'warning'); return; }
    LAB_TEMPLATES.custom = { title: name, parameters: params };
    var testNameEl = document.getElementById('labTestName');
    if (testNameEl) testNameEl.value = name;
    renderTemplateParameters('custom');
    // Persist template for hospital reuse
    db.collection('labTestCatalog').doc(name.toLowerCase().replace(/[^a-z0-9]+/g, '_')).set({
        name: name, parameters: params, active: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(function () {});
    showToast('Custom test applied. You can reuse it next time from catalog.', 'success');
});
document.getElementById('btnAddLabCustomRow') && document.getElementById('btnAddLabCustomRow').addEventListener('click', () => addLabParamRow("", "", "", "", undefined, undefined, false, ""));

// ==========================================
// 8. SAVE REPORT LOGIC (PART 3 & 4)
// ==========================================
document.getElementById('saveReportBtn').addEventListener('click', async () => {
    if (!selectedPatient_lab) { showToast("Please select a patient first.", "warning"); return; }
    
    const uploadMode = document.getElementById('labUploadMode').value;
    const isEntered = uploadMode === 'entered';
    const isPanel = uploadMode === 'panel';
    const testDate = document.getElementById('labTestDate').value;
    const referredBy = document.getElementById('labReferredBy').value;
    let status = document.getElementById('labStatus').value;
    const notes = document.getElementById('labNotes').value.trim();
    
    if (!testDate || !referredBy) { showToast("Please fill date and referred doctor.", "warning"); return; }

    let finalTestName = '';
    let testsArray = [];
    let totalAmount = 0;
    
    const reportData = {
        referredBy: referredBy,
        reportDate: testDate,
        notes: notes,
        visitDoctor: document.getElementById('lab_doctorSelect').value || selectedPatient_lab.doctor || '',
        visitDepartment: document.getElementById('lab_deptSelect').value || selectedPatient_lab.department || '',
        uploadedBy: currentUserEmail,
        uploadedReport: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (isEntered) {
        const rows = document.querySelectorAll('#labParamsTableBody tr');
        rows.forEach(row => {
            const nameInp = row.querySelector('.lab-p-name');
            const resultInp = row.querySelector('.lab-p-result');
            const unitInp = row.querySelector('.lab-p-unit');
            const rangeInp = row.querySelector('.lab-p-range');
            const flagEl = row.querySelector('.lab-p-flag');
            
            if (nameInp && resultInp) {
                const name = nameInp.value.trim();
                const result = resultInp.value.trim();
                const unit = unitInp ? unitInp.value.trim() : '';
                const normalRange = rangeInp ? rangeInp.value.trim() : '';
                const flag = flagEl ? flagEl.textContent.trim() : '';
                
                if (name) {
                    testsArray.push({ name, result, unit, normalRange, flag });
                }
            }
        });
        
        if (testsArray.length === 0) {
            showToast("Please enter at least one parameter result.", "warning");
            return;
        }
        
        const sampleCollected = document.getElementById('labSampleCollectedAt').value;
        const reportedAt = document.getElementById('labReportedAt').value;
        const remarks = document.getElementById('labRemarks').value.trim();
        
        if (!sampleCollected || !reportedAt) {
            showToast("Please enter sample collection and report date/time.", "warning");
            return;
        }
        
        const templateSel = document.getElementById('labTemplateSelect');
        if (templateSel && templateSel.value && LAB_TEMPLATES[templateSel.value]) {
            finalTestName = LAB_TEMPLATES[templateSel.value].title;
        } else {
            finalTestName = document.getElementById('labTestName').value.trim() || 'Lab Report';
        }
        
        totalAmount = parseFloat(document.getElementById('labTestAmount').value) || 0;
        status = 'ready'; // Manual entries are complete/ready
        
        reportData.resultMode = 'entered';
        reportData.tests = testsArray;
        reportData.sampleCollectedAt = sampleCollected;
        reportData.reportedAt = reportedAt;
        reportData.remarks = remarks;
    } else {
        if (isPanel) {
            finalTestName = document.getElementById('labPanelName').value.trim();
            if (!finalTestName) { showToast("Please enter panel name.", "warning"); return; }
            
            const rows = document.querySelectorAll('#panelRowsContainer > div');
            rows.forEach(row => {
                const name = row.querySelector('.panel-test-name').value.trim();
                const amount = parseFloat(row.querySelector('.panel-test-amount').value) || 0;
                if (name) {
                    testsArray.push({ name, amount });
                    totalAmount += amount;
                }
            });
            if (testsArray.length === 0) {
                showToast("At least one test name is required.", "warning");
                return;
            }
        } else {
            finalTestName = document.getElementById('labTestName').value.trim();
            const amountVal = parseFloat(document.getElementById('labTestAmount').value) || 0;
            if (!finalTestName) { showToast("Please enter test name.", "warning"); return; }
            testsArray.push({ name: finalTestName, amount: amountVal });
            totalAmount = amountVal;
        }
        
        reportData.resultMode = 'uploaded';
        reportData.tests = testsArray;
    }
    
    reportData.testName = finalTestName;
    reportData.totalAmount = totalAmount;
    reportData.amount = totalAmount;
    reportData.status = status;

    const pdfFile = document.getElementById('labPdfFile') ? document.getElementById('labPdfFile').files[0] : null;
    if (!isEntered && !activeReportDocId && !pdfFile) {
        showToast("Select a scanned report (PDF, JPG or PNG).", "warning");
        return;
    }
    if (pdfFile) {
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(pdfFile.type)) { showToast('Use a PDF, JPG or PNG report.', 'error'); return; }
        if (pdfFile.size > 10 * 1024 * 1024) { showToast('File must be under 10MB.', 'error'); return; }
    }

    const saveBtn = document.getElementById('saveReportBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const statusLower = (status || 'pending').toLowerCase().trim();
    if (statusLower === 'ready') {
        reportData.notifyPatient = true;
        reportData.patientPhone = selectedPatient_lab.phone || '';
        reportData.reportReadyAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    try {
        if (pdfFile) {
            // Upload to Firebase Storage
            document.getElementById('labUploadProgressContainer').style.display = 'block';
            const random = Math.floor(Math.random() * 90000) + 10000;
            const extension = pdfFile.type === 'application/pdf' ? 'pdf' : pdfFile.type === 'image/png' ? 'png' : 'jpg';
            const storagePath = `reports/${selectedPatient_lab.patientId}/SA-LAB-${new Date().getFullYear()}-${Date.now()}-${random}.${extension}`;
            const storageRef = firebase.storage().ref(storagePath);
            const uploadTask = storageRef.put(pdfFile);
            
            await new Promise((resolve, reject) => {
                uploadTask.on('state_changed',
                    snap => {
                        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
                        document.getElementById('labUploadProgress').style.width = pct + '%';
                        document.getElementById('labUploadPct').textContent = pct + '%';
                    },
                    err => reject(err),
                    async () => {
                        try {
                        reportData.fileUrl = await uploadTask.snapshot.ref.getDownloadURL();
                        reportData.fileName = pdfFile.name;
                        reportData.fileContentType = pdfFile.type;
                        resolve();
                        } catch (error) { reject(error); }
                    }
                );
            });
            document.getElementById('labUploadProgressContainer').style.display = 'none';
        }

        let finalReportId = '';
        let downloadURL = reportData.fileUrl || '';

        if (activeReportDocId) {
            const doc = await db.collection("reports").doc(activeReportDocId).get();
            finalReportId = doc.exists ? (doc.data().reportId || activeReportDocId) : activeReportDocId;
            await db.collection("reports").doc(activeReportDocId).update(reportData);
            showToast("Report uploaded and updated successfully!", "success");
        } else {
            const random = Math.floor(Math.random() * 90000) + 10000;
            const reportId = `SA-LAB-${new Date().getFullYear()}-${random}`;
            finalReportId = reportId;
            
            reportData.type = 'lab';
            reportData.reportId = reportId;
            reportData.patientId = selectedPatient_lab.patientId;
            reportData.patientDocId = selectedPatient_lab.docId;
            reportData.patientName = selectedPatient_lab.name;
            if (window.currentQueueData) {
                reportData.billingStatus = 'billed';
                reportData.linkedBillId = window.currentQueueData.billId || '';
            } else if (window.currentBillData) {
                reportData.billingStatus = 'paid';
                reportData.linkedBillId = window.currentBillData.billId || '';
            } else {
                reportData.billingStatus = 'unbilled';
                reportData.linkedBillId = '';
            }
            reportData.visitType = 'OPD';
            reportData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            
            await db.collection("reports").add(reportData);
            showToast(`New lab report ${reportId} saved successfully!`, "success");
        }

        // Update the bill/queue if window.currentQueueData exists (PART 2)
        if (window.currentQueueData) {
            await db.collection("labQueue").doc(window.currentQueueData.queueDocId).update({
                reportStatus: "ready",
                reportId: finalReportId,
                completedAt: firebase.firestore.FieldValue.serverTimestamp(),
                completedBy: currentUserEmail
            });

            // Check if all labQueue and imagingQueue items for this bill are resolved
            const labSnap = await db.collection("labQueue").where("billDocId", "==", window.currentQueueData.billDocId).get();
            const imgSnap = await db.collection("imagingQueue").where("billDocId", "==", window.currentQueueData.billDocId).get();
            
            let allReady = true;
            labSnap.forEach(d => { if (d.id !== window.currentQueueData.queueDocId && d.data().reportStatus !== "ready") allReady = false; });
            imgSnap.forEach(d => { if (d.data().reportStatus !== "ready") allReady = false; });
            
            if (allReady) {
                const billRef = db.collection('bills').doc(window.currentQueueData.billDocId);
                const updateData = { reportStatus: "ready" };
                await billRef.update(updateData);
                const billDoc = await billRef.get();
                if (billDoc.exists && billDoc.data().patientDocId) {
                    await db.collection('patients').doc(billDoc.data().patientDocId).collection('bills').doc(window.currentQueueData.billDocId).update(updateData);
                }
                showToast("All lab/scan reports for this bill are ready!", "success");
            }
            window.currentQueueData = null;
            loadPendingLabWork();
        } else if (window.currentBillData) {
            const billRef = db.collection('bills').doc(window.currentBillData.billDocId);
            await billRef.update({
                labCompleted: true,
                labReportId: finalReportId,
                labReportUrl: downloadURL,
                labCompletedAt: firebase.firestore.FieldValue.serverTimestamp(),
                labCompletedBy: currentUserEmail,
                notifyPatient: true,
                notifyDoctor: true
            });
            showToast('Bill updated. Doctor and patient notified.', 'success');
            window.currentBillData = null;
            loadPendingLabWork();
        }

        activeReportDocId = null;
        uploadReportModal.classList.remove('active');
        document.getElementById('uploadReportForm').reset();
        clearPatient_lab();
    } catch (err) {
        console.error("Error saving report:", err);
        showToast("Error saving report: " + err.message, "error");
        if (document.getElementById('labUploadProgressContainer')) {
            document.getElementById('labUploadProgressContainer').style.display = 'none';
        }
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Report";
    }
});

// ==========================================
// 9. PATIENT SEARCH LOGIC
// ==========================================
function searchPatient_lab(query) {
    var dropdown = document.getElementById('lab_patientSearchResults');
    if (!query || query.length < 2) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = '<div style="padding:10px;color:#666;"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
    dropdown.style.display = 'block';
    var results = [];
    var q = query.toLowerCase();
    db.collection('patients').where('patientId', '==', query).get()
    .then(function(snap) {
        snap.forEach(function(doc) { results.push(Object.assign({docId: doc.id}, doc.data())); });
        return db.collection('patients').orderBy('nameLower').startAt(q).endAt(q + '\uf8ff').limit(5).get();
    })
    .then(function(snap) {
        snap.forEach(function(doc) {
            if (!results.find(function(r) { return r.docId === doc.id; }))
                results.push(Object.assign({docId: doc.id}, doc.data()));
        });
        return db.collection('patients').where('phone', '==', query).get();
    })
    .then(function(snap) {
        snap.forEach(function(doc) {
            if (!results.find(function(r) { return r.docId === doc.id; }))
                results.push(Object.assign({docId: doc.id}, doc.data()));
        });
        showPatientDropdown_lab(results);
    })
    .catch(function(err) {
        dropdown.innerHTML = '<div style="padding:10px;color:red;">Error: ' + err.message + '</div>';
    });
}
window.searchPatient_lab = searchPatient_lab;

function showPatientDropdown_lab(patients) {
    var dropdown = document.getElementById('lab_patientSearchResults');
    if (!patients.length) {
        dropdown.innerHTML = '<div style="padding:10px;color:#666;">No patients found</div>';
        return;
    }
    var html = '';
    patients.forEach(function(p) {
        html += '<div onclick="selectPatient_lab(this)" '
            + 'data-docid="' + p.docId + '" '
            + 'data-patientid="' + (p.patientId||'') + '" '
            + 'data-name="' + (p.name||'') + '" '
            + 'data-doctor="' + (p.doctor||'') + '" '
            + 'data-dept="' + (p.department||'') + '" '
            + 'data-phone="' + (p.phone||'') + '" '
            + 'data-age="' + (p.age||'') + '" '
            + 'data-gender="' + (p.gender||'') + '" '
            + 'style="padding:10px 15px;cursor:pointer;border-bottom:1px solid #eee;" '
            + 'onmouseover="this.style.background=\'#f5f5f5\'" '
            + 'onmouseout="this.style.background=\'white\'">'
            + '<strong>' + (p.name||'Unknown') + '</strong>'
            + ' <span style="color:#0D7A70;font-size:12px;">' + (p.patientId||'') + '</span>'
            + '<br><small style="color:#888;">'
            + (p.phone||'') + ' | ' + (p.doctor||'') + ' | ' + (p.department||'')
            + '</small></div>';
    });
    dropdown.innerHTML = html;
}
window.showPatientDropdown_lab = showPatientDropdown_lab;

function selectPatient_lab(el) {
    selectedPatient_lab = {
        docId: el.dataset.docid || el.getAttribute('data-docid'),
        patientId: el.dataset.patientid || el.getAttribute('data-patientid'),
        name: el.dataset.name || el.getAttribute('data-name'),
        doctor: el.dataset.doctor || el.getAttribute('data-doctor'),
        department: el.dataset.dept || el.getAttribute('data-dept'),
        phone: el.dataset.phone || el.getAttribute('data-phone'),
        age: el.dataset.age || el.getAttribute('data-age'),
        gender: el.dataset.gender || el.getAttribute('data-gender')
    };
    document.getElementById('lab_patientSearchInput').value = selectedPatient_lab.name + ' — ' + selectedPatient_lab.patientId;
    document.getElementById('lab_patientSearchResults').style.display = 'none';
    document.getElementById('lab_cardPatientName').textContent = selectedPatient_lab.name;
    document.getElementById('lab_cardPatientId').textContent = selectedPatient_lab.patientId;
    document.getElementById('lab_cardAgeGender').textContent = (selectedPatient_lab.age || '—') + ' / ' + (selectedPatient_lab.gender || '—');
    loadDoctors_lab(selectedPatient_lab.doctor);
    var deptSelect = document.getElementById('lab_deptSelect');
    if (deptSelect) deptSelect.value = selectedPatient_lab.department || '';
    document.getElementById('lab_selectedPatientCard').style.display = 'block';
}
window.selectPatient_lab = selectPatient_lab;

function clearPatient_lab() {
    selectedPatient_lab = null;
    document.getElementById('lab_patientSearchInput').value = '';
    document.getElementById('lab_selectedPatientCard').style.display = 'none';
    document.getElementById('lab_patientSearchResults').style.display = 'none';
    document.getElementById('lab_patientSearchInput').focus();
}
window.clearPatient_lab = clearPatient_lab;

function loadDoctors_lab(defaultDoctor) {
    var select = document.getElementById('lab_doctorSelect');
    var referredSelect = document.getElementById('labReferredBy');
    
    if (select) select.innerHTML = '<option value="">Select Doctor</option>';
    if (referredSelect) referredSelect.innerHTML = '<option value="">Select Doctor</option>';
    
    firebase.firestore().collection('staff').where('role', '==', 'doctor').get()
    .then(function(snap) {
        if (snap.empty) {
            var defaults = ['Dr. Sharma', 'Dr. Patel', 'Dr. Vamsi', 'Dr. Reddy', 'Dr. Rao'];
            defaults.forEach(function(d) {
                if (select) {
                    var opt = document.createElement('option');
                    opt.value = d; opt.textContent = d;
                    if (d === defaultDoctor) opt.selected = true;
                    select.appendChild(opt);
                }
                if (referredSelect) {
                    var opt2 = document.createElement('option');
                    opt2.value = d; opt2.textContent = d;
                    if (d === defaultDoctor) opt2.selected = true;
                    referredSelect.appendChild(opt2);
                }
            });
        } else {
            snap.forEach(function(doc) {
                var d = doc.data();
                var active = d.isActive === true || d.isActive === 'true';
                if (!active) return;
                if (select) {
                    var opt = document.createElement('option');
                    opt.value = d.name;
                    opt.textContent = d.name + (d.specialisation ? ' — ' + d.specialisation : '');
                    if (d.name === defaultDoctor) opt.selected = true;
                    select.appendChild(opt);
                }
                if (referredSelect) {
                    var opt2 = document.createElement('option');
                    opt2.value = d.name;
                    opt2.textContent = d.name + (d.specialisation ? ' — ' + d.specialisation : '');
                    if (d.name === defaultDoctor) opt2.selected = true;
                    referredSelect.appendChild(opt2);
                }
            });
        }
    });
}

// ==========================================
// 10. BILLING HELPER FUNCTIONS (PART 4)
// ==========================================
function updateBillingStatus(reportId, status, billId) {
    return db.collection('reports').doc(reportId).update({
        billingStatus: status,
        linkedBillId: billId || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
window.updateBillingStatus = updateBillingStatus;

function markReportPaid(reportId) {
    return db.collection('reports').doc(reportId).update({
        billingStatus: 'paid',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
window.markReportPaid = markReportPaid;

// ==========================================
// EXPORT REPORTS AS CSV (PART 9)
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    const labSearchInput = document.getElementById('lab_patientSearchInput');
    if (labSearchInput) {
        var debouncedSearchLab = debounce(function(query) {
            searchPatient_lab(query);
        }, 300);
        labSearchInput.addEventListener('input', function() {
            debouncedSearchLab(this.value.trim());
        });
    }
});

// The markup calls this button exportReportsBtn; binding only to the old
// exportLabBtn left Export CSV doing nothing at all.
var _labExportBtn = document.getElementById('exportReportsBtn') || document.getElementById('exportLabBtn');
_labExportBtn && _labExportBtn.addEventListener('click', function() {
    const patVal = document.getElementById('filterPatient').value.toLowerCase().trim();
    const statusVal = document.getElementById('filterStatus').value;
    const billVal = document.getElementById('filterBilling').value;
    const fromVal = document.getElementById('filterFromDate').value;
    const toVal = document.getElementById('filterToDate').value;
    
    let filtered = allReports;
    
    if (patVal) {
        filtered = filtered.filter(r => 
            (r.patientName && r.patientName.toLowerCase().includes(patVal)) ||
            (r.patientId && r.patientId.toLowerCase().includes(patVal)) ||
            (r.reportId && r.reportId.toLowerCase().includes(patVal))
        );
    }
    
    if (statusVal !== 'All') {
        filtered = filtered.filter(r => String(r.status || '').toLowerCase() === String(statusVal).toLowerCase());
    }
    
    if (billVal !== 'All') {
        filtered = filtered.filter(r => (r.billingStatus || 'unbilled').toLowerCase() === billVal.toLowerCase());
    }
    
    if (fromVal) {
        const fromDate = new Date(fromVal);
        fromDate.setHours(0,0,0,0);
        filtered = filtered.filter(r => {
            const rDate = r.reportDate ? new Date(r.reportDate) : (r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null);
            if (!rDate) return false;
            rDate.setHours(0,0,0,0);
            return rDate >= fromDate;
        });
    }
    if (toVal) {
        const toDate = new Date(toVal);
        toDate.setHours(23,59,59,999);
        filtered = filtered.filter(r => {
            const rDate = r.reportDate ? new Date(r.reportDate) : (r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null);
            if (!rDate) return false;
            rDate.setHours(0,0,0,0);
            return rDate <= toDate;
        });
    }
    
    const exportData = filtered.map(r => ({
        "Report ID": r.reportId || r.id.substring(0, 8),
        "Patient Name": r.patientName || '',
        "Patient ID": r.patientId || '',
        "Referred By": r.referredBy || '',
        "Test Name": r.testName || '',
        "Amount": r.totalAmount || r.amount || 0,
        "Date": r.reportDate || '',
        "Billing Status": r.billingStatus || 'unbilled',
        "Status": r.status || ''
    }));
    
    exportToCSV(exportData, "Lab_Reports_Export");
});
