export interface LabResult {
    patientId: string;
    labType: 'blood' | 'urine' | 'tissue' | 'other';
    result: string;
    receivedAt: string;
  }
  
  export interface ProcessedLabResult extends LabResult {
    id: string;
    processedAt?: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead';
    attempts: number;
    errors: string[];
  }
  
  export interface JobStats {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }
  