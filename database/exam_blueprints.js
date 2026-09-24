/**
 * exam_blueprints.js — the single place where mock-exam structure is configured.
 *
 * Everything the generator needs to know about "what a mock exam for department X
 * looks like" lives here. Editing this file and re-running
 * `node database/import_question_bank.js` is enough to change a paper's shape —
 * no controller or SQL change is needed.
 *
 * How a paper is built at attempt time:
 *   For each section below, `count` questions are drawn at random (MySQL ORDER BY
 *   RAND()) from the Question_Bank rows whose `department` matches and whose
 *   `section` is in `sourceSections`. A fresh draw happens on every attempt, so
 *   two students — or the same student twice — never see the same 50 questions.
 *
 *   `sourceSections: []`  means "every section belonging to this department",
 *   i.e. one flat pool. That is the default for all the GATE/ESE subjects, whose
 *   source data only distinguishes General Aptitude from the core subject.
 *
 *   CE is the one department whose source data carries real topic subsections,
 *   so its paper is split across all eight of them.
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

    departments: [
        {
            code: 'CSE',
            metadata: 'CSE/metadata.csv',
            title: 'Computer Science & Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE CSE question bank. Every attempt gives you a new paper.',
            durationMinutes: 90,
            // Aliases let a student's `discipline` value from allowed_students
            // resolve to this exam so the dashboard can badge it as theirs.
            disciplines: ['CSE', 'CS', 'AI', 'ICDT', 'CG'],
            sections: [
                { name: 'Computer Science & Engineering', sourceSections: [], count: 50 }
            ]
        },
        {
            code: 'ME',
            metadata: 'ME/metadata.csv',
            title: 'Mechanical Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE ME question bank (2016-2025). Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['ME'],
            sections: [
                { name: 'Mechanical Engineering', sourceSections: [], count: 50 }
            ]
        },
        {
            code: 'EE',
            metadata: 'GATE_ESE_Papers/EE/metadata.csv',
            title: 'Electrical Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE-EE and ESE-EE Prelims question bank. Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['EE'],
            sections: [
                { name: 'Electrical Engineering', sourceSections: [], count: 50 }
            ]
        },
        {
            code: 'EC',
            metadata: 'GATE_ESE_Papers/EC/metadata.csv',
            title: 'Electronics & Communication Mock Test',
            description: '50 randomly drawn questions from the GATE-EC and ESE-ECE Prelims question bank. Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['EC', 'ECE'],
            sections: [
                { name: 'Electronics & Communication', sourceSections: [], count: 50 }
            ]
        },
        {
            code: 'IN',
            metadata: 'GATE_ESE_Papers/IN/metadata.csv',
            title: 'Instrumentation Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE-IN question bank (2018-2026). Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['IN'],
            sections: [
                { name: 'Instrumentation Engineering', sourceSections: [], count: 50 }
            ]
        },
        {
            code: 'CH',
            metadata: 'CH/metadata.csv',
            title: 'Chemical Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE Chemical Engineering question bank (2015-2025). Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['CL', 'CH'],
            sections: [
                { name: 'Chemical Engineering', sourceSections: [], count: 50 }
            ]
        },
        {
            code: 'MT',
            metadata: 'MT/metadata.csv',
            title: 'Metallurgical Engineering Mock Test',
            description: '50 randomly drawn questions from the GATE Metallurgical Engineering question bank (2014-2026). Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['MT', 'MSE'],
            sections: [
                { name: 'Metallurgical Engineering', sourceSections: [], count: 50 }
            ]
        },
        {
            code: 'GS',
            metadata: 'GATE_ESE_Papers/GS/metadata.csv',
            title: 'General Studies & Engineering Aptitude Mock Test',
            description: '50 randomly drawn questions from the ESE Prelims General Studies question bank. Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: [],
            sections: [
                { name: 'General Studies & Engineering Aptitude', sourceSections: [], count: 50 }
            ]
        },
        {
            code: 'CE',
            metadata: 'CE/metadata.csv',
            title: 'Civil Engineering Mock Test',
            description: '50 questions drawn at random across all eight Civil Engineering topics. Every attempt gives you a new paper.',
            durationMinutes: 90,
            disciplines: ['CE'],
            // The only department whose source data carries real topic subsections.
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
