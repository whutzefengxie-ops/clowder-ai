/**
 * Lazy OpenTelemetry loader - only load when telemetry is explicitly enabled.
 * OpenTelemetry adds significant startup overhead (~10-15s) with 24+ file imports.
 * Most desktop installations don't need telemetry, so we defer loading until required.
 */

import { createRetryableLoader } from '../utils/retryable-loader.js';

export interface TelemetrySDK {
	start(): void;
	shutdown(): Promise<void>;
}

export interface LazyTelemetryResult {
	sdk: TelemetrySDK | null;
	enabled: boolean;
}

/**
 * Check if telemetry should be loaded based on environment configuration.
 */
export function isTelemetryEnabled(): boolean {
	// Explicit disable takes precedence
	if (process.env.OTEL_DISABLED === 'true' || process.env.DISABLE_TELEMETRY === 'true') {
		return false;
	}

	// Explicit enable
	if (process.env.OTEL_ENABLED === 'true' || process.env.ENABLE_TELEMETRY === 'true') {
		return true;
	}

	// Check if OTEL endpoint is configured (implicit enable)
	if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
		return true;
	}

	// Default: disabled for desktop, enabled for server deployments
	const isDesktop = process.env.CAT_CAFE_RUNTIME_MODE === 'desktop';
	return !isDesktop;
}

/**
 * Load OpenTelemetry SDK only when enabled.
 * Returns null SDK when disabled to avoid startup overhead.
 */
export const loadTelemetry = createRetryableLoader(
	async (): Promise<LazyTelemetryResult> => {
		const enabled = isTelemetryEnabled();

		if (!enabled) {
			console.log('[telemetry] OpenTelemetry disabled - skipping load');
			return {
				sdk: null,
				enabled: false,
			};
		}

		console.log('[telemetry] OpenTelemetry enabled - loading SDK');
		const startLoad = Date.now();

		// Dynamic import to avoid loading when disabled
		const { NodeSDK } = await import('@opentelemetry/sdk-node');
		const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
		const { Resource } = await import('@opentelemetry/resources');
		const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');

		const sdk = new NodeSDK({
			resource: new Resource({
				[ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'clowder-ai-api',
			}),
			instrumentations: [getNodeAutoInstrumentations()],
		});

		const loadTime = Date.now() - startLoad;
		console.log(`[telemetry] OpenTelemetry SDK loaded in ${loadTime}ms`);

		return {
			sdk,
			enabled: true,
		};
	},
);

/**
 * No-op telemetry SDK for when telemetry is disabled.
 * Provides the same interface but does nothing.
 */
export const createNoOpTelemetry = (): LazyTelemetryResult => ({
	sdk: {
		start: () => {},
		shutdown: async () => {},
	},
	enabled: false,
});

/**
 * Initialize telemetry with proper lifecycle management.
 * Safe to call even when telemetry is disabled.
 */
export async function initializeTelemetry(): Promise<LazyTelemetryResult> {
	try {
		const result = await loadTelemetry();

		if (result.sdk) {
			result.sdk.start();
			console.log('[telemetry] OpenTelemetry SDK started');

			// Graceful shutdown on process exit
			process.on('SIGTERM', async () => {
				console.log('[telemetry] Shutting down OpenTelemetry SDK');
				await result.sdk?.shutdown();
			});
		}

		return result;
	} catch (error) {
		console.error('[telemetry] Failed to initialize OpenTelemetry:', error);
		// Fall back to no-op to avoid blocking startup
		return createNoOpTelemetry();
	}
}
