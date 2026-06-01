type FormattedResponse = {
  status: "success" | "error";
  message?: string;
  data?: any;
};

export function createSuccessResponse(data: any, message?: string): FormattedResponse {
  return { status: "success", message, data };
}

export function createErrorResponse(message: string, data?: any): FormattedResponse {
  return { status: "error", message, data };
}
