with open(r'D:\.pogget\user_storage\u_461180\b9b8b\app\api\projects\[id]\steps\concept\generate-one\route.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Lines 119-143 (0-indexed 118-142) are the duplicate block to remove
# Keep lines[:118] + lines[143:]
new_lines = lines[:119] + lines[143:]

with open(r'D:\.pogget\user_storage\u_461180\b9b8b\app\api\projects\[id]\steps\concept\generate-one\route.ts', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(new_lines)
print('Done, total lines:', len(new_lines))
# Verify
with open(r'D:\.pogget\user_storage\u_461180\b9b8b\app\api\projects\[id]\steps\concept\generate-one\route.ts', 'r', encoding='utf-8') as f:
    content = f.read()
print('Duplicate count:', content.count('CONCEPT 步骤已更新'))
print('actProgress count:', content.count('actProgress'))