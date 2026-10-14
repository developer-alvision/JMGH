const test = require('node:test');
const assert = require('node:assert/strict');
const { policy, calculateFee } = require('../js/hospital-policy.js');
test('photographed catalog has 35 labs and exactly the four hospital imaging tests', () => {
    assert.equal(policy.labs.length, 35);
    assert.equal(policy.labs.find(item => item.id === 'CBC').price, 300);
    assert.equal(policy.labs.find(item => item.id === 'Thyroid').price, 500);
    assert.equal(policy.labs.find(item => item.id === 'TSH').price, 600);
    assert.deepEqual(policy.imaging.map(item => [item.name, item.price]), [['ECG', 500], ['CTG', 500], ['USG Abdomen', 500], ['Vaginal Scan', 550]]);
    assert.deepEqual(policy.departments, ['Gynaecology', 'Surgery']);
});
test('new OP, day 7 and day 8 use confirmed fees; phone OP adds 100', () => {
    assert.equal(calculateFee({ date: '2026-10-13' }).amount, 300);
    const previous = { lastVisitDate: '2026-10-01', episodeDate: '2026-10-01' };
    assert.equal(calculateFee({ ...previous, date: '2026-10-08' }).amount, 0);
    assert.equal(calculateFee({ ...previous, date: '2026-10-09' }).amount, 100);
    assert.equal(calculateFee({ ...previous, date: '2026-10-08', phone: true }).amount, 100);
    assert.equal(calculateFee({ date: '2026-10-13', phone: true }).amount, 400);
});
test('general reviews respect calendar-month boundaries and full fee starts a new episode', () => {
    const previous = { lastVisitDate: '2026-01-31', episodeDate: '2026-01-31' };
    assert.equal(calculateFee({ ...previous, date: '2026-02-28' }).amount, 100);
    assert.equal(calculateFee({ ...previous, date: '2026-03-01' }).amount, 200);
    assert.equal(calculateFee({ ...previous, date: '2026-04-30' }).amount, 200);
    assert.equal(calculateFee({ ...previous, date: '2026-05-01' }).amount, 300);
    assert.equal(calculateFee({ ...previous, date: '2026-05-01' }).startsEpisode, true);
});
test('pregnancy review remains 100, explicit new episode and doctor fee waiver are respected', () => {
    const previous = { lastVisitDate: '2026-01-01', episodeDate: '2026-01-01', isPregnant: true, date: '2026-10-13' };
    assert.equal(calculateFee(previous).amount, 100);
    assert.equal(calculateFee({ ...previous, visitType: 'New' }).amount, 300);
    assert.equal(calculateFee({ ...previous, freeOP: true, phone: true }).amount, 0);
    assert.equal(calculateFee({ lastVisitDate: '2026-10-15', date: '2026-10-13' }).amount, 300);
});
