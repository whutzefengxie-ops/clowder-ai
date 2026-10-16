/**
 * Conditional validation utilities - skip expensive schema validation in production
 * when data is already trusted (e.g., from validated config files).
 *
 * Zod validation adds ~5-8s to startup with 317+ imports across the codebase.
 * We keep validation in development/debug mode and for untrusted inputs.
 */

import type { z } from 'zod';

/**
 * Determine if we should skip validation based on environment and context.
 */
export function shouldSkipValidation(context: 'startup' | 'runtime' | 'user-input'): boolean {
	// Always validate user inputs
	if (context === 'user-input') {
		return false;
	}

	// Force validation if explicitly requested
	if (process.env.STRICT_VALIDATION === 'true') {
		return false;
	}

	// Skip validation in production for trusted internal data
	const isProduction = process.env.NODE_ENV === 'production';
	const isDesktop = process.env.CAT_CAFE_RUNTIME_MODE === 'desktop';

	// Desktop production: skip startup validation (configs are bundled and pre-validated)
	if (isDesktop && isProduction && context === 'startup') {
		return true;
	}

	// Development: always validate
	return false;
}

/**
 * Conditionally validate data with Zod schema.
 * In production with trusted data, returns input as-is to avoid validation overhead.
 *
 * @param data - Data to validate
 * @param schema - Zod schema
 * @param context - Where this validation happens (affects whether to skip)
 * @returns Validated data (or unvalidated data if skipped)
 */
export function validateConfig<T>(
	data: unknown,
	schema: z.ZodSchema<T>,
	context: 'startup' | 'runtime' | 'user-input' = 'runtime',
): T {
	if (shouldSkipValidation(context)) {
		// Trust the data without validation (already validated at build time)
		return data as T;
	}

	// Perform full validation
	return schema.parse(data);
}

/**
 * Async version of validateConfig for schemas with async refinements.
 */
export async function validateConfigAsync<T>(
	data: unknown,
	schema: z.ZodSchema<T>,
	context: 'startup' | 'runtime' | 'user-input' = 'runtime',
): Promise<T> {
	if (shouldSkipValidation(context)) {
		return data as T;
	}

	return schema.parseAsync(data);
}

/**
 * Safe parse that returns success/error without throwing.
 * Always validates (even in production) since the caller expects to handle errors.
 */
export function safeValidateConfig<T>(
	data: unknown,
	schema: z.ZodSchema<T>,
): { success: true; data: T } | { success: false; error: z.ZodError } {
	const result = schema.safeParse(data);
	return result as { success: true; data: T } | { success: false; error: z.ZodError };
}

/**
 * Validate with custom error message on failure.
 * Throws an Error (not ZodError) with the custom message.
 */
export function validateConfigOrThrow<T>(
	data: unknown,
	schema: z.ZodSchema<T>,
	errorMessage: string,
	context: 'startup' | 'runtime' | 'user-input' = 'runtime',
): T {
	if (shouldSkipValidation(context)) {
		return data as T;
	}

	const result = schema.safeParse(data);
	if (!result.success) {
		throw new Error(`${errorMessage}: ${result.error.message}`);
	}
	return result.data;
}

/**
 * Create a validated wrapper that caches validation results.
 * Useful for config objects that are validated once and reused.
 */
export function createValidatedConfig<T>(
	data: unknown,
	schema: z.ZodSchema<T>,
	context: 'startup' | 'runtime' = 'startup',
): T {
	const validated = validateConfig(data, schema, context);

	// In production with skipped validation, the object is already the right shape
	// In development, Zod returns a new object
	return validated;
}

/**
 * Log validation skip for debugging performance issues.
 */
export function logValidationDecision(
	schemaName: string,
	context: 'startup' | 'runtime' | 'user-input',
	skipped: boolean,
): void {
	if (process.env.DEBUG_VALIDATION === 'true') {
		const action = skipped ? 'SKIPPED' : 'VALIDATED';
		console.log(`[validation] ${action} ${schemaName} (context: ${context})`);
	}
}

/**
 * Wrapper for startup config validation with logging.
 */
export function validateStartupConfig<T>(data: unknown, schema: z.ZodSchema<T>, name: string): T {
	const skipped = shouldSkipValidation('startup');
	logValidationDecision(name, 'startup', skipped);

	return validateConfig(data, schema, 'startup');
}
