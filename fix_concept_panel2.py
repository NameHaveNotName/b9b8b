with open(r'D:\.pogget\user_storage\u_461180\b9b8b\app\(dashboard)\project\[id]\workflow\page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the StoryboardMockImage start and the orphaned "整体重做" block
sb_idx = None
for i, l in enumerate(lines):
    if 'function StoryboardMockImage' in l:
        sb_idx = i
        break

# Find the orphaned block start (line after ConceptPanel close that contains showConfirmAll)
orphaned_start = None
for i in range(3550, sb_idx if sb_idx else 3600):
    if '!showConfirmAll' in lines[i] and i > 3560:
        orphaned_start = i
        break

print(f'StoryboardMockImage at {sb_idx}, orphaned block starts at {orphaned_start}')

# Delete lines [orphaned_start, sb_idx) — the orphaned "整体重做" from the old file
new_lines = lines[:orphaned_start] + lines[sb_idx:]

with open(r'D:\.pogget\user_storage\u_461180\b9b8b\app\(dashboard)\project\[id]\workflow\page.tsx', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(new_lines)
print('Done, total lines:', len(new_lines))