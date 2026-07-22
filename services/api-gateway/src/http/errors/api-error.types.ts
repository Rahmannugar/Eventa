export interface ApiValidationError {
  code: string;
  field: string;
  message: string;
}

export interface ApiErrorResponse {
  code: string;
  errors?: ApiValidationError[];
  message: string;
  statusCode: number;
}

export interface ApiErrorTelemetry {
  errorCode: string;
  validationErrors?: string[];
}
