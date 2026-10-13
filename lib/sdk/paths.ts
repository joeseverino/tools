// CODE_HOME is the root that holds Projects/ and Assets/. It follows from where
// this checkout lives (Assets/tools), so no module keeps its own default.
import path from 'node:path';

export const toolsHome = process.env['TOOLS_HOME'] || path.resolve(import.meta.dirname, '../..');
export const codeHome = process.env['CODE_HOME'] || path.resolve(toolsHome, '../..');
