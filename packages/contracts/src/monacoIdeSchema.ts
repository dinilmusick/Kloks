export type MonacoDiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface MonacoDiagnostic {
  message: string;
  severity: MonacoDiagnosticSeverity;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  code?: string;
}

export interface MonacoDocument {
  uri: string;
  language: string;
  value: string;
  version: number;
  diagnostics: MonacoDiagnostic[];
}

export interface MonacoEditorOptions {
  readOnly?: boolean;
  minimap?: boolean;
  fontSize?: number;
  wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
}

export interface MonacoIdeSession {
  sessionId: string;
  document: MonacoDocument;
  options: MonacoEditorOptions;
  createdAt: number;
  updatedAt: number;
}

export interface MonacoCreateSessionInput {
  sessionId?: string;
  uri: string;
  language: string;
  value: string;
  options?: MonacoEditorOptions;
}

export interface MonacoUpdateDocumentInput {
  sessionId: string;
  value: string;
  language?: string;
}
