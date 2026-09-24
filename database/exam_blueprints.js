/**
 * exam_blueprints.js — the single place where mock-exam structure is configured.
 *
 * Everything the generator needs to know about "what a mock exam for department X
 * looks like" lives here. Editing this file and re-running
 * `node database/import_question_bank.js` is enough to change a paper's shape —
 * no controller or SQL change is needed.
 *
 * Two lists:
 *   `banks`  — the question pools to import. Each one is a metadata.csv from the
 *              image bank; its rows land in Question_Bank tagged with the bank's
 *              `code` (the `department` column).
 *   `exams`  — the papers students see, one per department. An exam is only a
 *              blueprint: a list of sections, each saying how many questions to
 *              draw and from where.
 *
 * How a paper is built at attempt time:
 *   For each section, `count` questions are drawn at random (MySQL ORDER BY
 *   RAND()) from the Question_Bank rows whose `department` is the section's
 *   `bank` (defaulting to the exam's own code) and whose `section` is in
 *   `sourceSections`. A fresh draw happens on every attempt, so two students —
 *   or the same student twice — never see the same 50 questions.
 *
 *   `sourceSections: []`  means "every section in that bank", i.e. one flat pool.
 *   Most GATE banks carry just two source sections — `GA` (General Aptitude) and
 *   the core subject — so those papers are split along that line. CE's bank
 *   carries eight real topic subsections. EE's paper also pulls in the EC and IN
 *   banks as sections of its own.
 *
 * Any exam code that disappears from `exams` is marked inactive on the next
 * import, which hides it from students but keeps every past attempt reviewable.
 */

const path = require('path');

module.exports = {
    // Where the question-bank images live on disk (the folder holding the
    // per-subject folders + the top-level README.md).
    bankRoot: path.join(__dirname, '..', 'questions', 'Question_Bank_Images', 'Question_Bank_Images'),

    // URL prefix the browser uses for the same folder. server.js serves
    // ./questions statically at /questions (and /mock/questions behind a proxy).
    imageWebRoot: '/questions/Question_Bank_Images/Question_Bank_Images',

    // Uniform marking scheme applied to every imported question, overriding the
    // per-question GATE values in metadata.csv so that every generated paper is
    // worth exactly the same total (50 x 4 = 200).
    marking: {
        correct: 4,
        negative: 1,
        // NAT and MSQ carry no negative marking under GATE's own rules; keep that.
        negativeForNat: 0
    },

    // Question types allowed into the bank. MSQ (multiple-correct) is excluded:
    // the exam arena renders single-select controls only.
    allowedTypes: ['MCQ', 'NAT'],

    banks: [
        { code: 'CSE', metadata: 'CSE/metadata.csv' },
        { code: 'ME',  metadata: 'ME/metadata.csv' },
        { code: 'CE',  metadata: 'CE/metadata.csv' },
        { code: 'CH',  metadata: 'CH/metadata.csv' },
        { code: 'MT',  metadata: 'MT/metadata.csv' },
        { code: 'EE',  metadata: 'GATE_ESE_Papers/EE/metadata.csv' },
        { code: 'EC',  metadata: 'GATE_ESE_Papers/EC/metadata.csv' },
        { code: 'IN',  metadata: 'GATE_ESE_Papers/IN/metadata.csv' }
    ],

    exams: [
        {
            code: 'CSE',
            title: 'Computer Science & Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE CSE question bank. Every attempt gives you a new paper.',
            durationMinutes: 90,
            // Aliases let a student's `discipline` value from allowed_students
            // resolve to this exam so the dashboard can badge it as theirs.
            disciplines: ['CSE', 'CS', 'AI', 'ICDT', 'CG'],
            // The CSE bank has no General Aptitude subsection.
            sections: [
                { name: 'Computer Science & Engineering', sourceSections: [], count: 50 }
            ]
        },
        {
            code: 'ME',
            title: 'Mechanical Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE ME question bank (2016-2025), across General Aptitude and Mechanical Engineering. Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['ME'],
            sections: [
                { name: 'General Aptitude', sourceSections: ['GA'], count: 5 },
                { name: 'Mechanical Engineering', sourceSections: ['ME'], count: 45 }
            ]
        },
        {
            code: 'EE',
            title: 'Electrical Engineering Mock Test',
            description: '50 randomly drawn questions across General Aptitude, Electrical, Electronics & Communication, and Instrumentation, from the GATE and ESE Prelims question banks. Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['EE', 'EC', 'ECE', 'IN'],
            sections: [
                { name: 'General Aptitude', bank: 'EE', sourceSections: ['GA'], count: 5 },
                { name: 'Electrical Engineering', bank: 'EE', sourceSections: ['EE'], count: 25 },
                { name: 'Electronics & Communication', bank: 'EC', sourceSections: ['EC'], count: 10 },
                { name: 'Instrumentation Engineering', bank: 'IN', sourceSections: ['IN'], count: 10 }
            ]
        },
        {
            code: 'CH',
            title: 'Chemical Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE Chemical Engineering question bank (2015-2025), across General Aptitude and Chemical Engineering. Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['CL', 'CH'],
            sections: [
                { name: 'General Aptitude', sourceSections: ['GA'], count: 5 },
                { name: 'Chemical Engineering', sourceSections: ['CH'], count: 45 }
            ]
        },
        {
            code: 'MT',
            title: 'Metallurgical Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE Metallurgical Engineering question bank (2014-2026), across General Aptitude and Metallurgical Engineering. Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['MT', 'MSE'],
            sections: [
                { name: 'General Aptitude', sourceSections: ['GA'], count: 5 },
                { name: 'Metallurgical Engineering', sourceSections: ['MT'], count: 45 }
            ]
        },
        {
            code: 'CE',
            title: 'Civil Engineering Mock Test',
            description: '50 questions drawn at random across all eight Civil Engineering topics. Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['CE'],
            // Counts sum to 50.
            sections: [
                { name: 'Structural Engineering', sourceSections: ['StructuralEngineering'], count: 7 },
                { name: 'Water Resources Engineering', sourceSections: ['WaterResourcesEngineering'], count: 7 },
                { name: 'Geotechnical Engineering', sourceSections: ['GeotechnicalEngineering'], count: 6 },
                { name: 'Construction Planning & Management', sourceSections: ['CPM'], count: 6 },
                { name: 'Environmental Engineering', sourceSections: ['EnvironmentalEngineering'], count: 6 },
                { name: 'Transportation Engineering', sourceSections: ['Transportation'], count: 6 },
                { name: 'Engineering Mathematics', sourceSections: ['EngineeringMathematics'], count: 6 },
                { name: 'Surveying', sourceSections: ['Surveying'], count: 6 }
            ]
        }
    ]
};
