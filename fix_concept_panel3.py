with open(r'D:\.pogget\user_storage\u_461180\b9b8b\app\(dashboard)\project\[id]\workflow\page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# ConceptPanel function close: find 'function StoryboardMockImage'
sb_idx = None
for i, l in enumerate(lines):
    if 'function StoryboardMockImage' in l:
        sb_idx = i
        break

# ConceptPanel close: find the '}' that closes ConceptPanel (before the empty line at 3553)
# The function close is at line 3552 (the '}' before the empty line 3553)
# So we want to delete lines [3553, sb_idx) - everything between ConceptPanel close and StoryboardMockImage
concept_close = 3552  # line index of '}' closing ConceptPanel function

# Verify
print(f'StoryboardMockImage at line {sb_idx}')
print(f'Line 3551: {repr(lines[3551][:60])}')  # should be '  );'
print(f'Line 3552: {repr(lines[3552][:60])}')  # should be '}'
print(f'Line 3553: {repr(lines[3553][:60])}')  # should be empty
print(f'Line {sb_idx}: {repr(lines[sb_idx][:60])}')  # should be StoryboardMockImage

# Delete lines 3553 through sb_idx-1 (the orphaned block)
new_lines = lines[:3553] + lines[sb_idx:]

with open(r'D:\.pogget\user_storage\u_461180\b9b8b\app\(dashboard)\project\[id]\workflow\page.tsx', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(new_lines)
print('Done, total lines:', len(new_lines))