import sys
with open('src/app/patients/[id]/page.tsx', 'r', encoding='utf8') as f:
    text = f.read()

# Make sure Fragment opens after 'return (' correctly
import re
text = re.sub(r'return \(\s*<Dialog open=\{blockedFoodDialog\.open\}', 
              r'return (\n        <>\n            <Dialog open={blockedFoodDialog.open}', 
              text)

# Also check that we added the closing Fragment tag properly
# The end of the DndContext is the tricky part
# Let's find '</DndContext>' and if the next non-whitespace is not '</>', we add it.
idx = text.rfind('</DndContext>')
if idx != -1:
    line_end = text.find('\n', idx)
    # Don't add if it's already there
    if '</>' not in text[idx:idx+100]:
        text = text[:line_end + 1] + '        </>\n' + text[line_end + 1:]

with open('src/app/patients/[id]/page.tsx', 'w', encoding='utf8') as f:
    f.write(text)

print("Fixed JSX fragments!")
