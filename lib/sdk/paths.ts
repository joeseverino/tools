// TOOLS_HOME is the checkout this code was loaded from, so a worktree or a copy
// runs its own files whatever the caller exported. CODE_HOME is the root that
// holds Projects/ and Assets/; it follows from where the checkout lives
// (Assets/tools) unless the caller sets it.
import path from 'node:path';

export const toolsHome = path.resolve(import.meta.dirname, '../..');
export const codeHome = process.env['CODE_HOME'] || path.resolve(toolsHome, '../..');
/** The TOOLS_HOME the caller exported, which is how programs outside this checkout find tools. */
export const exportedToolsHome = process.env['TOOLS_HOME'] || undefined;
