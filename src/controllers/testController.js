const getPool = require('../config/db');

// Fetch questions for a specific test ID securely
// Crucially, this must NOT send the `correct_answer` column back to the frontend.
exports.getTestArenaData = async (req, res) => {
    try {
        const testId = req.params.testId;
        const pool = await getPool;

        // Fetch test details
        const [tests] = await pool.query('SELECT * FROM Tests WHERE id = ?', [testId]);
        if (tests.length === 0) {
            return res.status(404).json({ message: 'Test not found' });
        }

        const testData = tests[0];

        // Fetch questions but exclude 'correct_answer', randomizing and clipping to test's limit
        const limitCount = parseInt(testData.total_questions) || 30;

        const [questions] = await pool.query(`
            SELECT * FROM (
                SELECT q.id, q.test_id, q.section_id, q.question_text, q.image_url, q.options, q.question_type, q.marks, q.negative_marks, s.section_name, s.duration_minutes
                FROM Questions q
                LEFT JOIN Test_Sections s ON q.section_id = s.id
                WHERE q.test_id = ?
                ORDER BY RAND()
                LIMIT ?
            ) AS random_qs
            ORDER BY random_qs.section_id, random_qs.id
        `, [testId, limitCount]);

        // Group into sections for the frontend format
        const groupedSections = [];
        let currentSectionId = null;
        let currentSectionObj = null;

        for (const q of questions) {
            if (q.section_id !== currentSectionId) {
                currentSectionId = q.section_id;
                currentSectionObj = {
                    section_id: q.section_id,
                    section_name: q.section_name,
                    duration_minutes: q.duration_minutes,
                    questions: []
                };
                groupedSections.push(currentSectionObj);
            }
            currentSectionObj.questions.push({
                id: q.id,
                test_id: q.test_id,
                question_text: q.question_text,
                image_url: q.image_url,
                options: q.options,
                question_type: q.question_type,
                marks: q.marks,
                negative_marks: q.negative_marks
            });
        }

        res.json({
            test: testData,
            sections: groupedSections
        });
    } catch (error) {
        console.error('Fetch Test Data Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// Receive and grade a test submission
exports.submitTest = async (req, res) => {
    try {
        const testId = req.params.testId;
        const studentId = req.user.id; // Protected route
        const { answers, time_taken_seconds, violation_count, auto_submitted } = req.body;
        // `answers` is expected to be a map of { questionId: "selected_option" }

        const pool = await getPool;

        // Ensure user hasn't already submitted this test
        const [existing] = await pool.query(
            'SELECT id FROM Test_Results WHERE student_id = ? AND test_id = ?',
            [studentId, testId]
        );

        if (existing.length > 0) {
            return res.status(400).json({ message: 'Test already submitted' });
        }

        // Fetch all correct answers for grading
        const [questions] = await pool.query(
            'SELECT id, correct_answer, question_type, marks, negative_marks FROM Questions WHERE test_id = ?',
            [testId]
        );

        let score = 0;
        let correctCount = 0;
        let totalAnswered = 0;

        // Grading logic (+4 for correct, -1 for incorrect is a standard pattern)
        for (let q of questions) {
            const studentAns = answers[q.id];

            if (studentAns) {
                totalAnswered++;
                // Comparing logic might need to handle strings depending on `options` format
                // For NAT, we do a loose string comparison ignoring trailing spaces
                const isCorrect = (q.question_type === 'NAT')
                    ? String(studentAns).trim() === String(q.correct_answer).trim()
                    : studentAns === q.correct_answer;

                if (isCorrect) {
                    score += parseFloat(q.marks ?? 4);
                    correctCount++;
                } else {
                    score -= parseFloat(q.negative_marks ?? 1); // Negative marking
                }
            }
        }

        // Save result
        const [result] = await pool.query(
            'INSERT INTO Test_Results (student_id, test_id, score, time_taken_seconds) VALUES (?, ?, ?, ?)',
            [studentId, testId, score, time_taken_seconds || 0]
        );

        // Also store the raw answers for future review
        await pool.query(
            'INSERT INTO Test_Result_Answers (result_id, answers) VALUES (?, ?)',
            [result.insertId, JSON.stringify(answers)]
        );

        // Persist violations if any occurred during this session
        const vCount = parseInt(violation_count) || 0;
        if (vCount > 0) {
            await pool.query(
                `INSERT INTO Test_Violations (student_id, test_id, result_id, violation_type, violation_count, auto_submitted)
                 VALUES (?, ?, ?, 'tab_switch_or_fullscreen_exit', ?, ?)`,
                [studentId, testId, result.insertId, vCount, auto_submitted ? 1 : 0]
            );
        }

        res.json({
            message: 'Test submitted and graded successfully',
            score: score,
            correct: correctCount,
            totalAnswered: totalAnswered,
            resultId: result.insertId
        });

    } catch (error) {
        console.error('Submit Test Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// Fetch a completed result for review (reveals correct answers)
exports.getReview = async (req, res) => {
    try {
        const resultId = req.params.resultId;
        const studentId = req.user.id;
        const pool = await getPool;

        // Fetch the result (make sure it belongs to the requesting student)
        const [results] = await pool.query(
            `SELECT r.*, t.title, t.total_questions FROM Test_Results r
             JOIN Tests t ON r.test_id = t.id
             WHERE r.id = ? AND r.student_id = ?`,
            [resultId, studentId]
        );

        if (results.length === 0) {
            return res.status(404).json({ message: 'Result not found or access denied' });
        }

        const resultData = results[0];

        // Fetch questions WITHOUT correct answers (as per new requirements)
        // We will only reveal if they got it wrong, not what the right answer is.
        const [questions] = await pool.query(`
            SELECT q.id, q.question_text, q.image_url, q.options, q.correct_answer, q.question_type, q.marks, q.negative_marks, s.section_name, s.id as section_id
            FROM Questions q
            LEFT JOIN Test_Sections s ON q.section_id = s.id
            WHERE q.test_id = ?
            ORDER BY s.id, q.id
        `, [resultData.test_id]);

        // Fetch the student's submitted answers for this result
        const [answerRows] = await pool.query(
            'SELECT answers FROM Test_Result_Answers WHERE result_id = ?',
            [resultId]
        );

        const submittedAnswers = answerRows.length > 0
            ? (typeof answerRows[0].answers === 'string' ? JSON.parse(answerRows[0].answers) : answerRows[0].answers)
            : {};

        // Before sending to frontend, we must strip the correct answers from the array
        // and optionally bundle section-level stats here later
        const sanitizedQuestions = questions.map(q => {
            const studentAns = submittedAnswers[q.id];
            const isCorrect = (q.question_type === 'NAT')
                ? String(studentAns).trim() === String(q.correct_answer).trim()
                : studentAns === q.correct_answer;

            return {
                id: q.id,
                question_text: q.question_text,
                image_url: q.image_url,
                options: q.options,
                question_type: q.question_type,
                marks: q.marks,
                negative_marks: q.negative_marks,
                section_name: q.section_name,
                section_id: q.section_id,
                isCorrect: studentAns ? isCorrect : false,
                isWrong: studentAns ? !isCorrect : false,
                studentAnswer: studentAns || null
            };
        });

        // Compute Statistics
        let totalNegatives = 0;
        let totalCorrect = 0;
        const sectionStats = {}; // { section_id: { name, score, maxScore } }

        for (const q of questions) {
            const secId = q.section_id;
            if (!sectionStats[secId]) {
                sectionStats[secId] = { name: q.section_name, score: 0, maxScore: 0 };
            }

            const isCorrect = (q.question_type === 'NAT')
                ? String(submittedAnswers[q.id]).trim() === String(q.correct_answer).trim()
                : submittedAnswers[q.id] === q.correct_answer;

            sectionStats[secId].maxScore += parseFloat(q.marks ?? 4);

            if (submittedAnswers[q.id]) {
                if (isCorrect) {
                    sectionStats[secId].score += parseFloat(q.marks ?? 4);
                    totalCorrect++;
                } else {
                    sectionStats[secId].score -= parseFloat(q.negative_marks ?? 1);
                    totalNegatives++;
                }
            }
        }

        // Get Average score for this test across all users
        const [avgRows] = await pool.query(
            'SELECT AVG(score) as avg_score FROM Test_Results WHERE test_id = ?',
            [resultData.test_id]
        );
        const averageScore = avgRows[0].avg_score ? parseFloat(avgRows[0].avg_score).toFixed(2) : 0;

        res.json({
            result: resultData,
            questions: sanitizedQuestions,
            stats: {
                totalCorrect,
                totalNegatives,
                sectionScores: Object.values(sectionStats),
                averageScore: parseFloat(averageScore)
            }
        });

    } catch (error) {
        console.error('Review Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
