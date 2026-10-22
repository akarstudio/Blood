import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLES, ALL_PERMISSIONS } from '../src/data/rolesData';
import { Permission } from '../src/types';

describe('Role-Based Access Control (RBAC) System', () => {
  it('Super Admin has all system permissions including policy management and role assignment', () => {
    const superAdmin = DEFAULT_ROLES.find(r => r.id === 'super_admin');
    expect(superAdmin).toBeDefined();

    const requiredSuperPerms: Permission[] = [
      'donors.view',
      'donors.approve',
      'donors.reject',
      'donors.suspend',
      'donors.export',
      'donors.import',
      'users.view',
      'users.manage_roles',
      'settings.availability_policy.manage',
      'audit_logs.view',
    ];

    requiredSuperPerms.forEach(p => {
      expect(superAdmin?.permissions).toContain(p);
    });
  });

  it('Admin does not automatically possess settings.availability_policy.manage or users.manage_roles', () => {
    const admin = DEFAULT_ROLES.find(r => r.id === 'admin');
    expect(admin).toBeDefined();

    expect(admin?.permissions).not.toContain('settings.availability_policy.manage');
    expect(admin?.permissions).not.toContain('users.manage_roles');
  });

  it('Donor Manager cannot modify system settings or users', () => {
    const donorManager = DEFAULT_ROLES.find(r => r.id === 'donor_manager');
    expect(donorManager).toBeDefined();

    expect(donorManager?.permissions).toContain('donors.approve');
    expect(donorManager?.permissions).toContain('donors.reject');
    expect(donorManager?.permissions).not.toContain('settings.view');
    expect(donorManager?.permissions).not.toContain('users.view');
  });

  it('Data Entry Operator cannot approve or suspend donors', () => {
    const dataEntry = DEFAULT_ROLES.find(r => r.id === 'data_entry_operator');
    expect(dataEntry).toBeDefined();

    expect(dataEntry?.permissions).toContain('donors.create');
    expect(dataEntry?.permissions).toContain('donors.update');
    expect(dataEntry?.permissions).not.toContain('donors.approve');
    expect(dataEntry?.permissions).not.toContain('donors.suspend');
    expect(dataEntry?.permissions).not.toContain('donors.export');
  });

  it('Viewer/Auditor has strictly read-only permissions', () => {
    const viewer = DEFAULT_ROLES.find(r => r.id === 'viewer_auditor');
    expect(viewer).toBeDefined();

    expect(viewer?.permissions).toContain('donors.view');
    expect(viewer?.permissions).toContain('audit_logs.view');

    // No mutation capabilities
    expect(viewer?.permissions).not.toContain('donors.create');
    expect(viewer?.permissions).not.toContain('donors.update');
    expect(viewer?.permissions).not.toContain('donors.approve');
    expect(viewer?.permissions).not.toContain('settings.availability_policy.manage');
  });
});
