export type ValidationLayer = 'syntax' | 'lint' | 'test' | 'build' | 'krnl' | 'frnl' | 'law-l9';
export interface CodeValidationInput { layers?: ValidationLayer[]; cwd?: string; env?: Record<string, string>; maxLines?: number; }
export interface ValidationDiagnostic { layer: ValidationLayer; ok: boolean; exitCode: number; output: string; command: string; }
export interface CodeValidationResult { ok: boolean; diagnostics: ValidationDiagnostic[]; failedLayers: ValidationLayer[]; }
