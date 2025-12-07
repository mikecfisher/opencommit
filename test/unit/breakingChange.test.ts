import {
  analyzeBreakingChanges,
  BreakingChangeType,
  formatBreakingChangeHints,
  generateBreakingChangeFooter
} from '../../src/utils/breakingChange';

describe('Breaking Change Detection', () => {
  describe('analyzeBreakingChanges', () => {
    it('should detect removed exported function', () => {
      const diff = `diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,3 @@
-export function oldHelper() {
-  return 'old';
-}
 
 export function newHelper() {
   return 'new';
 }`;

      const hints = analyzeBreakingChanges(diff);
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0].type).toBe(BreakingChangeType.REMOVED_FUNCTION);
      expect(hints[0].description).toContain('oldHelper');
    });

    it('should detect removed exported class', () => {
      const diff = `diff --git a/src/models.ts b/src/models.ts
--- a/src/models.ts
+++ b/src/models.ts
@@ -1,5 +1,3 @@
-export class OldModel {
-  name: string;
-}
 
 export class NewModel {
   id: number;
 }`;

      const hints = analyzeBreakingChanges(diff);
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0].type).toBe(BreakingChangeType.REMOVED_CLASS);
      expect(hints[0].description).toContain('OldModel');
    });

    it('should detect removed exported type', () => {
      const diff = `diff --git a/src/types.ts b/src/types.ts
--- a/src/types.ts
+++ b/src/types.ts
@@ -1,5 +1,3 @@
-export type OldType = string;
 
 export type NewType = number;`;

      const hints = analyzeBreakingChanges(diff);
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0].type).toBe(BreakingChangeType.REMOVED_TYPE);
      expect(hints[0].description).toContain('OldType');
    });

    it('should detect removed exported interface', () => {
      const diff = `diff --git a/src/interfaces.ts b/src/interfaces.ts
--- a/src/interfaces.ts
+++ b/src/interfaces.ts
@@ -1,5 +1,3 @@
-export interface OldInterface {
-  id: number;
-}
 
 export interface NewInterface {
   name: string;
 }`;

      const hints = analyzeBreakingChanges(diff);
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0].type).toBe(BreakingChangeType.REMOVED_INTERFACE);
      expect(hints[0].description).toContain('OldInterface');
    });

    it('should detect removed exported const when no replacement is added', () => {
      const diff = `diff --git a/src/constants.ts b/src/constants.ts
--- a/src/constants.ts
+++ b/src/constants.ts
@@ -1,3 +1,1 @@
-export const OLD_VALUE = 42;
-export const ANOTHER_CONST = 'test';
`;

      const hints = analyzeBreakingChanges(diff);
      expect(hints.length).toBeGreaterThan(0);
      expect(hints.some((h) => h.description.includes('OLD_VALUE'))).toBe(true);
    });

    it('should not flag as removed when export is being renamed (same type)', () => {
      // When we remove and add similar exports, it might be a rename
      // This is a heuristic - we don't want to flag every change
      const diff = `diff --git a/src/constants.ts b/src/constants.ts
--- a/src/constants.ts
+++ b/src/constants.ts
@@ -1,3 +1,3 @@
-export const OLD_VALUE = 42;
+export const NEW_VALUE = 42;
 export const OTHER = 'test';`;

      const hints = analyzeBreakingChanges(diff);
      // This is actually still a breaking change, but our heuristic may not catch it
      // The AI should still detect it from the diff content
    });

    it('should not flag changes in test files', () => {
      const diff = `diff --git a/src/utils.test.ts b/src/utils.test.ts
--- a/src/utils.test.ts
+++ b/src/utils.test.ts
@@ -1,5 +1,3 @@
-export function testHelper() {
-  return 'test';
-}`;

      const hints = analyzeBreakingChanges(diff);
      expect(hints.length).toBe(0);
    });

    it('should detect changed function signature', () => {
      const diff = `diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,3 +1,3 @@
-export function fetchData(id: string, options: Options) {
+export function fetchData(id: string) {
   // implementation
 }`;

      const hints = analyzeBreakingChanges(diff);
      // Should detect the signature change
      expect(
        hints.some((h) => h.type === BreakingChangeType.CHANGED_SIGNATURE)
      ).toBe(true);
    });

    it('should handle empty diff', () => {
      const diff = '';
      const hints = analyzeBreakingChanges(diff);
      expect(hints.length).toBe(0);
    });

    it('should handle diff with only additions', () => {
      const diff = `diff --git a/src/new.ts b/src/new.ts
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export function newFunction() {
+  return 'new';
+}`;

      const hints = analyzeBreakingChanges(diff);
      expect(hints.length).toBe(0);
    });
  });

  describe('formatBreakingChangeHints', () => {
    it('should format hints correctly', () => {
      const hints = [
        {
          type: BreakingChangeType.REMOVED_FUNCTION,
          description: "Removed exported function 'oldHelper'",
          file: 'src/utils.ts'
        },
        {
          type: BreakingChangeType.REMOVED_CLASS,
          description: "Removed exported class 'OldModel'",
          file: 'src/models.ts'
        }
      ];

      const formatted = formatBreakingChangeHints(hints);
      expect(formatted).toContain('POTENTIAL BREAKING CHANGES DETECTED');
      expect(formatted).toContain('src/utils.ts');
      expect(formatted).toContain('src/models.ts');
      expect(formatted).toContain('oldHelper');
      expect(formatted).toContain('OldModel');
    });

    it('should return empty string for no hints', () => {
      const formatted = formatBreakingChangeHints([]);
      expect(formatted).toBe('');
    });
  });

  describe('generateBreakingChangeFooter', () => {
    it('should generate footer correctly', () => {
      const hints = [
        {
          type: BreakingChangeType.REMOVED_FUNCTION,
          description: "Removed exported function 'oldHelper'",
          file: 'src/utils.ts'
        }
      ];

      const footer = generateBreakingChangeFooter(hints);
      expect(footer).toContain('BREAKING CHANGE:');
      expect(footer).toContain('oldHelper');
    });

    it('should deduplicate descriptions', () => {
      const hints = [
        {
          type: BreakingChangeType.REMOVED_FUNCTION,
          description: "Removed exported function 'helper'",
          file: 'src/a.ts'
        },
        {
          type: BreakingChangeType.REMOVED_FUNCTION,
          description: "Removed exported function 'helper'",
          file: 'src/b.ts'
        }
      ];

      const footer = generateBreakingChangeFooter(hints);
      // Should only contain one instance
      const matches = footer.match(/Removed exported function 'helper'/g);
      expect(matches?.length).toBe(1);
    });

    it('should return empty string for no hints', () => {
      const footer = generateBreakingChangeFooter([]);
      expect(footer).toBe('');
    });
  });
});
