/**
 * Breaking Change Detection Utility
 *
 * Analyzes git diffs to detect potential breaking changes such as:
 * - Removed public functions/methods/classes
 * - Changed function signatures (parameters added/removed/reordered)
 * - Renamed exports
 * - Modified API contracts (changed return types, removed properties)
 * - Removed or renamed configuration options
 * - Changed default values
 */

export interface BreakingChangeHint {
  type: BreakingChangeType;
  description: string;
  file: string;
  lineInfo?: string;
}

export enum BreakingChangeType {
  REMOVED_EXPORT = 'removed_export',
  REMOVED_FUNCTION = 'removed_function',
  REMOVED_CLASS = 'removed_class',
  REMOVED_METHOD = 'removed_method',
  REMOVED_PROPERTY = 'removed_property',
  CHANGED_SIGNATURE = 'changed_signature',
  RENAMED_EXPORT = 'renamed_export',
  REMOVED_PARAMETER = 'removed_parameter',
  CHANGED_RETURN_TYPE = 'changed_return_type',
  REMOVED_TYPE = 'removed_type',
  REMOVED_INTERFACE = 'removed_interface',
  CHANGED_DEFAULT_VALUE = 'changed_default_value',
  REMOVED_CONFIG_OPTION = 'removed_config_option'
}

// Patterns to detect removals in diffs (lines starting with -)
const BREAKING_PATTERNS = {
  // JavaScript/TypeScript patterns
  exportedFunction: /^-\s*export\s+(async\s+)?function\s+(\w+)/,
  exportedClass: /^-\s*export\s+(default\s+)?class\s+(\w+)/,
  exportedConst: /^-\s*export\s+(const|let|var)\s+(\w+)/,
  exportedType: /^-\s*export\s+(type|interface)\s+(\w+)/,
  exportedEnum: /^-\s*export\s+enum\s+(\w+)/,
  namedExport: /^-\s*export\s+\{([^}]+)\}/,
  publicMethod: /^-\s*(public\s+)?(async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/,
  publicProperty: /^-\s*(public\s+|readonly\s+)*(\w+)\s*[?:]?\s*:/,
  interfaceProperty: /^-\s+(\w+)\s*[?:]?\s*:/,

  // Python patterns
  pythonFunction: /^-\s*def\s+(\w+)\s*\(/,
  pythonClass: /^-\s*class\s+(\w+)/,

  // Go patterns
  goExportedFunction: /^-\s*func\s+([A-Z]\w*)\s*\(/,
  goExportedType: /^-\s*type\s+([A-Z]\w*)\s+/,

  // Rust patterns
  rustPubFunction: /^-\s*pub\s+(async\s+)?fn\s+(\w+)/,
  rustPubStruct: /^-\s*pub\s+struct\s+(\w+)/,
  rustPubEnum: /^-\s*pub\s+enum\s+(\w+)/,

  // Ruby patterns
  rubyMethod: /^-\s*def\s+(\w+)/,
  rubyClass: /^-\s*class\s+(\w+)/,

  // General API patterns
  apiEndpoint: /^-\s*['"`](GET|POST|PUT|DELETE|PATCH)\s+\/[^'"`]+['"`]/i,
  routeDefinition:
    /^-\s*(app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]\/[^'"`]+['"`]/i
};

// Patterns to detect signature changes (comparing - and + lines)
const SIGNATURE_CHANGE_PATTERNS = {
  functionParams:
    /^[-+]\s*(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
  methodParams: /^[-+]\s*(public\s+)?(async\s+)?(\w+)\s*\(([^)]*)\)/,
  arrowFunction:
    /^[-+]\s*(export\s+)?(const|let)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*=>/
};

/**
 * Analyzes a git diff to detect potential breaking changes
 */
export function analyzeBreakingChanges(diff: string): BreakingChangeHint[] {
  const hints: BreakingChangeHint[] = [];
  const files = diff.split(/^diff --git /m).slice(1);

  for (const fileDiff of files) {
    const fileMatch = fileDiff.match(/a\/(.+?)\s+b\//);
    const fileName = fileMatch ? fileMatch[1] : 'unknown';

    // Skip test files, they're not breaking changes
    if (isTestFile(fileName)) {
      continue;
    }

    const lines = fileDiff.split('\n');
    const removedLines: string[] = [];
    const addedLines: string[] = [];

    // Collect removed and added lines
    for (const line of lines) {
      if (line.startsWith('-') && !line.startsWith('---')) {
        removedLines.push(line);
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        addedLines.push(line);
      }
    }

    // Check for removed exports/functions/classes
    hints.push(...detectRemovedSymbols(removedLines, addedLines, fileName));

    // Check for signature changes
    hints.push(...detectSignatureChanges(removedLines, addedLines, fileName));
  }

  return hints;
}

/**
 * Check if a file is a test file
 */
function isTestFile(fileName: string): boolean {
  const testPatterns = [
    /\.test\./,
    /\.spec\./,
    /_test\./,
    /_spec\./,
    /^test\//,
    /^tests\//,
    /__tests__\//,
    /\.stories\./
  ];
  return testPatterns.some((pattern) => pattern.test(fileName));
}

/**
 * Detect removed symbols (functions, classes, exports, etc.)
 */
function detectRemovedSymbols(
  removedLines: string[],
  addedLines: string[],
  fileName: string
): BreakingChangeHint[] {
  const hints: BreakingChangeHint[] = [];

  for (const line of removedLines) {
    // Check exported function
    let match = line.match(BREAKING_PATTERNS.exportedFunction);
    if (match) {
      const funcName = match[2];
      if (!isSymbolRenamed(funcName, addedLines, 'function')) {
        hints.push({
          type: BreakingChangeType.REMOVED_FUNCTION,
          description: `Removed exported function '${funcName}'`,
          file: fileName,
          lineInfo: line.substring(1).trim()
        });
      }
      continue;
    }

    // Check exported class
    match = line.match(BREAKING_PATTERNS.exportedClass);
    if (match) {
      const className = match[2];
      if (!isSymbolRenamed(className, addedLines, 'class')) {
        hints.push({
          type: BreakingChangeType.REMOVED_CLASS,
          description: `Removed exported class '${className}'`,
          file: fileName,
          lineInfo: line.substring(1).trim()
        });
      }
      continue;
    }

    // Check exported const/let/var
    match = line.match(BREAKING_PATTERNS.exportedConst);
    if (match) {
      const constName = match[2];
      if (!isSymbolRenamed(constName, addedLines, 'const')) {
        hints.push({
          type: BreakingChangeType.REMOVED_EXPORT,
          description: `Removed exported '${constName}'`,
          file: fileName,
          lineInfo: line.substring(1).trim()
        });
      }
      continue;
    }

    // Check exported type/interface
    match = line.match(BREAKING_PATTERNS.exportedType);
    if (match) {
      const typeName = match[2];
      if (!isSymbolRenamed(typeName, addedLines, 'type')) {
        hints.push({
          type:
            match[1] === 'interface'
              ? BreakingChangeType.REMOVED_INTERFACE
              : BreakingChangeType.REMOVED_TYPE,
          description: `Removed exported ${match[1]} '${typeName}'`,
          file: fileName,
          lineInfo: line.substring(1).trim()
        });
      }
      continue;
    }

    // Check exported enum
    match = line.match(BREAKING_PATTERNS.exportedEnum);
    if (match) {
      const enumName = match[1];
      if (!isSymbolRenamed(enumName, addedLines, 'enum')) {
        hints.push({
          type: BreakingChangeType.REMOVED_TYPE,
          description: `Removed exported enum '${enumName}'`,
          file: fileName,
          lineInfo: line.substring(1).trim()
        });
      }
      continue;
    }

    // Check named exports
    match = line.match(BREAKING_PATTERNS.namedExport);
    if (match) {
      const exports = match[1].split(',').map((e) => e.trim());
      for (const exp of exports) {
        const exportName = exp.split(' as ')[0].trim();
        if (!isNamedExportPresent(exportName, addedLines)) {
          hints.push({
            type: BreakingChangeType.REMOVED_EXPORT,
            description: `Removed named export '${exportName}'`,
            file: fileName,
            lineInfo: line.substring(1).trim()
          });
        }
      }
      continue;
    }

    // Check API endpoints
    match = line.match(BREAKING_PATTERNS.apiEndpoint);
    if (match) {
      hints.push({
        type: BreakingChangeType.REMOVED_EXPORT,
        description: `Removed API endpoint`,
        file: fileName,
        lineInfo: line.substring(1).trim()
      });
      continue;
    }

    // Check route definitions
    match = line.match(BREAKING_PATTERNS.routeDefinition);
    if (match) {
      hints.push({
        type: BreakingChangeType.REMOVED_EXPORT,
        description: `Removed route '${match[2].toUpperCase()}' handler`,
        file: fileName,
        lineInfo: line.substring(1).trim()
      });
    }
  }

  return hints;
}

/**
 * Check if a symbol was renamed (exists in added lines with similar pattern)
 */
function isSymbolRenamed(
  symbolName: string,
  addedLines: string[],
  symbolType: string
): boolean {
  // Look for a similar pattern in added lines
  // This helps avoid false positives when something is just renamed
  const patterns: Record<string, RegExp> = {
    function: new RegExp(`export\\s+(async\\s+)?function\\s+\\w+`),
    class: new RegExp(`export\\s+(default\\s+)?class\\s+\\w+`),
    const: new RegExp(`export\\s+(const|let|var)\\s+\\w+`),
    type: new RegExp(`export\\s+(type|interface)\\s+\\w+`),
    enum: new RegExp(`export\\s+enum\\s+\\w+`)
  };

  const pattern = patterns[symbolType];
  if (!pattern) return false;

  // Check if there's an added line with a similar structure
  // This is a heuristic - if we're removing one export and adding another in the same file,
  // it might be a rename rather than a removal
  return addedLines.some((line) => pattern.test(line));
}

/**
 * Check if a named export is present in added lines
 */
function isNamedExportPresent(
  exportName: string,
  addedLines: string[]
): boolean {
  const pattern = new RegExp(`export\\s+\\{[^}]*\\b${exportName}\\b[^}]*\\}`);
  return addedLines.some((line) => pattern.test(line));
}

/**
 * Detect function/method signature changes
 */
function detectSignatureChanges(
  removedLines: string[],
  addedLines: string[],
  fileName: string
): BreakingChangeHint[] {
  const hints: BreakingChangeHint[] = [];

  // Extract function signatures from removed lines
  const removedSignatures = extractSignatures(removedLines);
  const addedSignatures = extractSignatures(addedLines);

  // Compare signatures
  for (const [funcName, removedParams] of removedSignatures) {
    const addedParams = addedSignatures.get(funcName);
    if (addedParams !== undefined) {
      // Function exists in both, check if signature changed
      const changes = compareParameters(removedParams, addedParams);
      if (changes.length > 0) {
        hints.push({
          type: BreakingChangeType.CHANGED_SIGNATURE,
          description: `Changed signature of '${funcName}': ${changes.join(
            ', '
          )}`,
          file: fileName
        });
      }
    }
  }

  return hints;
}

/**
 * Extract function signatures from diff lines
 */
function extractSignatures(lines: string[]): Map<string, string[]> {
  const signatures = new Map<string, string[]>();

  for (const line of lines) {
    // Try each signature pattern
    for (const pattern of Object.values(SIGNATURE_CHANGE_PATTERNS)) {
      const match = line.match(pattern);
      if (match) {
        // Find the function name and parameters
        const funcName = match[3] || match[2];
        const params = match[4] || match[5] || '';
        if (funcName && !signatures.has(funcName)) {
          signatures.set(funcName, parseParameters(params));
        }
        break;
      }
    }
  }

  return signatures;
}

/**
 * Parse parameter string into individual parameters
 */
function parseParameters(paramString: string): string[] {
  if (!paramString.trim()) return [];

  // Simple parameter parsing - split by comma, extract names
  return paramString
    .split(',')
    .map((p) => {
      // Extract parameter name (before : or =)
      const match = p.trim().match(/^(\w+)/);
      return match ? match[1] : p.trim();
    })
    .filter(Boolean);
}

/**
 * Compare parameters between old and new signatures
 */
function compareParameters(oldParams: string[], newParams: string[]): string[] {
  const changes: string[] = [];

  // Check for removed parameters
  for (const param of oldParams) {
    if (!newParams.includes(param)) {
      changes.push(`removed parameter '${param}'`);
    }
  }

  // Check for added required parameters (potentially breaking)
  const addedParams = newParams.filter((p) => !oldParams.includes(p));
  if (addedParams.length > 0 && oldParams.length > 0) {
    // Only flag as breaking if we had existing params and added new ones
    // (adding to an empty param list is less likely to break things)
    changes.push(`added parameter(s) '${addedParams.join(', ')}'`);
  }

  // Check for reordering (when same params but different order)
  if (
    changes.length === 0 &&
    oldParams.length === newParams.length &&
    oldParams.some((p, i) => p !== newParams[i])
  ) {
    changes.push('reordered parameters');
  }

  return changes;
}

/**
 * Format breaking change hints for inclusion in the prompt
 */
export function formatBreakingChangeHints(hints: BreakingChangeHint[]): string {
  if (hints.length === 0) return '';

  const grouped = new Map<string, BreakingChangeHint[]>();

  // Group by file
  for (const hint of hints) {
    const existing = grouped.get(hint.file) || [];
    existing.push(hint);
    grouped.set(hint.file, existing);
  }

  let result = '\n\n⚠️ POTENTIAL BREAKING CHANGES DETECTED:\n';

  for (const [file, fileHints] of grouped) {
    result += `\nIn ${file}:\n`;
    for (const hint of fileHints) {
      result += `  - ${hint.description}\n`;
    }
  }

  return result;
}

/**
 * Generate breaking change footer for commit message
 */
export function generateBreakingChangeFooter(
  hints: BreakingChangeHint[]
): string {
  if (hints.length === 0) return '';

  const descriptions = hints.map((h) => h.description);
  const uniqueDescriptions = [...new Set(descriptions)];

  return `\n\nBREAKING CHANGE: ${uniqueDescriptions.join('. ')}.`;
}
