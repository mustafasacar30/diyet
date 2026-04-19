import sys
with open('src/app/patients/[id]/page.tsx', 'r', encoding='utf8') as f:
    lines = f.readlines()
with open('lines_output.txt', 'w', encoding='utf8') as f:
    for i in range(3315, 3375):
        f.write(f"{i+1}: {lines[i].rstrip()}\n")
