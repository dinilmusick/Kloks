import { describe, expect, it } from 'vitest';
import { formatCanonicalWorkspaceFolderName } from '../workspace/WorkspaceCanonical.js';

describe('workspace application scoping', () => {
  it('uses an application namespace for canonical workspace folders', () => {
    expect(formatCanonicalWorkspaceFolderName('aiko', 'User One', 'Main')).toBe('ultrst_aiko_user_one_main');
    expect(formatCanonicalWorkspaceFolderName('depm', 'User One', 'Main')).toBe('ultrst_depm_user_one_main');
  });
});
