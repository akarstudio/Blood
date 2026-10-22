import { describe, it, expect } from 'vitest';
import { 
  normalizeBangladeshPhone, 
  formatBangladeshPhone, 
  normalizeEmail, 
  isValidEmail, 
  isValidBloodGroup, 
  sanitizeForSpreadsheet 
} from '../src/utils/validation';

describe('Validation & Sanitization Engine', () => {
  describe('Bangladesh Phone Number Normalization', () => {
    it('normalizes standard 11-digit numbers starting with 01', () => {
      expect(normalizeBangladeshPhone('01712345678')).toBe('01712345678');
      expect(normalizeBangladeshPhone('01899887766')).toBe('01899887766');
      expect(normalizeBangladeshPhone('01300112233')).toBe('01300112233');
      expect(normalizeBangladeshPhone('01455667788')).toBe('01455667788');
      expect(normalizeBangladeshPhone('01911223344')).toBe('01911223344');
    });

    it('normalizes international format +880 and 880', () => {
      expect(normalizeBangladeshPhone('+8801712345678')).toBe('01712345678');
      expect(normalizeBangladeshPhone('8801812345678')).toBe('01812345678');
    });

    it('cleans up spaces, hyphens, and parentheses', () => {
      expect(normalizeBangladeshPhone('01712-345678')).toBe('01712345678');
      expect(normalizeBangladeshPhone('+88 (017) 12-345 678')).toBe('01712345678');
    });

    it('rejects invalid or foreign numbers', () => {
      expect(normalizeBangladeshPhone('01212345678')).toBeNull(); // 012 is invalid operator
      expect(normalizeBangladeshPhone('017123456')).toBeNull();   // too short
      expect(normalizeBangladeshPhone('017123456789')).toBeNull(); // too long
      expect(normalizeBangladeshPhone('+12345678901')).toBeNull();
      expect(normalizeBangladeshPhone('')).toBeNull();
    });

    it('formats phone numbers for human readability', () => {
      expect(formatBangladeshPhone('01712345678')).toBe('01712-345678');
    });
  });

  describe('Email Normalization & Validation', () => {
    it('normalizes email addresses to lower case and trims whitespace', () => {
      expect(normalizeEmail('  Tanvir.Ahmed@Example.COM  ')).toBe('tanvir.ahmed@example.com');
    });

    it('validates email addresses accurately', () => {
      expect(isValidEmail('tanvir@gmail.com')).toBe(true);
      expect(isValidEmail('doctor.rahman@hospital.org.bd')).toBe(true);
      expect(isValidEmail('invalid-email')).toBe(false);
      expect(isValidEmail('@nodomain.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
    });
  });

  describe('Blood Group Validator', () => {
    it('accepts all 8 standard ABO and Rh blood groups', () => {
      expect(isValidBloodGroup('A+')).toBe(true);
      expect(isValidBloodGroup('A-')).toBe(true);
      expect(isValidBloodGroup('B+')).toBe(true);
      expect(isValidBloodGroup('B-')).toBe(true);
      expect(isValidBloodGroup('AB+')).toBe(true);
      expect(isValidBloodGroup('AB-')).toBe(true);
      expect(isValidBloodGroup('O+')).toBe(true);
      expect(isValidBloodGroup('O-')).toBe(true);
    });

    it('rejects invalid blood groups', () => {
      expect(isValidBloodGroup('C+')).toBe(false);
      expect(isValidBloodGroup('O')).toBe(false);
      expect(isValidBloodGroup('AB')).toBe(false);
      expect(isValidBloodGroup('')).toBe(false);
    });
  });

  describe('Spreadsheet Formula-Injection Protection (CSV Injection)', () => {
    it('neutralizes malicious formula triggers like =, +, -, @', () => {
      expect(sanitizeForSpreadsheet('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(sanitizeForSpreadsheet('+cmd|/C calc')).toBe("'+cmd|/C calc");
      expect(sanitizeForSpreadsheet('-2+3*cmd')).toBe("'-2+3*cmd");
      expect(sanitizeForSpreadsheet('@SUM(1+1)')).toBe("'@SUM(1+1)");
    });

    it('leaves standard benign text untouched', () => {
      expect(sanitizeForSpreadsheet('Tanvir Ahmed')).toBe('Tanvir Ahmed');
      expect(sanitizeForSpreadsheet('Dhaka, Bangladesh')).toBe('Dhaka, Bangladesh');
      expect(sanitizeForSpreadsheet('A+')).toBe('A+');
    });
  });
});
