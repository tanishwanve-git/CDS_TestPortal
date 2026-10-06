/**
 * departments.js — which mock exams belong to which department.
 *
 * A department is a roster discipline value: allowed_students.discipline (and
 * secondary_discipline, for a dual-major student), which is also what
 * department_heads.department holds. The roster spells these out in full
 * ("Civil", "Computer Science") because seed_students.py expands the
 * registrar's codes.
 *
 * A mock exam names the departments it serves by code instead: its own
 * Mock_Exams.department ("CE") plus the alias list in Mock_Exams.disciplines
 * ("CSE,CS,AI,ICDT,CG"), both written from database/exam_blueprints.js. So a
 * roster name is translated back to its code before the two are compared. A
 * value that is already a code passes through unchanged.
 */

// The inverse of seed_students.py's `disp_mapping`.
const NAME_TO_CODE = {
    'artificial intelligence': 'AI',
    'chemical': 'CL',
    'civil': 'CE',
    'mechanical': 'ME',
    'computer science': 'CSE',
    'electrical': 'EE',
    'humanities and social sciences': 'HSS',
    'cognitive and brain sciences': 'CG',
    'mathematics': 'MA',
    'physics': 'PH',
    'biological sciences and engineering': 'BE',
    'earth sciences': 'ESS',
    'integrated circuit design & technology': 'ICDT',
    'materials': 'MSE'
    // "Chemistry" is deliberately absent. The registrar codes it CH, but CH is
    // also GATE's code for Chemical Engineering, which is what the CH exam is.
};

function disciplineCode(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return NAME_TO_CODE[raw.toLowerCase()] || raw.toUpperCase();
}

function examCodes(exam) {
    return new Set(
        [exam.department, ...String(exam.disciplines || '').split(',')]
            .map(s => String(s || '').trim().toUpperCase())
            .filter(Boolean)
    );
}

/** Is `exam` (a Mock_Exams row) a test for any of `departments`? */
function examServes(exam, departments) {
    const codes = examCodes(exam);
    return departments.some(d => {
        const code = disciplineCode(d);
        return Boolean(code) && codes.has(code);
    });
}

/**
 * A roster row's departments: its discipline, plus the second major for a
 * dual-major student.
 */
function departmentsOf(row) {
    return [row?.discipline, row?.secondary_discipline]
        .map(v => String(v || '').trim())
        .filter(Boolean);
}

/** Ids of every mock exam (active or not) that serves one of `departments`. */
async function examIdsFor(pool, departments) {
    const [exams] = await pool.query('SELECT id, department, disciplines FROM Mock_Exams');
    return exams.filter(e => examServes(e, departments)).map(e => e.id);
}

/**
 * A signed-in student's departments. The allow list is the source of truth;
 * Students.discipline is only a copy taken at first sign-in, used if the roster
 * row has since gone.
 */
async function studentDepartments(pool, studentId) {
    const [[row]] = await pool.query(
        `SELECT COALESCE(al.discipline, s.discipline, s.branch) AS discipline,
                al.secondary_discipline
           FROM Students s
           LEFT JOIN allowed_students al ON LOWER(al.email) = LOWER(s.email)
          WHERE s.id = ?`,
        [studentId]
    );
    return departmentsOf(row);
}

module.exports = { examServes, departmentsOf, examIdsFor, studentDepartments };
