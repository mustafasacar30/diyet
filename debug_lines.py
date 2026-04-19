with open('src/app/patients/[id]/page.tsx', 'r', encoding='utf8') as f:
    lines = f.readlines()

# Write key sections to file
with open('debug_output.txt', 'w', encoding='utf8') as out:
    out.write("=== LINES 3320-3370 (return + Dialog + DndContext start) ===\n")
    for i in range(3319, 3370):
        out.write(f"{i+1}: {lines[i]}")
    
    out.write("\n=== LINES 3930-3945 (around DndContext close / error area) ===\n")
    for i in range(3929, min(3945, len(lines))):
        out.write(f"{i+1}: {lines[i]}")
    
    out.write(f"\n\nTotal lines: {len(lines)}\n")
