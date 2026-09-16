const XLSX = require('xlsx');
const path = require('path');

// Define columns for both text and image-based questions
const headers = [
    'section',
    'type',
    'marks',
    'negative_marks',
    'question',
    'question image(if there is can be null)',
    'option a',
    'option b',
    'option c',
    'option d',
    'correct answer (for mcq)',
    'integer based answer'
];

// Create workbook
const wb = XLSX.utils.book_new();

// Add empty sheet with headers
const ws = XLSX.utils.aoa_to_sheet([headers]);

// Set column widths for better visibility
ws['!cols'] = headers.map(() => ({ wch: 25 }));

// Append sheet
XLSX.utils.book_append_sheet(wb, ws, 'Mechanical_Questions');

// Write to file
const outputPath = path.join(__dirname, '../questions/mechanical/gate_mechanical_template.xlsx');
XLSX.writeFile(wb, outputPath);

console.log(`Template created at ${outputPath}`);
