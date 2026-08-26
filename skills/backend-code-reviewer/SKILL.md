---
name: backend-code-reviewer
description: >
  # Responsibility
  Responsible for checking if code generated with backend-development skill comply with backend-development skill instructions.
  # When to use
  Use when backend-development skill generates/changes any code.
---

# Flow
1. Check if generated code comply with backend-development skill instructions.
2. Invoke backend-development skill to apply all remarks.

# Things to check:
1. Do not generate code other than code templates shows unless instructions said other way
2. Do not generate spring beans
3. Do not add domain attributes other than event modeling diagram or business docs says
4. Use code templates as much as possible
5. Do not invent attributes or concepts
6. Was unit tests updated based on event modeling gwt-*.md files?
7. **Test generation scope** - Only test classes for read models with GWT files should exist:
   - Check if any test classes exist for read models without corresponding `gwt-{readmodel-id}.md` files
   - If yes, remove those test classes
8. **Test names** - Must match GWT scenario names exactly:
   - Test names must describe the business behavior from the GWT file
   - Generic test names like "when X then Y can be retrieved" are not acceptable
9. **Test content** - Must match GWT file exactly:
   - Test steps must match the GWT file's given/when/then sections exactly
   - Generic "happy path" tests are not acceptable when specific GWT scenarios exist
