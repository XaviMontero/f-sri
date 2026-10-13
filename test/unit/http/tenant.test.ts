import { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../src/domain/shared/errors';
import { companyIdOf } from '../../../src/http/tenant';

const req = (user?: object) => ({ user }) as unknown as Request;

describe('companyIdOf', () => {
  it('devuelve el companyId del JWT como string', () => {
    expect(companyIdOf(req({ companyId: 'issuer-1' }))).toBe('issuer-1');
    expect(companyIdOf(req({ companyId: 42 }))).toBe('42');
  });

  it.each([undefined, {}, { companyId: '' }, { companyId: null }])('sin empresa (%o) → ForbiddenError', (user) => {
    expect(() => companyIdOf(req(user))).toThrow(ForbiddenError);
    expect(() => companyIdOf(req(user))).toThrow(/no tiene una empresa emisora/);
  });
});
