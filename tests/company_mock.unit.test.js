// Unit tests for the pure helpers in src/utils/companyMock.js (no database).
// Run: node --test tests/company_mock.unit.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const cm = require('../src/utils/companyMock');

const section = (name, count, order = 0) => ({ section_name: name, question_count: count, sort_order: order });

test('scaleSections keeps the recipe proportions and sums exactly to n', () => {
    const me = [section('General Aptitude', 5), section('Mechanical', 45, 1)];
    assert.deepEqual(cm.scaleSections(me, 30).map(s => s.question_count), [3, 27]);
    assert.deepEqual(cm.scaleSections(me, 50).map(s => s.question_count), [5, 45]);
    assert.deepEqual(cm.scaleSections(me, 100).map(s => s.question_count), [10, 90]);

    const ee = [section('GA', 5), section('EE', 25, 1), section('EC', 10, 2), section('IN', 10, 3)];
    assert.deepEqual(cm.scaleSections(ee, 20).map(s => s.question_count), [2, 10, 4, 4]);

    const ce = [7, 7, 6, 6, 6, 6, 6, 6].map((c, i) => section(`S${i}`, c, i));
    for (const n of [1, 7, 13, 25, 37, 50, 77]) {
        const scaled = cm.scaleSections(ce, n);
        assert.equal(scaled.reduce((sum, s) => sum + s.question_count, 0), n, `n=${n}`);
    }
});

test('scaleSections drops sections that get nothing', () => {
    const me = [section('General Aptitude', 5), section('Mechanical', 45, 1)];
    const scaled = cm.scaleSections(me, 4);
    assert.deepEqual(scaled.map(s => [s.section_name, s.question_count]), [['Mechanical', 4]]);
    assert.deepEqual(cm.scaleSections(me, 0), []);
});

test('parseRolls splits on commas, whitespace and new lines, and de-duplicates', () => {
    assert.deepEqual(cm.parseRolls('23110001, 23110002\n23110003\t23110004;23110001\r\n\n'),
        ['23110001', '23110002', '23110003', '23110004']);
    assert.deepEqual(cm.parseRolls(['a1', 'A1', 'b2']), ['a1', 'b2']);
    assert.deepEqual(cm.parseRolls(''), []);
    assert.deepEqual(cm.parseRolls(undefined), []);
});

test('paperKeyFor maps roster disciplines onto department mocks', () => {
    const recipes = new Map([
        ['CSE', { exam: { code: 'CSE', department: 'CSE', disciplines: 'CSE,CS,AI,ICDT,CG' } }],
        ['ME', { exam: { code: 'ME', department: 'ME', disciplines: 'ME' } }],
        ['CH', { exam: { code: 'CH', department: 'CH', disciplines: 'CL,CH' } }],
        ['MT', { exam: { code: 'MT', department: 'MT', disciplines: 'MT,MSE' } }]
    ]);
    assert.equal(cm.paperKeyFor(recipes, 'Mechanical'), 'ME');
    assert.equal(cm.paperKeyFor(recipes, 'Computer Science'), 'CSE');
    assert.equal(cm.paperKeyFor(recipes, 'Artificial Intelligence'), 'CSE');
    assert.equal(cm.paperKeyFor(recipes, 'Chemical'), 'CH');
    assert.equal(cm.paperKeyFor(recipes, 'Materials'), 'MT');
    assert.equal(cm.paperKeyFor(recipes, 'Physics'), null);
    assert.equal(cm.paperKeyFor(recipes, ''), null);
});

test('shufflePaper keeps sections in order and every question exactly once', () => {
    const paper = [];
    for (let i = 0; i < 3; i++) paper.push({ question_id: 100 + i, section_name: 'GA', section_order: 0, position: i + 1 });
    for (let i = 0; i < 20; i++) paper.push({ question_id: 200 + i, section_name: 'ME', section_order: 1, position: i + 4 });

    const shuffled = cm.shufflePaper(paper);
    assert.equal(shuffled.length, paper.length);
    assert.deepEqual(shuffled.map(q => q.position), paper.map((_, i) => i + 1));
    assert.ok(shuffled.slice(0, 3).every(q => q.section_order === 0));
    assert.ok(shuffled.slice(3).every(q => q.section_order === 1));
    assert.deepEqual([...shuffled.map(q => q.question_id)].sort(), [...paper.map(q => q.question_id)].sort());
});

test('fillInstructions fills every placeholder in IST', () => {
    // 2026-11-15 12:00 IST = 06:30 UTC
    const endsAt = Date.UTC(2026, 10, 15, 6, 30);
    const text = cm.fillInstructions('{N} questions, {T} minutes, closes {END}. {N}!', {
        total_questions: 30, duration_minutes: 45, ends_at_ms: endsAt
    });
    assert.match(text, /^30 questions, 45 minutes, closes 15 Nov 2026, 12:00 pm\. 30!$/i);
});

test('fillInstructions fills {START} too', () => {
    const startsAt = Date.UTC(2026, 10, 15, 13, 45); // 19:15 IST
    const text = cm.fillInstructions('from {START}', { total_questions: 1, duration_minutes: 1, starts_at_ms: startsAt });
    assert.match(text, /^from 15 Nov 2026, 07:15 pm$/i);
});

test('normalizeDateTime accepts form values and rejects junk', () => {
    assert.equal(cm.normalizeDateTime('2026-11-15T10:00'), '2026-11-15 10:00:00');
    assert.equal(cm.normalizeDateTime('2026-11-15 10:00:30'), '2026-11-15 10:00:30');
    assert.equal(cm.normalizeDateTime('2026-02-30T10:00'), null);
    assert.equal(cm.normalizeDateTime('2026-11-15T25:00'), null);
    assert.equal(cm.normalizeDateTime('tomorrow'), null);
    assert.equal(cm.normalizeDateTime(''), null);
});

test('the default instructions carry the agreed points', () => {
    const text = cm.DEFAULT_INSTRUCTIONS;
    for (const needle of ['+4', '-1', 'WhatsApp', 'unfair means', '{N}', '{T}', '{START}', '{END}']) {
        assert.ok(text.includes(needle), needle);
    }
});
