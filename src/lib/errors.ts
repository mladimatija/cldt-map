/**
 * Base error class for application errors
 * Provides standardized error handling with code, status, and optional details
 */
class AppError extends Error {
	constructor(
		message: string,
		public code: string,
		public status: number = 500,
		public details?: unknown,
	) {
		super(message);
		this.name = 'AppError';

		// Ensure a prototype chain is properly maintained in transpiled code
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}
}

/**
 * Error class for location-related errors
 */
export class LocationError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 'LOCATION_ERROR', 400, details);
		this.name = 'LocationError';
	}
}

/**
 * Error class for network-related errors
 */
export class NetworkError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 'NETWORK_ERROR', 503, details);
		this.name = 'NetworkError';
	}
}

/**
 * Shape used by store for locationError.
 */
export function toLocationError(error: unknown, fallbackMessage: string): { code: number; message: string } {
	return {
		code: 0,
		message: error instanceof Error ? error.message : fallbackMessage,
	};
}
