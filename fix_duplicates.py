#!/usr/bin/env python3
import re

def fix_duplicate_functions(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Pattern to find function definitions (const function_name() => { ... } or const function_name() { ... })
    pattern = r'^(\s*)(const\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:=>\s*)?\{)((?:(?:[\s\S]*?)\^\s*\}|(?:\n[^\n]*?(?:\{\s*\n)?)[^\n]*?(?:\}\s*\n)?)|(?:\n[^\n]*?(?:\{\s*\n)?)(?:(?:(?!(?:^\s*(?:const\s+[a-zA-Z0-9_]+\s*\([^)]*\)\s*(?:=>\s*)?\{))).)*\{\s*\n)(?:[\s\S]*?)\n\s*}\s*\n)generate all possible matches)")
    # This is a simplification - match const function_name() => { up to the next top-level const or function
    
    # Instead, let's find all const function definitions and track their positions
    lines = content.split('\n')
    
    # Find all function definitions
    functions = []
    for i, line in enumerate(lines):
        # Check for const function_name = () => { or const function_name() => {
        if 'const ' in line and '=' in line:
            match = re.search(r'const\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*=>\s*\{', line)
            if match:
                func_name = match.group(1)
                functions.append((func_name, i, 'arrow'))
        # Check for const function_name() => {
        elif 'const ' in line and '=>' in line:
            match = re.search(r'const\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*=>\s*\{', line)
            if match:
                func_name = match.group(1)
                functions.append((func_name, i, 'arrow'))
    
    # Count function occurrences
    func_counts = {}
    for func_name, line_num, _ in functions:
        if func_name in func_counts:
            func_counts[func_name] += 1
        else:
            func_counts[func_name] = 1
    
    # Find duplicates
    duplicates = {k: v for k, v in func_counts.items() if v > 1}
    
    if not duplicates:
        print("No duplicate functions found")
        return

    print(f"Found {len(duplicates)} duplicate functions: {list(duplicates.keys())}")
    
    # Remove duplicates - keep the first occurrence, remove subsequent ones
    new_lines = []
    i = 0
    while i < len(lines):
        # Check if current line starts a duplicate function (not the first occurrence)
        is_duplicate = False
        for func_name, count in duplicates.items():
            if count > 1 and i + 1 < len(lines) and (
                (i + 1 < len(lines) and 'const ' in lines[i] and '=>' in lines[i] and func_name in lines[i]) or
                (i + 1 < len(lines) and 'const ' in lines[i] and func_name in lines[i])
            ):
                # Skip one occurrence of this duplicate
                # Count braces to find the end of the function
                brace_count = 1
                j = i
                while j < len(lines) and brace_count > 0:
                    brace_count += lines[j].count('{')
                    brace_count -= lines[j].count('}')
                    j += 1
                if brace_count == 0:
                    # This is a duplicate, skip it
                    i = j
                    is_duplicate = True
                    break
        
        if not is_duplicate:
            new_lines.append(lines[i])
            i += 1
        else:
            # Already skipped this function
            continue
    
    # Write back
    with open(filepath, 'w') as f:
        f.write('\n'.join(new_lines))
    
    print(f"Fixed duplicate functions in {filepath}")

if __name__ == "__main__":
    fix_duplicate_functions('C:/Users/Kumar/OneDrive/Desktop/anonymous-collab-website/frontend/src/pages/OfficeBoard.jsx')