const fs = require('fs');

// Read the original file
const lines = fs.readFileSync('src/components/job-modules/final-valuation-tabs/SalesComparisonTab.jsx', 'utf8').split('\n');

// Read the new detailed tab
const newDetailedTab = fs.readFileSync('temp-detailed-tab.txt', 'utf8');

// Split the file into three parts:
// Part 1: Lines 1-2514 (before detailed tab)
// Part 2: New detailed tab (replacing lines 2515-3374)
// Part 3: Lines 3375-end (after detailed tab)

const part1 = lines.slice(0, 2514).join('\n'); // Lines 1-2514 (0-indexed: 0-2513)
const part3 = lines.slice(3374).join('\n');     // Lines 3375-end (0-indexed: from 3374)

// Combine all parts
const newContent = part1 + '\n        ' + newDetailedTab + '\n' + part3;

// Write the updated file
fs.writeFileSync('src/components/job-modules/final-valuation-tabs/SalesComparisonTab.jsx', newContent);

console.log('✅ Detailed tab section replaced successfully!');
console.log(`   - Original detailed tab: ${3374-2515+1} lines`);
console.log(`   - New detailed tab: ${newDetailedTab.split('\n').length} lines`);
