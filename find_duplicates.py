#!/usr/bin/env python3
import re

def fix_duplicate_functions(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Store function info to track duplicates
    function_map = {}
    
    # Pattern to match function definitions (const functions only)
    pattern = re.compile(r'^(\s*)(const\s+)([a-zA-Z0-9_]+)\s*\([^)]*\)\s*=>\s*{\n                        (?:[\s\S]*?)^\s*}
                       ', re.MULTILINE | re.DOTALL)

    # Also look for named function declarations
    pattern2 = re.compile(r'^(\s*)(const\s+)([a-zA-Z0-9_]+)\s*=\s*\([^)]*\)\s*{\n                        (?:[\s\S]*?)^\s*}
                       ', re.MULTILINE | re.DOTALL)

    # Find all matches
    lines = content.split('\n')
    functions = []
    for i, line in enumerate(lines):
        # Handle both const function() => {...} and const function() {...} patterns
        if 'const ' in line and ('=>' in line or '{' in line):
            # Find the function start line
            start_line = i
            start_indent = len(line) - len(line.lstrip())
            
            # Find matching closing brace
            brace_count = 0
            in_function = False
            function_lines = []
            
            for j in range(i, len(lines)):
                line_j = lines[j]
                if not in_function:
                    # Check if this line is part of a function definition
                    if '=>' in line_j or line_j.strip().startswith('const '):
                        in_function = True
                
                if in_function:
                    function_lines.append(line_j)
                    # Count braces
                    brace_count += line_j.count('{')
                    brace_count -= line_j.count('}')
                    
                    if brace_count == 0 and in_function:
                        # Found end of function
                        functions.append((start_line, j, function_lines, start_indent))
                        break

    # Collect function names
    function_names = {}
    for start_line, end_line, func_lines, indent in functions:
        # Extract function name from first line
        first_line = func_lines[0].strip()
        if 'const ' in first_line and ('=>' in first_line or first_line.endswith(') {')):
            # Extract function name - simpler approach
            if '=>' in first_line:
                # const funcName => {
                func_name = first_line.split('const ')[1].split('=>')[0].strip()
            else:
                # const funcName() {
                func_name = first_line.split('const ')[1].split('(')[0].strip()
            
            if func_name not in function_names:
                function_names[func_name] = []
            function_names[func_name].append((start_line, end_line, func_lines, indent))

    # Find duplicates (functions defined more than once)
    duplicates = {name: info for name, info in function_names.items() if len(info) > 1}
    
    if not duplicates:
        print("No duplicate functions found")
        return

    print(f"Found {len(duplicates)} duplicate functions: {list(duplicates.keys())}")
    
    # Remove duplicates - keep the first occurrence, remove subsequent ones
    new_lines = lines[:]
    functions_to_remove = set()
    
    for func_name, occurrences in duplicates.items():
        for i, (start_line, end_line, func_lines, indent) in enumerate(occurrences[1:]):  # Skip first occurrence
            print(f"Removing duplicate '{func_name}' at line {start_line + 1}")
            functions_to_remove.add((start_line, end_line))
    
    # Build new content removing functions
    result_lines = []
    i = 0
    while i < len(new_lines):
        to_skip = False
        for start, end in functions_to_remove:
            if i == start:
                # Skip from start to end
                i = end + 1
                to_skip = True
                break
        
        if not to_skip:
            result_lines.append(new_lines[i])
            i += 1
    
    # Write back
    with open(filepath, 'w') as f:
        f.write('\n'.join(result_lines))
    
    print(f"Fixed duplicate functions in {filepath}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        fix_duplicate_functions(sys.argv[1])
    else:
        fix_duplicate_functions('C:/Users/Kumar/OneDrive/Desktop/anonymous-collab-website/frontend/src/pages/OfficeBoard.jsx')