#!/usr/bin/env python3

# Read the original file
with open('src/components/job-modules/final-valuation-tabs/SalesComparisonTab.jsx', 'r') as f:
    lines = f.readlines()

# Read the new detailed tab
with open('temp-detailed-tab.txt', 'r') as f:
    new_detailed_tab = f.read()

# Split the file into three parts:
# Part 1: Lines 1-2514 (before detailed tab)
# Part 2: New detailed tab (replacing lines 2515-3374)
# Part 3: Lines 3375-end (after detailed tab)

part1 = ''.join(lines[0:2514])  # Lines 1-2514 (0-indexed: 0-2513)
part3 = ''.join(lines[3374:])    # Lines 3375-end (0-indexed: from 3374)

# Combine all parts
new_content = part1 + '\n        ' + new_detailed_tab + '\n' + part3

# Write the updated file
with open('src/components/job-modules/final-valuation-tabs/SalesComparisonTab.jsx', 'w') as f:
    f.write(new_content)

print("✅ Detailed tab section replaced successfully!")
print(f"   - Original detailed tab: {3374-2515+1} lines")
print(f"   - New detailed tab: {len(new_detailed_tab.splitlines())} lines")
